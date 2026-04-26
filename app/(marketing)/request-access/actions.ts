"use server";

import * as Sentry from "@sentry/nextjs";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db/client";
import { waitlistRequests } from "@/lib/db/schema";
import { tryConsume, BUCKETS } from "@/lib/utils/rate-limit";
import { sendAdminNewRequestEmail } from "@/lib/waitlist/email";

// Public form handler. No auth — anyone can request access. Defends
// against:
//   - bots: per-IP rate limit (10 / hour)
//   - duplicate requests: unique email index, treat as silent success so
//     we don't leak "this email already applied"
//   - missing or malformed email: return a friendly inline error
//
// Returns nothing on success; instead `redirect()` shoves the visitor at
// /access-pending. Inline errors are passed through query string so the
// form is fully server-rendered (no client-side state machine for v1).

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function requestAccessAction(formData: FormData): Promise<void> {
  const ip = await getClientIp();
  const consumed = tryConsume(`waitlist:${ip}`, BUCKETS.waitlistRequest);
  if (!consumed.ok) {
    redirect("/request-access?error=rate_limited");
  }

  const rawEmail = String(formData.get("email") ?? "").trim().toLowerCase();
  const rawName = optionalString(formData.get("name"));
  const rawUniversity = optionalString(formData.get("university"));
  const rawReason = optionalString(formData.get("reason"));

  if (!EMAIL_RE.test(rawEmail) || rawEmail.length > 320) {
    redirect("/request-access?error=invalid_email");
  }

  // INSERT … ON CONFLICT DO NOTHING. The unique index on email means a
  // resubmission silently merges — we explicitly do NOT want to leak that
  // the email was already in the queue. `returning()` gives us the row
  // only on a fresh insert, so we can gate the admin notification on
  // first submission.
  const inserted = await db
    .insert(waitlistRequests)
    .values({
      email: rawEmail,
      name: rawName,
      university: rawUniversity,
      reason: rawReason,
    })
    .onConflictDoNothing({ target: waitlistRequests.email })
    .returning({
      id: waitlistRequests.id,
      requestedAt: waitlistRequests.requestedAt,
    });

  if (inserted.length > 0) {
    try {
      await sendAdminNewRequestEmail({
        email: rawEmail,
        name: rawName,
        university: rawUniversity,
        reason: rawReason,
        requestedAt: inserted[0].requestedAt,
      });
    } catch (err) {
      // sendAdminNewRequestEmail already swallows + reports its own
      // errors, but defend against future refactors that might let one
      // through.
      Sentry.captureException(err, {
        tags: { feature: "waitlist_admin_notify" },
      });
    }
  }

  redirect("/access-pending");
}

function optionalString(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Hard cap so a malicious payload can't blow up the row. The form
  // textarea has its own maxlength but the server should not trust it.
  return trimmed.slice(0, 1000);
}

async function getClientIp(): Promise<string> {
  const h = await headers();
  // Vercel sets x-forwarded-for; the leftmost entry is the real client.
  const xff = h.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = h.get("x-real-ip");
  if (real) return real;
  return "unknown";
}

import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { inboxItems, users } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { getGmailForUser } from "@/lib/integrations/google/gmail";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// engineer-43 — Gmail Push receiver. Pub/Sub delivers a JSON envelope
// with a base64-encoded data payload whenever the watched UNREAD label
// changes on the user's mailbox. We:
//   1. Verify Pub/Sub auth (token query param + JWT path enforced by
//      GCP; this handler is the second wall).
//   2. Decode the payload → { emailAddress, historyId }.
//   3. Walk users.history.list from the prior historyId to now,
//      filtering on labelAdded / labelRemoved 'UNREAD'.
//   4. Flip inbox_items.gmail_read_at to match each message's current
//      read state (null when freshly unread, now() when read).
//
// Pub/Sub re-delivers on 5xx; 2xx ACKs the message. We always return 2xx
// after recording — re-delivery on transient DB errors burns the user's
// quota for no gain.
export async function POST(req: Request) {
  return Sentry.startSpan(
    {
      name: "webhook.gmail_push",
      op: "http.server",
    },
    async () => {
      // Verification token: passed by Pub/Sub as ?token=<shared-secret>.
      // When the env var is unset (local dev) we skip the check; in
      // production the env validator catches "set in prod but mismatch".
      const e = env();
      const expectedToken = e.GMAIL_PUSH_VERIFICATION_TOKEN;
      if (expectedToken) {
        const url = new URL(req.url);
        const token = url.searchParams.get("token");
        if (token !== expectedToken) {
          return NextResponse.json(
            { error: "unauthorized" },
            { status: 401 }
          );
        }
      }

      let body: PubSubEnvelope;
      try {
        body = (await req.json()) as PubSubEnvelope;
      } catch {
        return NextResponse.json({ error: "invalid_json" }, { status: 400 });
      }

      const decoded = decodePubSubPayload(body);
      if (!decoded) {
        // Malformed payload — ACK to avoid Pub/Sub retry storm.
        return NextResponse.json({ status: "ignored", reason: "no_payload" });
      }

      const { emailAddress, historyId: newHistoryId } = decoded;

      const [user] = await db
        .select({
          id: users.id,
          gmailWatch: users.gmailWatch,
        })
        .from(users)
        .where(eq(users.email, emailAddress))
        .limit(1);

      if (!user) {
        return NextResponse.json({ status: "ignored", reason: "no_user" });
      }

      const startHistoryId = user.gmailWatch?.historyId ?? null;
      if (!startHistoryId) {
        // First push or watch lost — record the historyId so the next
        // push has a cursor. No history walk possible until then.
        await db
          .update(users)
          .set({
            gmailWatch: {
              historyId: String(newHistoryId),
              expiresAt:
                user.gmailWatch?.expiresAt ??
                new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
              setupAt:
                user.gmailWatch?.setupAt ?? new Date().toISOString(),
            },
            updatedAt: new Date(),
          })
          .where(eq(users.id, user.id));
        return NextResponse.json({
          status: "cursor_initialized",
          historyId: String(newHistoryId),
        });
      }

      let processed = 0;
      try {
        processed = await processHistoryDelta({
          userId: user.id,
          startHistoryId,
        });
      } catch (err) {
        Sentry.captureException(err, {
          tags: { feature: "gmail_push", op: "history_list" },
          user: { id: user.id },
        });
      }

      // Always advance the cursor — re-processing the same history
      // window on retry burns quota and risks double-flipping
      // gmail_read_at on rapid mark-as-read toggles.
      await db
        .update(users)
        .set({
          gmailWatch: {
            historyId: String(newHistoryId),
            expiresAt:
              user.gmailWatch?.expiresAt ??
              new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            setupAt: user.gmailWatch?.setupAt ?? new Date().toISOString(),
          },
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));

      return NextResponse.json({ status: "ok", processed });
    }
  );
}

// ── Helpers ──────────────────────────────────────────────────────────

type PubSubEnvelope = {
  message?: {
    data?: string;
    messageId?: string;
    publishTime?: string;
  };
  subscription?: string;
};

type GmailPushPayload = {
  emailAddress: string;
  historyId: string | number;
};

export function decodePubSubPayload(
  envelope: PubSubEnvelope
): GmailPushPayload | null {
  const data = envelope.message?.data;
  if (!data || typeof data !== "string") return null;
  let decoded: string;
  try {
    decoded = Buffer.from(data, "base64").toString("utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  const emailAddress =
    typeof obj.emailAddress === "string" ? obj.emailAddress : null;
  const historyId =
    typeof obj.historyId === "string" || typeof obj.historyId === "number"
      ? obj.historyId
      : null;
  if (!emailAddress || historyId === null) return null;
  return { emailAddress, historyId };
}

async function processHistoryDelta(args: {
  userId: string;
  startHistoryId: string;
}): Promise<number> {
  const gmail = await getGmailForUser(args.userId);
  const resp = await gmail.users.history.list({
    userId: "me",
    startHistoryId: args.startHistoryId,
    historyTypes: ["labelAdded", "labelRemoved"],
  });

  const histories = resp.data.history ?? [];
  // Walk every history row, collapsing per-message into a single final
  // state. A user who marks-read-then-unread inside the same delivery
  // window should land on the latest state, not the first transition.
  const finalReadState = new Map<string, "read" | "unread">();
  for (const h of histories) {
    for (const added of h.labelsAdded ?? []) {
      const id = added.message?.id;
      if (!id) continue;
      if ((added.labelIds ?? []).includes("UNREAD")) {
        finalReadState.set(id, "unread");
      }
    }
    for (const removed of h.labelsRemoved ?? []) {
      const id = removed.message?.id;
      if (!id) continue;
      if ((removed.labelIds ?? []).includes("UNREAD")) {
        finalReadState.set(id, "read");
      }
    }
  }

  if (finalReadState.size === 0) return 0;

  // One update per external id. We could batch via a single UPDATE...
  // FROM VALUES, but the per-push delta is small (typically 1–5 rows)
  // and per-row updates keep the SQL simple. If quota becomes an issue
  // a batched path can replace this without changing semantics.
  let processed = 0;
  for (const [externalId, state] of finalReadState) {
    const value = state === "read" ? new Date() : null;
    const result = await db
      .update(inboxItems)
      .set({ gmailReadAt: value, updatedAt: new Date() })
      .where(
        and(
          eq(inboxItems.userId, args.userId),
          eq(inboxItems.sourceType, "gmail"),
          eq(inboxItems.externalId, externalId)
        )
      )
      .returning({ id: inboxItems.id });
    if (result.length > 0) processed++;
  }

  return processed;
}

export const _internal = { processHistoryDelta };

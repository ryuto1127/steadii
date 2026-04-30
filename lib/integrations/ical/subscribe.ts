import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { icalSubscriptions, type IcalSubscription } from "@/lib/db/schema";
import { assertPublicUrl, BlockedUrlError } from "@/lib/utils/ssrf-guard";
import { syncIcalSubscription, type IcalSyncOutcome } from "./sync";

export class IcalSubscribeError extends Error {
  constructor(
    public readonly code:
      | "INVALID_URL"
      | "BLOCKED_URL",
    message: string
  ) {
    super(message);
  }
}

export type SubscribeResult = {
  subscription: IcalSubscription;
  alreadyExisted: boolean;
  syncOutcome: IcalSyncOutcome;
};

function normaliseUrl(rawUrl: string): string {
  return rawUrl
    .trim()
    .replace(/^webcal:\/\//i, "https://")
    .replace(/^webcals:\/\//i, "https://");
}

// Add an iCal subscription for `userId` and run a synchronous first sync
// so events surface immediately. The cron only ticks every 6h (locked
// decision Q3) — without an inline first sync the user would stare at an
// empty calendar after pasting a URL. Idempotent on (userId, url): a
// re-subscribe just returns the existing row + a fresh sync outcome.
export async function subscribeToIcal(args: {
  userId: string;
  rawUrl: string;
  label?: string | null;
}): Promise<SubscribeResult> {
  const candidate = normaliseUrl(args.rawUrl);
  if (!candidate) {
    throw new IcalSubscribeError("INVALID_URL", "URL is required.");
  }
  // SSRF guard before insert — blocks loopback / private IPs / non-http(s).
  try {
    await assertPublicUrl(candidate);
  } catch (err) {
    if (err instanceof BlockedUrlError) {
      throw new IcalSubscribeError("BLOCKED_URL", err.message);
    }
    throw err;
  }

  const existing = await db
    .select()
    .from(icalSubscriptions)
    .where(
      and(
        eq(icalSubscriptions.userId, args.userId),
        eq(icalSubscriptions.url, candidate)
      )
    )
    .limit(1);

  let sub: IcalSubscription;
  let alreadyExisted = false;
  if (existing[0]) {
    sub = existing[0];
    alreadyExisted = true;
    // Re-activate a previously deactivated row (3-strikes auto-deactivate)
    // so a manual re-subscribe gets a fresh shot at sync.
    if (!sub.active || sub.consecutiveFailures > 0) {
      await db
        .update(icalSubscriptions)
        .set({ active: true, consecutiveFailures: 0, lastError: null })
        .where(eq(icalSubscriptions.id, sub.id));
      sub = {
        ...sub,
        active: true,
        consecutiveFailures: 0,
        lastError: null,
      };
    }
  } else {
    const [inserted] = await db
      .insert(icalSubscriptions)
      .values({
        userId: args.userId,
        url: candidate,
        label: args.label?.trim() || null,
      })
      .returning();
    sub = inserted;
  }

  const syncOutcome = await syncIcalSubscription(sub);
  return { subscription: sub, alreadyExisted, syncOutcome };
}

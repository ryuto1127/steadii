import "server-only";
import * as Sentry from "@sentry/nextjs";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { getGmailForUser } from "./gmail";

// engineer-43 — Gmail Push (Pub/Sub) infrastructure. Gmail watches expire
// after 7 days; the refresh cron must run before they lapse or the
// real-time read-state filter on Type C cards silently stops working.
// Both helpers are no-ops when GMAIL_PUBSUB_PROJECT / TOPIC are unset
// (local dev / partially configured envs) so callers can invoke them
// unconditionally.

// Refresh when the watch has less than this much life left. 24h gives
// the daily refresh cron a full retry window if the call fails.
const REFRESH_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export type GmailWatchState = {
  historyId: string;
  expiresAt: string;
  setupAt: string;
};

export type SetupWatchOutcome =
  | { status: "ok"; state: GmailWatchState }
  | { status: "skipped"; reason: "no_pubsub_config" | "no_gmail_scope" }
  | { status: "error"; message: string };

// Construct the fully-qualified Pub/Sub topic name the Gmail API expects.
// Returns null when either half of the pair is missing — callers must
// short-circuit because a partial config is the same as no config.
function resolveTopicName(): string | null {
  const e = env();
  if (!e.GMAIL_PUBSUB_PROJECT || !e.GMAIL_PUBSUB_TOPIC) return null;
  return `projects/${e.GMAIL_PUBSUB_PROJECT}/topics/${e.GMAIL_PUBSUB_TOPIC}`;
}

// Call users.watch and persist the returned historyId + expiration so
// the push receiver can decode subsequent payloads. We scope the watch
// to the UNREAD label only — the queue filter cares about read/unread
// transitions, nothing else, and a narrower watch means fewer wasted
// Pub/Sub messages.
export async function setupWatchForUser(
  userId: string
): Promise<SetupWatchOutcome> {
  const topicName = resolveTopicName();
  if (!topicName) {
    return { status: "skipped", reason: "no_pubsub_config" };
  }

  return Sentry.startSpan(
    {
      name: "gmail.watch.setup",
      op: "http.client",
      attributes: { "steadii.user_id": userId },
    },
    async () => {
      try {
        const gmail = await getGmailForUser(userId);
        const resp = await gmail.users.watch({
          userId: "me",
          requestBody: {
            topicName,
            labelIds: ["UNREAD"],
            // INCLUDE means "send a push every time UNREAD is added or
            // removed". With FILTER we'd only get messages matching the
            // label currently — we want both transitions.
            labelFilterBehavior: "INCLUDE",
          },
        });

        const historyId = resp.data.historyId ?? null;
        const expirationMs = resp.data.expiration
          ? Number(resp.data.expiration)
          : null;
        if (!historyId || !expirationMs || !Number.isFinite(expirationMs)) {
          throw new Error(
            `gmail.users.watch returned unexpected shape: historyId=${historyId}, expiration=${resp.data.expiration}`
          );
        }

        const state: GmailWatchState = {
          historyId,
          expiresAt: new Date(expirationMs).toISOString(),
          setupAt: new Date().toISOString(),
        };

        await db
          .update(users)
          .set({ gmailWatch: state, updatedAt: new Date() })
          .where(eq(users.id, userId));

        return { status: "ok" as const, state };
      } catch (err) {
        Sentry.captureException(err, {
          tags: { integration: "gmail", op: "watch.setup" },
          user: { id: userId },
        });
        const message = err instanceof Error ? err.message : String(err);
        if (message.toLowerCase().includes("insufficient")) {
          return { status: "skipped" as const, reason: "no_gmail_scope" };
        }
        return { status: "error" as const, message };
      }
    }
  );
}

// Re-call setupWatchForUser when the existing watch has <24h to live.
// Idempotent — when no existing state exists OR the state is already
// fresh, we still call setupWatchForUser to give the cron a single
// catch-up path. Returns the action taken so the cron can log progress.
export async function refreshWatch(
  userId: string,
  now: Date = new Date()
): Promise<"refreshed" | "still_fresh" | "skipped" | "error"> {
  const [row] = await db
    .select({ gmailWatch: users.gmailWatch })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) return "skipped";

  const existing = row.gmailWatch;
  if (existing) {
    const expiresAt = new Date(existing.expiresAt);
    if (
      Number.isFinite(expiresAt.getTime()) &&
      expiresAt.getTime() - now.getTime() > REFRESH_THRESHOLD_MS
    ) {
      return "still_fresh";
    }
  }

  const outcome = await setupWatchForUser(userId);
  if (outcome.status === "ok") return "refreshed";
  if (outcome.status === "skipped") return "skipped";
  return "error";
}

// Test-only — re-export for direct call from unit tests so the threshold
// stays a single source of truth.
export const _internal = { REFRESH_THRESHOLD_MS, resolveTopicName };

/**
 * scripts/cleanup-self-sender-inbox.ts
 *
 * One-shot cleanup for inbox_items + agent_drafts rows that originated
 * from Steadii's own outbound mail (@mysteadii.com / @mysteadii.xyz).
 * The ingest-side gate at #308 skips these going forward, but pre-fix
 * legacy rows that already made it through keep surfacing as draft
 * cards on the queue (most visibly the "reply to Steadii's own digest"
 * loop). The queue-build defensive filter hides them at render time;
 * this script clears them at the source so adjacent surfaces
 * (/app/inbox, counts, activity, etc.) also reflect reality.
 *
 * Behavior per matched inbox_items row:
 *   - status            → 'archived'
 *   - auto_archived     → true
 *   - proposed_archive_* cleared
 * Per any pending agent_drafts row pointing at the matched inbox item:
 *   - status            → 'dismissed'
 *   - disposition       → 'ignored' (so re-surface sweep doesn't revive it)
 * Single audit row per inbox item: action='auto_archive',
 * detail.triggeredBy='self_sender_cleanup_script'.
 *
 * Usage:
 *
 *   pnpm tsx scripts/cleanup-self-sender-inbox.ts            # all users
 *   pnpm tsx scripts/cleanup-self-sender-inbox.ts --dry      # plan only
 *   pnpm tsx scripts/cleanup-self-sender-inbox.ts --user=ID  # one user
 */
import { and, eq, ilike, ne, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { agentDrafts, inboxItems } from "@/lib/db/schema";
import { logEmailAudit } from "@/lib/agent/email/audit";
import { isSteadiiSelfSender } from "@/lib/agent/email/ingest-recent";

type Flags = {
  dry: boolean;
  userId: string | null;
};

function parseFlags(argv: string[]): Flags {
  let dry = false;
  let userId: string | null = null;
  for (const a of argv.slice(2)) {
    if (a === "--dry") dry = true;
    else if (a.startsWith("--user=")) userId = a.split("=")[1]!;
  }
  return { dry, userId };
}

async function main() {
  const flags = parseFlags(process.argv);
  const startedAt = Date.now();

  const baseWhere = or(
    ilike(inboxItems.senderEmail, "%@mysteadii.com"),
    ilike(inboxItems.senderEmail, "%@mysteadii.xyz")
  );
  const scopedWhere = flags.userId
    ? and(baseWhere, eq(inboxItems.userId, flags.userId))
    : baseWhere;

  const candidates = await db
    .select({
      id: inboxItems.id,
      userId: inboxItems.userId,
      status: inboxItems.status,
      autoArchived: inboxItems.autoArchived,
      senderEmail: inboxItems.senderEmail,
      senderDomain: inboxItems.senderDomain,
      subject: inboxItems.subject,
    })
    .from(inboxItems)
    .where(scopedWhere);

  console.log(
    `[cleanup-self-sender] matched ${candidates.length} inbox_items rows`
  );

  // Defense in depth — the SQL filter should already match the helper,
  // but if a row has whitespace or other oddities the helper covers it
  // too. Drop anything the helper rejects so we never archive a row
  // that doesn't actually qualify.
  const safe = candidates.filter((r) => isSteadiiSelfSender(r.senderEmail));
  if (safe.length !== candidates.length) {
    console.log(
      `[cleanup-self-sender] dropped ${candidates.length - safe.length} false-positive rows after helper check`
    );
  }

  if (flags.dry) {
    for (const row of safe.slice(0, 25)) {
      console.log(
        `  - ${row.id} | user=${row.userId} | status=${row.status} | sender=${row.senderEmail}`
      );
    }
    if (safe.length > 25) {
      console.log(`  ... and ${safe.length - 25} more`);
    }
    console.log("[cleanup-self-sender] DRY RUN — no rows written");
    return;
  }

  let inboxArchived = 0;
  let inboxAlreadyClean = 0;
  let draftsDismissed = 0;
  const now = new Date();

  for (const row of safe) {
    const alreadyClean = row.status === "archived" && row.autoArchived;
    if (!alreadyClean) {
      await db
        .update(inboxItems)
        .set({
          status: "archived",
          autoArchived: true,
          proposedArchiveAt: null,
          proposedArchiveReason: null,
          updatedAt: now,
        })
        .where(eq(inboxItems.id, row.id));
      inboxArchived++;
      try {
        await logEmailAudit({
          userId: row.userId,
          action: "auto_archive",
          result: "success",
          resourceId: row.id,
          detail: {
            triggeredBy: "self_sender_cleanup_script",
            senderEmail: row.senderEmail,
            senderDomain: row.senderDomain,
            subject: row.subject,
          },
        });
      } catch (err) {
        console.error(`  audit log failed for inbox ${row.id}:`, err);
      }
    } else {
      inboxAlreadyClean++;
    }

    const updatedDrafts = await db
      .update(agentDrafts)
      .set({
        status: "dismissed",
        disposition: "ignored",
        updatedAt: now,
      })
      .where(
        and(
          eq(agentDrafts.inboxItemId, row.id),
          ne(agentDrafts.status, "dismissed")
        )
      )
      .returning({ id: agentDrafts.id });
    draftsDismissed += updatedDrafts.length;
  }

  const durationMs = Date.now() - startedAt;
  console.log(
    `[cleanup-self-sender] done in ${durationMs}ms — inbox archived: ${inboxArchived}, inbox already clean: ${inboxAlreadyClean}, drafts dismissed: ${draftsDismissed}`
  );
}

main().catch((err) => {
  console.error("[cleanup-self-sender] failed", err);
  process.exit(1);
});

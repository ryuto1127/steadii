/**
 * scripts/cleanup-self-sender-inbox.ts
 *
 * One-shot cleanup for inbox_items + agent_drafts rows that originated
 * from Steadii's own outbound mail (@mysteadii.com / @mysteadii.xyz).
 * The ingest-side gate at #308/#327 skips these going forward, but pre-fix
 * legacy rows that already made it through keep surfacing as draft
 * cards on the queue (the "reply to Steadii's own digest" loop the
 * user flagged 2026-05-25). The queue-build defensive filter hides
 * them at render time; this script clears them at the source so
 * adjacent surfaces (/app/inbox, counts, activity) also reflect
 * reality.
 *
 * Behavior per matched inbox_items row:
 *   - status            → 'archived'
 *   - auto_archived     → true
 *   - deleted_at        → now  (NEW)
 *   - proposed_archive_* cleared
 * Per any pending agent_drafts row pointing at the matched inbox item:
 *   - status            → 'dismissed'
 *   - disposition       → 'ignored' (so re-surface sweep doesn't revive it)
 * Single audit row per archived inbox item, action='auto_archive',
 * detail.triggeredBy='self_sender_cleanup_script'.
 *
 * Why deleted_at (not just status='archived'): the vector-retrieval
 * query (lib/agent/email/retrieval.ts) filters on `ii.deleted_at IS NULL`,
 * NOT on status. So rows the prior script version merely archived stayed
 * RETRIEVABLE and kept getting pulled into the grounding/citation layer
 * as "similar past emails", rendering as source chips on unrelated cards
 * (SELF_REFERENCE_RETRIEVAL_LOOP). Setting deleted_at removes them from
 * retrieval at the source. The going-forward retrieval filter (#NNN) is
 * belt-and-suspenders; this backfill clears the legacy corpus.
 *
 * Provenance scrub: any agent_drafts.retrieval_provenance already persisted
 * with these self-sender ids in its `sources` keeps the stale chips on the
 * existing card even after the inbox rows are soft-deleted (the card reads
 * its frozen provenance JSONB, not live retrieval). So this script also
 * rewrites those provenance blobs, dropping the self-sender email sources.
 *
 * Connects via the same Neon REST API path as scripts/migrate-prod.ts
 * so we don't need full prod .env to run — only NEONCTL_API_KEY.
 *
 * Idempotent + dry-runnable. Re-runs are no-ops once rows carry deleted_at
 * and provenance blobs are scrubbed.
 *
 * Usage:
 *
 *   pnpm tsx --require ./scripts/_register.cjs scripts/cleanup-self-sender-inbox.ts --dry
 *   pnpm tsx --require ./scripts/_register.cjs scripts/cleanup-self-sender-inbox.ts
 *   pnpm tsx --require ./scripts/_register.cjs scripts/cleanup-self-sender-inbox.ts --user=<UUID>
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { and, eq, ilike, inArray, isNotNull, ne, or } from "drizzle-orm";
import { agentDrafts, auditLog, inboxItems } from "@/lib/db/schema";
import { isSteadiiSelfSender } from "@/lib/agent/email/ingest-recent";
import { scrubSelfSenderEmailSourcesFromProvenance } from "@/lib/agent/email/self-sender";

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

const NEON_API_KEY = process.env.NEONCTL_API_KEY;
const NEON_PROJECT_ID = process.env.NEON_PROJECT_ID;
const NEON_PROD_BRANCH = process.env.NEON_PROD_BRANCH ?? "production";
const NEON_DATABASE = process.env.NEON_DATABASE ?? "neondb";
const NEON_ROLE = process.env.NEON_ROLE ?? "neondb_owner";

async function neonApi<T>(apiPath: string): Promise<T> {
  if (!NEON_API_KEY) {
    throw new Error(
      "NEONCTL_API_KEY not set. Add it to .env.local — generate at Neon Console → Profile → API Keys."
    );
  }
  const res = await fetch(`https://console.neon.tech/api/v2${apiPath}`, {
    headers: {
      Authorization: `Bearer ${NEON_API_KEY}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(
      `Neon API ${apiPath}: ${res.status} ${res.statusText} — ${await res.text()}`
    );
  }
  return (await res.json()) as T;
}

async function discoverProdConnectionString(): Promise<string> {
  let projectId = NEON_PROJECT_ID;
  if (!projectId) {
    type Proj = { id: string; name: string };
    type Projects = { projects: Proj[] };
    type Org = { id: string; name: string };
    type Orgs = { organizations: Org[] };
    let orgs: Org[] = [];
    try {
      const r = await neonApi<Orgs>("/users/me/organizations");
      orgs = r.organizations ?? [];
    } catch {
      // personal-account fallback
    }
    const projectCandidates: Proj[] = [];
    if (orgs.length > 0) {
      for (const org of orgs) {
        try {
          const r = await neonApi<Projects>(
            `/projects?org_id=${encodeURIComponent(org.id)}`
          );
          projectCandidates.push(...(r.projects ?? []));
        } catch (e) {
          console.warn(`Skipping org ${org.name}: ${String(e)}`);
        }
      }
    } else {
      const r = await neonApi<Projects>("/projects");
      projectCandidates.push(...(r.projects ?? []));
    }
    const matched = projectCandidates.find((p) =>
      p.name.toLowerCase().includes("steadii")
    );
    if (!matched) {
      throw new Error(
        `No 'steadii' project found. Available: ${projectCandidates
          .map((p) => p.name)
          .join(", ")}.`
      );
    }
    projectId = matched.id;
  }

  type Branch = { id: string; name: string; primary?: boolean };
  type Branches = { branches: Branch[] };
  const { branches } = await neonApi<Branches>(
    `/projects/${projectId}/branches`
  );
  const prodBranch =
    branches.find((b) => b.name === NEON_PROD_BRANCH) ??
    branches.find((b) => b.name === "main") ??
    branches.find((b) => b.primary === true);
  if (!prodBranch) {
    throw new Error(
      `No '${NEON_PROD_BRANCH}' branch found. Available: ${branches
        .map((b) => b.name)
        .join(", ")}`
    );
  }

  type UriResp = { uri: string };
  const { uri } = await neonApi<UriResp>(
    `/projects/${projectId}/connection_uri?branch_id=${prodBranch.id}&database_name=${NEON_DATABASE}&role_name=${NEON_ROLE}&pooled=true`
  );
  return uri;
}

async function main() {
  const flags = parseFlags(process.argv);
  const startedAt = Date.now();

  console.log("[cleanup-self-sender] resolving prod connection via Neon API…");
  const connectionString = await discoverProdConnectionString();
  const sqlClient = neon(connectionString);
  const db = drizzle(sqlClient);

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
      deletedAt: inboxItems.deletedAt,
      senderEmail: inboxItems.senderEmail,
      senderDomain: inboxItems.senderDomain,
      subject: inboxItems.subject,
    })
    .from(inboxItems)
    .where(scopedWhere);

  console.log(
    `[cleanup-self-sender] matched ${candidates.length} inbox_items rows`
  );

  const safe = candidates.filter((r) => isSteadiiSelfSender(r.senderEmail));
  if (safe.length !== candidates.length) {
    console.log(
      `[cleanup-self-sender] dropped ${candidates.length - safe.length} false-positive rows after helper check`
    );
  }

  // Per-status + per-user breakdown so dry output is informative.
  const byStatus = new Map<string, number>();
  const byUser = new Map<string, number>();
  for (const r of safe) {
    byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);
    byUser.set(r.userId, (byUser.get(r.userId) ?? 0) + 1);
  }
  console.log(
    "[cleanup-self-sender] breakdown by status:",
    Object.fromEntries(byStatus)
  );
  console.log(
    `[cleanup-self-sender] breakdown by user (${byUser.size} users):`,
    Object.fromEntries(byUser)
  );

  // Count pending drafts that would also be dismissed.
  if (safe.length > 0) {
    const inboxIds = safe.map((r) => r.id);
    const pendingDrafts = await db
      .select({ id: agentDrafts.id })
      .from(agentDrafts)
      .where(
        and(
          ne(agentDrafts.status, "dismissed"),
          inArray(agentDrafts.inboxItemId, inboxIds)
        )
      );
    console.log(
      `[cleanup-self-sender] would dismiss ${pendingDrafts.length} pending agent_drafts`
    );
  }

  // ── Provenance scrub set ────────────────────────────────────────────
  // The self-sender inbox ids whose email-source citations must be
  // stripped out of any persisted agent_drafts.retrieval_provenance.
  // Scoped to the affected users (the byUser keys) so we don't scan
  // every user's drafts.
  const selfSenderIds = new Set(safe.map((r) => r.id));
  const affectedUsers = [...byUser.keys()];
  const now = new Date();

  if (flags.dry) {
    for (const row of safe.slice(0, 25)) {
      console.log(
        `  - ${row.id} | user=${row.userId} | status=${row.status} | sender=${row.senderEmail}`
      );
    }
    if (safe.length > 25) {
      console.log(`  ... and ${safe.length - 25} more`);
    }
    // Provenance scrub dry-run — count drafts that would change + total
    // self-sender email sources that would be removed.
    if (affectedUsers.length > 0 && selfSenderIds.size > 0) {
      const provRows = await db
        .select({
          id: agentDrafts.id,
          userId: agentDrafts.userId,
          retrievalProvenance: agentDrafts.retrievalProvenance,
        })
        .from(agentDrafts)
        .where(
          and(
            inArray(agentDrafts.userId, affectedUsers),
            isNotNull(agentDrafts.retrievalProvenance)
          )
        );
      let draftsToChange = 0;
      let sourcesToRemove = 0;
      for (const d of provRows) {
        const { removed } = scrubSelfSenderEmailSourcesFromProvenance(
          d.retrievalProvenance ?? null,
          selfSenderIds
        );
        if (removed > 0) {
          draftsToChange++;
          sourcesToRemove += removed;
        }
      }
      console.log(
        `[cleanup-self-sender] would scrub ${sourcesToRemove} self-sender email source(s) from ${draftsToChange} draft provenance blob(s)`
      );
    }
    console.log("[cleanup-self-sender] DRY RUN — no rows written");
    return;
  }

  let inboxArchived = 0;
  let inboxAlreadyClean = 0;
  let draftsDismissed = 0;

  for (const row of safe) {
    // alreadyClean now ALSO requires deletedAt to be set — rows the prior
    // script version archived (status='archived' + autoArchived) but left
    // with deleted_at NULL must be re-processed so the deleted_at stamp
    // lands and they drop out of the retrieval query.
    const alreadyClean =
      row.status === "archived" && row.autoArchived && row.deletedAt != null;
    if (!alreadyClean) {
      await db
        .update(inboxItems)
        .set({
          status: "archived",
          autoArchived: true,
          deletedAt: now,
          proposedArchiveAt: null,
          proposedArchiveReason: null,
          updatedAt: now,
        })
        .where(eq(inboxItems.id, row.id));
      inboxArchived++;
      try {
        await db.insert(auditLog).values({
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

  // ── Provenance scrub (live) ─────────────────────────────────────────
  // Strip self-sender email-source citations out of any persisted
  // agent_drafts.retrieval_provenance for the affected users. The card
  // renders its frozen provenance blob, so soft-deleting the inbox rows
  // alone wouldn't clear stale chips already attached to OTHER cards.
  // Idempotent: re-runs return removed:0 once blobs are scrubbed.
  let provDraftsScrubbed = 0;
  let provSourcesRemoved = 0;
  if (affectedUsers.length > 0 && selfSenderIds.size > 0) {
    const provRows = await db
      .select({
        id: agentDrafts.id,
        retrievalProvenance: agentDrafts.retrievalProvenance,
      })
      .from(agentDrafts)
      .where(
        and(
          inArray(agentDrafts.userId, affectedUsers),
          isNotNull(agentDrafts.retrievalProvenance)
        )
      );
    for (const d of provRows) {
      const { provenance, removed } = scrubSelfSenderEmailSourcesFromProvenance(
        d.retrievalProvenance ?? null,
        selfSenderIds
      );
      if (removed > 0 && provenance) {
        await db
          .update(agentDrafts)
          .set({ retrievalProvenance: provenance, updatedAt: now })
          .where(eq(agentDrafts.id, d.id));
        provDraftsScrubbed++;
        provSourcesRemoved += removed;
      }
    }
  }

  const durationMs = Date.now() - startedAt;
  console.log(
    `[cleanup-self-sender] done in ${durationMs}ms — inbox archived: ${inboxArchived}, inbox already clean: ${inboxAlreadyClean}, drafts dismissed: ${draftsDismissed}, provenance scrubbed: ${provDraftsScrubbed} draft(s) / ${provSourcesRemoved} source(s)`
  );
}

main().catch((err) => {
  console.error("[cleanup-self-sender] failed", err);
  process.exit(1);
});

// Steadii self-sender helpers — pure, leaf module (no server-only, no db,
// no gmail). Extracted from ingest-recent.ts so retrieval.ts can import the
// predicates WITHOUT pulling the ingest graph (retrieval → ingest-recent →
// l2 → retrieval would be a cycle). ingest-recent.ts re-exports from here so
// existing importers (queue/build.ts, cleanup-self-sender-inbox.ts) keep
// resolving them `from "@/lib/agent/email/ingest-recent"`.
//
// The two predicates are moved verbatim from the post-#327 ingest-recent
// implementation — #327 hardened `isSteadiiSelfSender` to handle the
// "Name <email>" display form and added the `isSteadiiSelfSenderName`
// from-name fallback (digest from-name "Steadii Agent — …"). Keeping that
// exact behavior is intentional: switching to bare exact-match would MISS
// the real digest from-name (which carries a subject suffix) and would
// regress tests/ingest-recent-self-filter.test.ts.
import type { RetrievalProvenance } from "@/lib/db/schema";

// Steadii's own outbound senders. The .xyz suffix is the legacy domain
// retained for backward compat with rows ingested before the .com cutover;
// once a sweep confirms no live mail is sent from .xyz it can be dropped.
export const SELF_SENDER_DOMAINS = ["@mysteadii.com", "@mysteadii.xyz"] as const;

// Canonical from-name prefix Steadii sends digests under (see
// lib/integrations/resend/client.ts getFromAddress → "Steadii Agent").
// Matched as a prefix so subject-suffixed names ("Steadii Agent — Morning
// Digest") still resolve as self.
export const SELF_SENDER_NAME_PREFIX = "steadii agent";

export function isSteadiiSelfSender(
  senderEmail: string | null | undefined
): boolean {
  if (!senderEmail) return false;
  const normalized = senderEmail.trim().toLowerCase();
  // Accept the "Name <email>" display form: when the value carries a
  // bracketed address, test what's inside the brackets. The bare-email
  // path still falls through to the endsWith check below.
  const bracketed = normalized.match(/<([^>]*)>/);
  const candidate = bracketed ? bracketed[1].trim() : normalized;
  return SELF_SENDER_DOMAINS.some((domain) => candidate.endsWith(domain));
}

// Name-based fallback for rows whose sender email is null/odd (or rewritten
// by an intermediate relay) but whose from-name clearly identifies Steadii's
// own agent. Our digest from-name is "Steadii Agent" (optionally with a
// subject suffix), so a prefix match is the correct shape — NOT exact match,
// which would miss the suffixed digest names.
export function isSteadiiSelfSenderName(
  senderName: string | null | undefined
): boolean {
  if (!senderName) return false;
  return senderName.trim().toLowerCase().startsWith(SELF_SENDER_NAME_PREFIX);
}

// PURE provenance scrubber — drops `type:"email"` sources whose inbox_item id
// is in the self-sender set, leaving every other source (non-email, and email
// sources NOT in the set) untouched. Recomputes `returned` from the remaining
// email sources; all other provenance fields are passed through unchanged.
// Idempotent: re-running on already-scrubbed provenance returns removed:0.
export function scrubSelfSenderEmailSourcesFromProvenance(
  prov: RetrievalProvenance | null,
  selfSenderInboxItemIds: Set<string>
): { provenance: RetrievalProvenance | null; removed: number } {
  if (!prov) return { provenance: null, removed: 0 };
  const sources = prov.sources ?? [];
  const kept = sources.filter(
    (s) => !(s.type === "email" && selfSenderInboxItemIds.has(s.id))
  );
  const removed = sources.length - kept.length;
  const returned = kept.filter((s) => s.type === "email").length;
  return {
    provenance: {
      ...prov,
      sources: kept,
      returned,
    },
    removed,
  };
}

// Pure resolver for the inbox-detail route's id-type ambiguity.
//
// The route param `[id]` historically only ever resolved as an
// agent_drafts.id. But several surfaces deep-link here with an
// inbox_items.id instead (e.g. the Type G auto-cal "元のメール" source
// chip, the entity-graph lookup's inbox_item/agent_draft refs, and the
// "how your agent thinks" provenance list). An inbox_item id never
// matches a draft id, so the old draft-only lookup hit notFound() and
// the link errored.
//
// This helper is the pure decision layer the async page dispatches on:
// given which lookups returned a row (and whether the inbox row is
// soft-deleted), it returns the render mode. Extracting it keeps the
// branch logic deterministically testable without a DB / RSC harness.

export type InboxDetailMode =
  | { kind: "draft" }
  | { kind: "email_only" }
  | { kind: "unavailable" }
  | { kind: "not_found" };

export function resolveInboxDetailMode(args: {
  // A draft (+ its joined inbox row) matched `id`.
  hasDraft: boolean;
  // An inbox_item matched `id` (when no draft did). null = not looked
  // up / no row at all.
  inboxItem: { deletedAt: Date | null } | null;
}): InboxDetailMode {
  if (args.hasDraft) return { kind: "draft" };
  if (args.inboxItem) {
    // Soft-deleted source mail (e.g. swept by the self-sender backfill):
    // the chip is still live but the email is gone. Render a calm
    // "unavailable" state rather than a hard 404.
    if (args.inboxItem.deletedAt) return { kind: "unavailable" };
    return { kind: "email_only" };
  }
  return { kind: "not_found" };
}

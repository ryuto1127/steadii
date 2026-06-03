import { describe, expect, it } from "vitest";

import { resolveInboxDetailMode } from "@/app/app/inbox/[id]/resolve-mode";

// The inbox-detail route's `[id]` param can be EITHER an agent_drafts.id
// (the historical case) OR an inbox_items.id (the Type G auto-cal source
// chip, entity-graph lookups, provenance list). This covers the pure
// branch that decides which view the async page renders. No DB / network.
//
// All synthetic — no real ids, senders, or subjects (AGENTS.md §7a).

describe("resolveInboxDetailMode", () => {
  it("renders the draft view when a draft matched the id", () => {
    expect(
      resolveInboxDetailMode({ hasDraft: true, inboxItem: null })
    ).toEqual({ kind: "draft" });
  });

  it("prefers the draft view even if an inbox row would also match", () => {
    // Defensive: a draft id can never equal an inbox_item id, so this
    // case is theoretical, but the resolver must not regress to email-only.
    expect(
      resolveInboxDetailMode({
        hasDraft: true,
        inboxItem: { deletedAt: null },
      })
    ).toEqual({ kind: "draft" });
  });

  it("falls back to the email-only view when only an inbox_item matched", () => {
    expect(
      resolveInboxDetailMode({
        hasDraft: false,
        inboxItem: { deletedAt: null },
      })
    ).toEqual({ kind: "email_only" });
  });

  it("renders the calm unavailable state for a soft-deleted inbox_item", () => {
    expect(
      resolveInboxDetailMode({
        hasDraft: false,
        inboxItem: { deletedAt: new Date("2026-06-01T00:00:00Z") },
      })
    ).toEqual({ kind: "unavailable" });
  });

  it("404s when neither a draft nor an inbox_item matched", () => {
    expect(
      resolveInboxDetailMode({ hasDraft: false, inboxItem: null })
    ).toEqual({ kind: "not_found" });
  });
});

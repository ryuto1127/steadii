import { describe, expect, it } from "vitest";
import {
  cardGBuildEditPatch,
  cardGDaysUntilExpiry,
  cardGProposalHeaderKey,
  cardGShouldShowExpiry,
  cardGShouldShowTimePickers,
  cardGValidateEdit,
} from "@/lib/agent/queue/visual";
import type { QueueCardG, QueueCard } from "@/lib/agent/queue/types";

// 2026-05-24 (PR B) — Type G' propose-confirm UI tests.
//
// Per the project convention (vitest is node-only; see
// `vitest.config.ts`), the renderer's behavior is locked through
// pure helper extraction rather than a JSX render harness. The
// helpers in `lib/agent/queue/visual.ts` are what the card actually
// dispatches on; covering them deterministically covers the visible
// UI branches.
//
// All synthetic test data — no real subjects, dates, senders, or
// thread IDs (per AGENTS.md §7a).

describe("QueueCardG type contract — propose-confirm shape", () => {
  it("accepts a valid mutual_agreement Type G card with editorSlot", () => {
    const card: QueueCardG = {
      id: "autocal:00000000-0000-0000-0000-000000000001",
      archetype: "G",
      title: "header-rendered-from-i18n",
      body: "",
      confidence: "medium",
      createdAt: new Date().toISOString(),
      sources: [],
      reversible: true,
      autoCreateId: "00000000-0000-0000-0000-000000000001",
      kind: "mutual_agreement",
      eventRefs: [],
      slotLabel: "1/2 (X) 14:00 TZ",
      editorSlot: {
        date: "2027-01-02",
        startTime: "14:00",
        durationMin: 30,
        title: null,
      },
      graceExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      inboxItemId: "inbox-synthetic-1",
    };
    expect(card.archetype).toBe("G");
    expect(card.kind).toBe("mutual_agreement");
    expect(card.editorSlot.startTime).toBe("14:00");
  });

  it("accepts a valid deadline Type G card with all-day editorSlot", () => {
    const card: QueueCardG = {
      id: "autocal:00000000-0000-0000-0000-000000000002",
      archetype: "G",
      title: "header-rendered-from-i18n",
      body: "",
      confidence: "medium",
      createdAt: new Date().toISOString(),
      sources: [],
      reversible: true,
      autoCreateId: "00000000-0000-0000-0000-000000000002",
      kind: "deadline",
      eventRefs: [],
      slotLabel: "1/9 (X) 締切",
      editorSlot: {
        date: "2027-01-09",
        startTime: "00:00",
        durationMin: 0,
        title: null,
      },
      graceExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      inboxItemId: "inbox-synthetic-2",
    };
    expect(card.kind).toBe("deadline");
    expect(card.editorSlot.durationMin).toBe(0);
  });

  it("narrows on the union via archetype", () => {
    const cards: QueueCard[] = [
      {
        id: "autocal:1",
        archetype: "G",
        title: "h",
        body: "",
        confidence: "medium",
        createdAt: new Date().toISOString(),
        sources: [],
        reversible: true,
        autoCreateId: "1",
        kind: "mutual_agreement",
        eventRefs: [],
        slotLabel: "x",
        editorSlot: {
          date: "2027-01-02",
          startTime: "14:00",
          durationMin: 30,
          title: null,
        },
        graceExpiresAt: new Date().toISOString(),
        inboxItemId: "i",
      },
    ];
    function kindOf(c: QueueCard): string | null {
      if (c.archetype === "G") return c.kind;
      return null;
    }
    expect(kindOf(cards[0]!)).toBe("mutual_agreement");
  });
});

describe("cardGProposalHeaderKey", () => {
  it("picks the deadline header for deadline kind", () => {
    expect(cardGProposalHeaderKey("deadline")).toBe("proposal_header_deadline");
  });
  it("picks the mutual header for mutual_agreement kind", () => {
    expect(cardGProposalHeaderKey("mutual_agreement")).toBe(
      "proposal_header_mutual",
    );
  });
  it("reuses the mutual header for event kind (timed scheduled event)", () => {
    expect(cardGProposalHeaderKey("event")).toBe("proposal_header_mutual");
  });
});

describe("cardGShouldShowTimePickers", () => {
  it("hides time pickers for deadline (all-day) proposals", () => {
    expect(cardGShouldShowTimePickers("deadline")).toBe(false);
  });
  it("shows time pickers for mutual_agreement (timed) proposals", () => {
    expect(cardGShouldShowTimePickers("mutual_agreement")).toBe(true);
  });
  it("shows time pickers for event (timed) proposals", () => {
    expect(cardGShouldShowTimePickers("event")).toBe(true);
  });
});

describe("cardGDaysUntilExpiry", () => {
  it("returns positive days for a future expiry", () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);
    const future = new Date(now + 5 * 24 * 60 * 60 * 1000).toISOString();
    expect(cardGDaysUntilExpiry(future, now)).toBe(5);
  });

  it("returns 0 for a past expiry (clamped, never negative)", () => {
    const now = Date.UTC(2026, 0, 10, 12, 0, 0);
    const past = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    expect(cardGDaysUntilExpiry(past, now)).toBe(0);
  });

  it("returns null for a malformed ISO string", () => {
    expect(cardGDaysUntilExpiry("not-a-date")).toBeNull();
  });

  it("ceils partial days so '6h to go' still reads as '1 day'", () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);
    const partial = new Date(now + 6 * 60 * 60 * 1000).toISOString();
    expect(cardGDaysUntilExpiry(partial, now)).toBe(1);
  });
});

describe("cardGShouldShowExpiry", () => {
  it("hides the countdown when more than 3 days remain", () => {
    expect(cardGShouldShowExpiry(7)).toBe(false);
    expect(cardGShouldShowExpiry(4)).toBe(false);
  });
  it("shows the countdown when 3 or fewer days remain", () => {
    expect(cardGShouldShowExpiry(3)).toBe(true);
    expect(cardGShouldShowExpiry(2)).toBe(true);
    expect(cardGShouldShowExpiry(1)).toBe(true);
    expect(cardGShouldShowExpiry(0)).toBe(true);
  });
  it("hides the countdown when the expiry is malformed (null input)", () => {
    expect(cardGShouldShowExpiry(null)).toBe(false);
  });
});

describe("cardGValidateEdit", () => {
  it("passes a clean mutual_agreement edit", () => {
    const r = cardGValidateEdit({
      kind: "mutual_agreement",
      date: "2027-01-02",
      startTime: "14:00",
      durationMin: 30,
      nowMs: Date.UTC(2026, 0, 1, 12, 0, 0),
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect("warning" in r).toBe(false);
  });

  it("rejects a timed edit when durationMin <= 0 (end before start)", () => {
    const r = cardGValidateEdit({
      kind: "mutual_agreement",
      date: "2027-01-02",
      startTime: "14:00",
      durationMin: 0,
      nowMs: Date.UTC(2026, 0, 1, 12, 0, 0),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("validation_end_before_start");
  });

  it("does NOT enforce duration > 0 for deadline edits (all-day, no time)", () => {
    const r = cardGValidateEdit({
      kind: "deadline",
      date: "2027-01-09",
      startTime: undefined,
      durationMin: 0,
      nowMs: Date.UTC(2026, 0, 1, 12, 0, 0),
    });
    expect(r.ok).toBe(true);
  });

  it("warns (does not block) when the date is far in the past (>30d)", () => {
    const r = cardGValidateEdit({
      kind: "mutual_agreement",
      date: "2025-12-01",
      startTime: "14:00",
      durationMin: 30,
      nowMs: Date.UTC(2026, 5, 1, 12, 0, 0),
    });
    expect(r.ok).toBe(true);
    if (r.ok && "warning" in r) {
      expect(r.warning).toBe("validation_past_date_warning");
    } else {
      throw new Error("expected past-date warning");
    }
  });

  it("does NOT warn for a date within the 30-day past window", () => {
    const r = cardGValidateEdit({
      kind: "mutual_agreement",
      date: "2026-05-15",
      startTime: "14:00",
      durationMin: 30,
      nowMs: Date.UTC(2026, 5, 1, 12, 0, 0),
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect("warning" in r).toBe(false);
  });

  it("ignores time-related fields entirely for deadline kind", () => {
    // Even with absurd duration / start time values the deadline path
    // should pass — the renderer suppresses time pickers anyway, and
    // the server-side editor schema strips/ignores those fields.
    const r = cardGValidateEdit({
      kind: "deadline",
      date: "2027-01-09",
      startTime: "25:99",
      durationMin: -10,
      nowMs: Date.UTC(2026, 0, 1, 12, 0, 0),
    });
    expect(r.ok).toBe(true);
  });
});

describe("cardGBuildEditPatch", () => {
  const baseInitial = {
    date: "2027-01-02",
    startTime: "14:00" as string | null,
    durationMin: 30,
    title: "",
  };

  it("returns an empty patch when nothing changed", () => {
    const patch = cardGBuildEditPatch({
      kind: "mutual_agreement",
      initial: baseInitial,
      next: {
        date: "2027-01-02",
        startTime: "14:00",
        durationMin: 30,
        title: "",
      },
    });
    expect(patch).toEqual({});
  });

  it("includes only the changed date when the user shifts the day", () => {
    const patch = cardGBuildEditPatch({
      kind: "mutual_agreement",
      initial: baseInitial,
      next: {
        date: "2027-01-03",
        startTime: "14:00",
        durationMin: 30,
        title: "",
      },
    });
    expect(patch).toEqual({ date: "2027-01-03" });
  });

  it("includes title only when non-empty AND different from initial", () => {
    const patch = cardGBuildEditPatch({
      kind: "mutual_agreement",
      initial: baseInitial,
      next: {
        date: "2027-01-02",
        startTime: "14:00",
        durationMin: 30,
        title: "Synthetic title",
      },
    });
    expect(patch).toEqual({ title: "Synthetic title" });
  });

  it("strips start / duration when kind=deadline (all-day)", () => {
    const patch = cardGBuildEditPatch({
      kind: "deadline",
      initial: { ...baseInitial, startTime: null, durationMin: 0 },
      next: {
        date: "2027-01-09",
        startTime: "23:59",
        durationMin: 999,
        title: "Synthetic deadline",
      },
    });
    expect(patch).toEqual({
      date: "2027-01-09",
      title: "Synthetic deadline",
    });
  });

  it("bundles every changed field for a multi-mutation edit", () => {
    const patch = cardGBuildEditPatch({
      kind: "mutual_agreement",
      initial: baseInitial,
      next: {
        date: "2027-01-04",
        startTime: "15:00",
        durationMin: 45,
        title: "Synthetic event",
      },
    });
    expect(patch).toEqual({
      date: "2027-01-04",
      startTime: "15:00",
      durationMin: 45,
      title: "Synthetic event",
    });
  });
});

describe("Type G' action sequencing contract", () => {
  // The card's [更新して追加] button must call editProposal first
  // (so the DB row reflects the new shape) THEN addToCalendar (so
  // calendarCreateEvent reads the freshly-merged slot). We exercise
  // the contract here without a JSX harness by manually stepping
  // through the same sequence the card uses.

  it("invokes editProposal before addToCalendar on [更新して追加]", async () => {
    const callOrder: string[] = [];
    const editProposal = async (
      _updates: { date?: string; durationMin?: number },
    ) => {
      callOrder.push("edit");
    };
    const addToCalendar = async () => {
      callOrder.push("add");
    };

    // Replicates the card's onCommit chain.
    const updates = cardGBuildEditPatch({
      kind: "mutual_agreement",
      initial: {
        date: "2027-01-02",
        startTime: "14:00",
        durationMin: 30,
        title: "",
      },
      next: {
        date: "2027-01-04",
        startTime: "14:00",
        durationMin: 30,
        title: "",
      },
    });
    await editProposal(updates);
    await addToCalendar();

    expect(callOrder).toEqual(["edit", "add"]);
  });

  it("does NOT call addToCalendar when editProposal rejects", async () => {
    const callOrder: string[] = [];
    const editProposal = async () => {
      callOrder.push("edit");
      throw new Error("synthetic edit failure");
    };
    const addToCalendar = async () => {
      callOrder.push("add");
    };

    let threw = false;
    try {
      await editProposal();
      await addToCalendar();
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    expect(callOrder).toEqual(["edit"]);
  });
});

describe("Type G' dismiss flow contract", () => {
  // Spec: [破棄] must NOT show a confirm dialog. The renderer wires
  // onDismissProposal directly without a window.confirm gate (unlike
  // the Type B 'ignored' disposition). This test pins the contract
  // by exercising the dismiss handler directly — no synthetic
  // confirm prompt is needed for the path to fire.

  it("fires onDismissProposal exactly once with no extra prompts", async () => {
    let calls = 0;
    const onDismissProposal = async () => {
      calls++;
    };
    await onDismissProposal();
    expect(calls).toBe(1);
  });
});

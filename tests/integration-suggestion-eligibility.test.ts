import { describe, it, expect, beforeEach, vi } from "vitest";

// Capture the underlying source state the eligibility check reads. Mocked
// before importing the module so the dynamic import below picks it up.
const state = {
  connected: false,
  dismissals: 0,
  recentImpression: null as Date | null,
  selectCount: 0,
};

vi.mock("@/lib/db/client", () => {
  // Minimal Drizzle chain that returns whatever the test wired up. The
  // eligibility helper does three queries: connected? dismissals? recent
  // impression? — we route by the first table inspected.
  const chain = (rows: unknown[]) => {
    const promise = Promise.resolve(rows);
    const c: Record<string, unknown> = {
      from: () => c,
      where: () => c,
      orderBy: () => c,
      limit: () => c,
      then: promise.then.bind(promise),
      catch: promise.catch.bind(promise),
      finally: promise.finally.bind(promise),
    };
    return c;
  };

  return {
    db: {
      select: () => {
        // We mock isSourceConnected separately, so only the dismissal
        // count + recent-impression queries land here. Counter lives on
        // shared `state` so the beforeEach hook can reset it.
        state.selectCount += 1;
        if (state.selectCount === 1) {
          return chain([{ value: state.dismissals }]);
        }
        return chain(
          state.recentImpression
            ? [{ shownAt: state.recentImpression }]
            : []
        );
      },
    },
  };
});

vi.mock("@/lib/integrations/suggestions/sources", async () => {
  // Bypass the real isSourceConnected DB shape; tests drive the connected
  // bit directly via state.connected.
  return {
    INTEGRATION_SOURCES: [],
    isSourceConnected: async () => state.connected,
  };
});

import {
  checkSuggestionEligibility,
  SUGGESTION_DISMISSAL_LIMIT,
  SUGGESTION_IMPRESSION_COOLDOWN_DAYS,
} from "@/lib/integrations/suggestions/eligibility";

beforeEach(() => {
  state.connected = false;
  state.dismissals = 0;
  state.recentImpression = null;
  state.selectCount = 0;
});

describe("checkSuggestionEligibility", () => {
  it("returns already_connected when the source is linked", async () => {
    state.connected = true;
    const r = await checkSuggestionEligibility("u1", "microsoft");
    expect(r).toEqual({ eligible: false, reason: "already_connected" });
  });

  it("returns dismissed_permanently after the dismissal limit", async () => {
    state.dismissals = SUGGESTION_DISMISSAL_LIMIT;
    const r = await checkSuggestionEligibility("u1", "microsoft");
    expect(r).toEqual({ eligible: false, reason: "dismissed_permanently" });
  });

  it("returns in_cooldown_window when shown within the last N days", async () => {
    state.recentImpression = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const r = await checkSuggestionEligibility("u1", "microsoft");
    expect(r).toEqual({ eligible: false, reason: "in_cooldown_window" });
  });

  it("returns eligible when no signal blocks it", async () => {
    state.recentImpression = new Date(
      Date.now() -
        (SUGGESTION_IMPRESSION_COOLDOWN_DAYS + 1) * 24 * 60 * 60 * 1000
    );
    // The select chain only returns rows within the cooldown window per the
    // gte filter, so this won't surface as a recent impression.
    state.recentImpression = null;
    const r = await checkSuggestionEligibility("u1", "microsoft");
    expect(r).toEqual({ eligible: true, reason: "eligible" });
  });
});

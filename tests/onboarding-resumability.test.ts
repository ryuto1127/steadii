import { describe, expect, it, beforeEach, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  env: () => ({
    DATABASE_URL: "postgres://test",
  }),
}));

// In-memory user rows keyed by id.
const store = new Map<string, { onboardingStep: number }>();
let updateCalls: Array<{ onboardingStep: number; updatedAt: Date }> = [];

vi.mock("@/lib/db/client", () => {
  const chain = (result: unknown) => {
    const resolved = Promise.resolve(result);
    const c: Record<string, unknown> = {
      from: () => c,
      where: (_cond: unknown) => c,
      limit: () => c,
      then: resolved.then.bind(resolved),
      catch: resolved.catch.bind(resolved),
      finally: resolved.finally.bind(resolved),
    };
    return c;
  };
  return {
    db: {
      select: (_fields: unknown) => {
        const row = [...store.values()][0] ?? null;
        return chain(row ? [{ current: row.onboardingStep }] : []);
      },
      update: () => ({
        set: (patch: { onboardingStep: number; updatedAt: Date }) => ({
          where: async () => {
            updateCalls.push(patch);
            const row = [...store.values()][0];
            if (row) row.onboardingStep = patch.onboardingStep;
          },
        }),
      }),
    },
  };
});

import {
  stepFromStatus,
  persistOnboardingStep,
  getPersistedOnboardingStep,
} from "@/lib/onboarding/progress";

describe("onboarding resumability (Phase 6 step order)", () => {
  beforeEach(() => {
    store.clear();
    store.set("u1", { onboardingStep: 0 });
    updateCalls = [];
  });

  describe("stepFromStatus", () => {
    it("starts at step 1 (Google) when nothing is connected", () => {
      expect(
        stepFromStatus({
          notionConnected: false,
          notionSetupComplete: false,
          calendarConnected: false,
          gmailConnected: false,
          integrationsStepCompleted: false,
          waitStepCompleted: false,
        })
      ).toBe(1);
    });

    it("stays on step 1 when only calendar scope is granted (pre-Gmail user)", () => {
      expect(
        stepFromStatus({
          notionConnected: false,
          notionSetupComplete: false,
          calendarConnected: true,
          gmailConnected: false,
          integrationsStepCompleted: false,
          waitStepCompleted: false,
        })
      ).toBe(1);
    });

    it("advances to step 2 (Notion, optional) after Google is fully connected", () => {
      expect(
        stepFromStatus({
          notionConnected: false,
          notionSetupComplete: false,
          calendarConnected: true,
          gmailConnected: true,
          integrationsStepCompleted: true,
          waitStepCompleted: false,
        })
      ).toBe(2);
    });

    it("skips past step 2 when the user has advanced persistedStep (Notion skipped)", () => {
      // persistedStep >= 2 means the Notion screen was seen or explicitly skipped.
      expect(
        stepFromStatus(
          {
            notionConnected: false,
            notionSetupComplete: false,
            calendarConnected: true,
            gmailConnected: true,
          integrationsStepCompleted: true,
            waitStepCompleted: false,
          },
          4
        )
      ).toBe(4);
    });

    it("advances to step 3 (auto-setup) after Notion is connected", () => {
      expect(
        stepFromStatus({
          notionConnected: true,
          notionSetupComplete: false,
          calendarConnected: true,
          gmailConnected: true,
          integrationsStepCompleted: true,
          waitStepCompleted: false,
        })
      ).toBe(3);
    });

    it("lands on step 4 (resources) after setup completes", () => {
      expect(
        stepFromStatus({
          notionConnected: true,
          notionSetupComplete: true,
          calendarConnected: true,
          gmailConnected: true,
          integrationsStepCompleted: true,
          waitStepCompleted: false,
        })
      ).toBe(4);
    });
  });

  describe("persistOnboardingStep", () => {
    it("advances the saved step forward", async () => {
      await persistOnboardingStep("u1", 2);
      expect(store.get("u1")?.onboardingStep).toBe(2);
      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0].onboardingStep).toBe(2);
    });

    it("does not regress a user who flipped back in the URL", async () => {
      store.set("u1", { onboardingStep: 3 });
      await persistOnboardingStep("u1", 1);
      expect(store.get("u1")?.onboardingStep).toBe(3);
      expect(updateCalls).toHaveLength(0);
    });

    it("is a no-op when attempting to persist the same step", async () => {
      store.set("u1", { onboardingStep: 2 });
      await persistOnboardingStep("u1", 2);
      expect(updateCalls).toHaveLength(0);
    });
  });

  describe("getPersistedOnboardingStep", () => {
    it("returns 1 when onboardingStep is 0 (fresh user)", async () => {
      store.set("u1", { onboardingStep: 0 });
      expect(await getPersistedOnboardingStep("u1")).toBe(1);
    });

    it("round-trips a persisted step", async () => {
      store.set("u1", { onboardingStep: 3 });
      expect(await getPersistedOnboardingStep("u1")).toBe(3);
    });

    it("clamps values above 4 back to 4", async () => {
      store.set("u1", { onboardingStep: 99 });
      expect(await getPersistedOnboardingStep("u1")).toBe(4);
    });
  });
});

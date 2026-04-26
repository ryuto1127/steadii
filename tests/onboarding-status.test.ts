import { describe, expect, it } from "vitest";
import { isOnboardingComplete } from "@/lib/onboarding/is-complete";

describe("isOnboardingComplete (Phase 6 — Notion optional)", () => {
  it("requires Gmail scope", () => {
    expect(
      isOnboardingComplete({
        notionConnected: false,
        notionSetupComplete: false,
        calendarConnected: true,
        gmailConnected: false,
        integrationsStepCompleted: true,
      })
    ).toBe(false);
  });

  it("requires calendar scope", () => {
    expect(
      isOnboardingComplete({
        notionConnected: false,
        notionSetupComplete: false,
        calendarConnected: false,
        gmailConnected: true,
        integrationsStepCompleted: true,
      })
    ).toBe(false);
  });

  it("does NOT require Notion", () => {
    // Notion is optional in Phase 6; only Google connection matters.
    expect(
      isOnboardingComplete({
        notionConnected: false,
        notionSetupComplete: false,
        calendarConnected: true,
        gmailConnected: true,
        integrationsStepCompleted: true,
      })
    ).toBe(true);
  });

  it("is complete when Google is fully connected, with or without Notion", () => {
    expect(
      isOnboardingComplete({
        notionConnected: true,
        notionSetupComplete: true,
        calendarConnected: true,
        gmailConnected: true,
        integrationsStepCompleted: true,
      })
    ).toBe(true);
  });

  // Phase 7 W-Integrations — onboarding now also requires Step 2 (the
  // optional-integrations skip-once page) to have been resolved. Skipping
  // counts as resolution; so does linking any of the optional sources.
  it("is incomplete when integrations step has not been resolved", () => {
    expect(
      isOnboardingComplete({
        notionConnected: false,
        notionSetupComplete: false,
        calendarConnected: true,
        gmailConnected: true,
        integrationsStepCompleted: false,
      })
    ).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { isOnboardingComplete } from "@/lib/onboarding/is-complete";

describe("isOnboardingComplete (Wave 2 — three-step flow)", () => {
  it("requires Gmail scope", () => {
    expect(
      isOnboardingComplete({
        notionConnected: false,
        notionSetupComplete: false,
        calendarConnected: true,
        gmailConnected: false,
        integrationsStepCompleted: true,
        waitStepCompleted: true,
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
        waitStepCompleted: true,
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
        waitStepCompleted: true,
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
        waitStepCompleted: true,
      })
    ).toBe(true);
  });

  it("is incomplete when integrations step has not been resolved", () => {
    expect(
      isOnboardingComplete({
        notionConnected: false,
        notionSetupComplete: false,
        calendarConnected: true,
        gmailConnected: true,
        integrationsStepCompleted: false,
        waitStepCompleted: true,
      })
    ).toBe(false);
  });

  // Wave 2 — the wait/commitment step (Step 3) is the final gate.
  // Without dismissing it, isOnboardingComplete must return false even
  // if Google + integrations are both squared away.
  it("is incomplete when the Step 3 wait screen has not been dismissed", () => {
    expect(
      isOnboardingComplete({
        notionConnected: false,
        notionSetupComplete: false,
        calendarConnected: true,
        gmailConnected: true,
        integrationsStepCompleted: true,
        waitStepCompleted: false,
      })
    ).toBe(false);
  });
});

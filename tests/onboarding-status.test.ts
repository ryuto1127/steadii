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
      })
    ).toBe(true);
  });
});

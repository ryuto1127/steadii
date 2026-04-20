import { describe, expect, it } from "vitest";
import { isOnboardingComplete } from "@/lib/onboarding/is-complete";

describe("isOnboardingComplete", () => {
  it("requires Notion connection", () => {
    expect(
      isOnboardingComplete({
        notionConnected: false,
        notionSetupComplete: false,
        calendarConnected: true,
      })
    ).toBe(false);
  });

  it("requires Notion setup", () => {
    expect(
      isOnboardingComplete({
        notionConnected: true,
        notionSetupComplete: false,
        calendarConnected: true,
      })
    ).toBe(false);
  });

  it("requires calendar scope", () => {
    expect(
      isOnboardingComplete({
        notionConnected: true,
        notionSetupComplete: true,
        calendarConnected: false,
      })
    ).toBe(false);
  });

  it("is complete when all three are true", () => {
    expect(
      isOnboardingComplete({
        notionConnected: true,
        notionSetupComplete: true,
        calendarConnected: true,
      })
    ).toBe(true);
  });
});

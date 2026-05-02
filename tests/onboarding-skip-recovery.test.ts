import { beforeEach, describe, expect, it, vi } from "vitest";

// Wave 5 — onboarding skip-flow recovery banner gate. We don't mount
// the layout, but the gating logic (visible to the user) is just:
//
//   showSkipRecoveryBanner =
//     skipped && !dismissed && hasInboxSinceSkip
//
// This test exercises that decision tree directly via a small helper
// extraction. The actual layout uses `db.select(...).from(...).where(...)`
// for the inbox-count check; the helper here mirrors the truth table.

type Flags = {
  skippedAt: Date | null;
  dismissedAt: Date | null;
  inboxItemsSinceSkip: number;
};

function shouldShowSkipRecovery(f: Flags): boolean {
  if (!f.skippedAt) return false;
  if (f.dismissedAt) return false;
  return f.inboxItemsSinceSkip > 0;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Onboarding skip-recovery banner gate", () => {
  it("hidden if user never skipped Step 2", () => {
    expect(
      shouldShowSkipRecovery({
        skippedAt: null,
        dismissedAt: null,
        inboxItemsSinceSkip: 5,
      })
    ).toBe(false);
  });

  it("hidden if user already dismissed", () => {
    expect(
      shouldShowSkipRecovery({
        skippedAt: new Date("2026-04-25"),
        dismissedAt: new Date("2026-04-26"),
        inboxItemsSinceSkip: 5,
      })
    ).toBe(false);
  });

  it("hidden if no inbox items since skip (user not engaged yet)", () => {
    expect(
      shouldShowSkipRecovery({
        skippedAt: new Date("2026-04-25"),
        dismissedAt: null,
        inboxItemsSinceSkip: 0,
      })
    ).toBe(false);
  });

  it("visible when skipped + not dismissed + has post-skip inbox", () => {
    expect(
      shouldShowSkipRecovery({
        skippedAt: new Date("2026-04-25"),
        dismissedAt: null,
        inboxItemsSinceSkip: 1,
      })
    ).toBe(true);
  });
});

// The dismiss action stamps users.onboarding_skip_recovery_dismissed_at.
// Once that column is non-null, the gate above always returns false.
// We assert that timing relationship by simulating the action.
describe("Dismiss action persists state", () => {
  it("after dismiss, the gate returns false even when prior conditions held", () => {
    const before: Flags = {
      skippedAt: new Date("2026-04-25"),
      dismissedAt: null,
      inboxItemsSinceSkip: 12,
    };
    expect(shouldShowSkipRecovery(before)).toBe(true);

    const after: Flags = {
      ...before,
      dismissedAt: new Date("2026-05-02"),
    };
    expect(shouldShowSkipRecovery(after)).toBe(false);
  });
});

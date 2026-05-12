import { describe, expect, it } from "vitest";
import {
  DEFAULT_NOTIFICATION_TIER_PREFS,
  channelsForArchetype,
  readTierPrefs,
} from "@/lib/notifications/tier-matrix";

// Wave 2 notification tier matrix.
// Spec table (`project_wave_2_home_design.md` § "Notification strategy"):
//
//   | A | push  | digest summary | in-app always |
//   | B | batch | digest         | in-app always |
//   | C | none  | digest weekly  | in-app always |
//   | D | none  | none           | in-app always |
//   | E | none* | none           | in-app always |    *only if blocking
//
// We model the user choice as one tag per archetype: push / digest /
// in_app. The defaults match the spec's right-most column ("most
// helpful default").

describe("readTierPrefs", () => {
  it("returns full defaults when given a null/undefined blob", () => {
    expect(readTierPrefs(null)).toEqual(DEFAULT_NOTIFICATION_TIER_PREFS);
    expect(readTierPrefs(undefined)).toEqual(DEFAULT_NOTIFICATION_TIER_PREFS);
  });

  it("returns full defaults for a blob without the key", () => {
    expect(readTierPrefs({ theme: "dark", locale: "ja" })).toEqual(
      DEFAULT_NOTIFICATION_TIER_PREFS
    );
  });

  it("merges partial overrides on top of the defaults", () => {
    const result = readTierPrefs({
      notificationTiers: { B: "in_app", D: "digest" },
    });
    expect(result).toEqual({
      A: "push", // default kept
      B: "in_app", // overridden
      C: "digest", // default kept
      D: "digest", // overridden
      E: "in_app", // default kept
      F: "in_app", // default kept (engineer-42)
    });
  });

  it("ignores values it doesn't recognise", () => {
    const result = readTierPrefs({
      notificationTiers: { A: "off", B: "push" },
    });
    expect(result.A).toBe("push"); // "off" rejected → default
    expect(result.B).toBe("push"); // valid override accepted
  });
});

describe("channelsForArchetype — defaults", () => {
  const prefs = DEFAULT_NOTIFICATION_TIER_PREFS;

  it("Type A — push fires when web push is enabled, digest doubles up", () => {
    expect(channelsForArchetype("A", prefs, true)).toEqual({
      push: true,
      digest: true,
      inApp: true,
    });
  });

  it("Type A — push falls back to digest only when push is gated off", () => {
    expect(channelsForArchetype("A", prefs, false)).toEqual({
      push: false,
      digest: true,
      inApp: true,
    });
  });

  it("Type B — defaults to digest only", () => {
    expect(channelsForArchetype("B", prefs, true)).toEqual({
      push: false,
      digest: true,
      inApp: true,
    });
  });

  it("Type C — defaults to digest only", () => {
    expect(channelsForArchetype("C", prefs, true)).toEqual({
      push: false,
      digest: true,
      inApp: true,
    });
  });

  it("Type D — defaults to in-app only (no digest, no push)", () => {
    expect(channelsForArchetype("D", prefs, true)).toEqual({
      push: false,
      digest: false,
      inApp: true,
    });
  });

  it("Type E — defaults to in-app only", () => {
    expect(channelsForArchetype("E", prefs, true)).toEqual({
      push: false,
      digest: false,
      inApp: true,
    });
  });
});

describe("channelsForArchetype — user overrides", () => {
  it("respects an in-app-only choice on Type A (no push, no digest)", () => {
    const prefs = readTierPrefs({
      notificationTiers: { A: "in_app" },
    });
    expect(channelsForArchetype("A", prefs, true)).toEqual({
      push: false,
      digest: false,
      inApp: true,
    });
  });

  it("respects an upgrade to push on Type C, with web push enabled", () => {
    const prefs = readTierPrefs({
      notificationTiers: { C: "push" },
    });
    expect(channelsForArchetype("C", prefs, true)).toEqual({
      push: true,
      digest: true,
      inApp: true,
    });
  });

  it("upgrades to digest-only when the user picks push but web push is off", () => {
    const prefs = readTierPrefs({
      notificationTiers: { C: "push" },
    });
    expect(channelsForArchetype("C", prefs, false)).toEqual({
      push: false,
      digest: true,
      inApp: true,
    });
  });

  it("never disables in-app — every archetype always returns inApp:true", () => {
    const prefs = readTierPrefs({
      notificationTiers: {
        A: "in_app",
        B: "in_app",
        C: "in_app",
        D: "in_app",
        E: "in_app",
      },
    });
    for (const arch of ["A", "B", "C", "D", "E"] as const) {
      expect(channelsForArchetype(arch, prefs, false).inApp).toBe(true);
    }
  });
});

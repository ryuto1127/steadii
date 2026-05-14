import { describe, expect, it } from "vitest";
import { computeInferredWindow } from "@/lib/agent/empirical-window";

// engineer-56 — pure-function tests for the empirical-window inference.
// The DB-touching `recordAcceptedSlot` / `getInferredWorkingHours` are
// integration-tested via the gmail-send hook + serialize-context path;
// the math itself lives in computeInferredWindow.

describe("computeInferredWindow", () => {
  it("returns null for < 3 samples", () => {
    expect(computeInferredWindow([])).toBeNull();
    expect(computeInferredWindow(["18:00"])).toBeNull();
    expect(computeInferredWindow(["18:00", "19:00"])).toBeNull();
  });

  it("applies a 30-minute tolerance buffer on both ends", () => {
    const r = computeInferredWindow(["18:00", "19:00", "20:00"]);
    expect(r).not.toBeNull();
    // 18:00 - 30min = 17:30; 20:00 + 30min = 20:30
    expect(r?.start).toBe("17:30");
    expect(r?.end).toBe("20:30");
    expect(r?.sampleCount).toBe(3);
  });

  it("clamps the window to [00:00, 23:59]", () => {
    const r = computeInferredWindow(["00:15", "12:00", "23:30"]);
    expect(r?.start).toBe("00:00");
    expect(r?.end).toBe("23:59");
  });

  it("filters out malformed HH:MM strings", () => {
    const r = computeInferredWindow([
      "18:00",
      "19:00",
      "not a time",
      "26:00",
      "20:00",
    ]);
    expect(r).not.toBeNull();
    expect(r?.sampleCount).toBe(5); // counts all inputs in sampleCount
    expect(r?.start).toBe("17:30");
    expect(r?.end).toBe("20:30");
  });

  it("returns the empirical window for a wider sample set", () => {
    const r = computeInferredWindow([
      "08:00",
      "14:30",
      "21:45",
      "19:00",
      "11:00",
    ]);
    expect(r?.start).toBe("07:30");
    expect(r?.end).toBe("22:15");
  });

  it("returns null when after-filter samples drop below 3", () => {
    // 3 inputs but 2 are garbage → only 1 valid sample → null
    const r = computeInferredWindow(["junk1", "junk2", "19:00"]);
    expect(r).toBeNull();
  });
});

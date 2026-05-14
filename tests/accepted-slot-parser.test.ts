import { describe, expect, it } from "vitest";
import { parseAcceptedSlotFromDraftBody } from "@/lib/agent/email/accepted-slot-parser";

// engineer-56 — best-effort parser for accepted-slot learning. The
// parser is conservative; tests document both the happy path (correct
// extraction) AND the silent-skip path (returns null on ambiguous /
// unsupported input).

describe("parseAcceptedSlotFromDraftBody", () => {
  it("extracts a HH:MM adjacent to a PT marker for America/Vancouver", () => {
    const body =
      "ご提示の候補1（5/14 19:30 PT）で参加可能です。よろしくお願いいたします。";
    expect(
      parseAcceptedSlotFromDraftBody(body, "America/Vancouver")
    ).toBe("19:30");
  });

  it("handles PDT/PST variants", () => {
    expect(
      parseAcceptedSlotFromDraftBody("Slot at 18:00 PDT works.", "America/Vancouver")
    ).toBe("18:00");
    expect(
      parseAcceptedSlotFromDraftBody("Looking at 21:15 PST.", "America/Vancouver")
    ).toBe("21:15");
  });

  it("extracts JST hours when user TZ is Asia/Tokyo", () => {
    expect(
      parseAcceptedSlotFromDraftBody(
        "5月15日(金) 10:30 JST にてお願いいたします。",
        "Asia/Tokyo"
      )
    ).toBe("10:30");
  });

  it("returns null when TZ marker is absent", () => {
    expect(
      parseAcceptedSlotFromDraftBody("Let's meet at 19:30.", "America/Vancouver")
    ).toBeNull();
  });

  it("returns null when no HH:MM is anchored to the user's TZ marker", () => {
    // JST 18:00 mentioned, but user is in Vancouver — the PT side might
    // not be in the body (this would be a MUST-rule 7 violation in
    // prod, but here we're testing parser behavior).
    expect(
      parseAcceptedSlotFromDraftBody(
        "候補1 (5月15日 18:00 JST) でお願いします。",
        "America/Vancouver"
      )
    ).toBeNull();
  });

  it("picks the FIRST anchored slot when multiple are present", () => {
    const body =
      "候補1 (5/14 19:30 PT) を希望、候補2 (5/19 09:00 PT) は二次希望でお願いいたします。";
    expect(
      parseAcceptedSlotFromDraftBody(body, "America/Vancouver")
    ).toBe("19:30");
  });

  it("returns null for empty body or missing TZ", () => {
    expect(
      parseAcceptedSlotFromDraftBody("", "America/Vancouver")
    ).toBeNull();
    expect(
      parseAcceptedSlotFromDraftBody("hello world", null)
    ).toBeNull();
    expect(
      parseAcceptedSlotFromDraftBody("hello world", undefined)
    ).toBeNull();
  });

  it("returns null for unsupported user TZ", () => {
    // Pacific/Auckland isn't in the TZ-token map → silent skip.
    expect(
      parseAcceptedSlotFromDraftBody(
        "Meeting at 14:00 NZST works.",
        "Pacific/Auckland"
      )
    ).toBeNull();
  });

  it("normalizes single-digit hour to padded HH:MM", () => {
    expect(
      parseAcceptedSlotFromDraftBody("Let's do 9:30 PT.", "America/Vancouver")
    ).toBe("09:30");
  });

  it("does not match HH:MM that's far from the TZ marker (proximity guard)", () => {
    // 19:30 is 100+ chars from the PT marker — should NOT match.
    const filler = "x".repeat(200);
    const body = `Meeting at 19:30 — ${filler} — PT timezone confirmed.`;
    expect(
      parseAcceptedSlotFromDraftBody(body, "America/Vancouver")
    ).toBeNull();
  });
});

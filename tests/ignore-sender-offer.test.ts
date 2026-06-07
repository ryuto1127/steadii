import { describe, expect, it } from "vitest";
import {
  IGNORE_OFFER_DISMISS_THRESHOLD,
  shouldOfferIgnoreSender,
} from "@/lib/agent/email/ignore-offer";

// Pure-function coverage for the ≥2-dismiss "ignore this sender?" gate.
// All synthetic — no real senders. See AGENTS.md §7a.

describe("shouldOfferIgnoreSender", () => {
  it("uses a threshold of 2", () => {
    expect(IGNORE_OFFER_DISMISS_THRESHOLD).toBe(2);
  });

  it("does NOT offer on the 1st dismiss (don't nag first-timers)", () => {
    expect(
      shouldOfferIgnoreSender({
        dismissCountIncludingThis: 1,
        alreadyIgnored: false,
      })
    ).toBe(false);
  });

  it("offers on the 2nd dismiss", () => {
    expect(
      shouldOfferIgnoreSender({
        dismissCountIncludingThis: 2,
        alreadyIgnored: false,
      })
    ).toBe(true);
  });

  it("keeps offering on the 3rd+ dismiss", () => {
    expect(
      shouldOfferIgnoreSender({
        dismissCountIncludingThis: 5,
        alreadyIgnored: false,
      })
    ).toBe(true);
  });

  it("never offers when the sender is already ignored", () => {
    expect(
      shouldOfferIgnoreSender({
        dismissCountIncludingThis: 9,
        alreadyIgnored: true,
      })
    ).toBe(false);
  });

  it("treats a zero count as no offer", () => {
    expect(
      shouldOfferIgnoreSender({
        dismissCountIncludingThis: 0,
        alreadyIgnored: false,
      })
    ).toBe(false);
  });
});

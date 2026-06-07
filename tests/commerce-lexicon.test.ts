import { describe, expect, it } from "vitest";

import {
  COMMERCIAL_MARKER_RE,
  DISCOUNT_WORD_RE,
  PRICE_TOKEN_RE,
  PURCHASE_IMPERATIVE_RE,
  hasCommercialMarker,
  hasPurchaseImperative,
} from "@/lib/agent/proactive/commerce-lexicon";

// 2026-06-07 — Shared commerce lexicon. The single source of truth both
// the event detector (OR-gate) and the deadline detector (AND-gate) draw
// from. These tests lock the UNION of what both detectors used so the two
// can't silently drift apart. This module is a lexicon only — it has NO
// gate logic (no OR/AND of the two building blocks); the detectors own
// that. All fixtures SYNTHETIC.

describe("hasPurchaseImperative — building block A", () => {
  it("matches high-intent buy verbs (EN)", () => {
    for (const t of [
      "Order before midnight.",
      "Buy the bundle today.",
      "Shop the new arrivals.",
      "Complete your purchase now.",
      "Proceed to checkout.",
      "Add to cart to continue.",
      "Place your order by Friday.",
    ]) {
      expect(hasPurchaseImperative(t)).toBe(true);
    }
  });

  it("matches high-intent buy verbs (JA)", () => {
    for (const t of [
      "今すぐご注文ください。",
      "ご購入はこちらから。",
      "お買い物を続ける。",
      "カートに追加。",
    ]) {
      expect(hasPurchaseImperative(t)).toBe(true);
    }
  });

  it("subsumes the event detector's old verb+'now' CTA forms", () => {
    // `\bshop\b` covers "shop now"; `ご?購入` covers "購入はこちら".
    expect(hasPurchaseImperative("shop now before it's gone")).toBe(true);
    expect(hasPurchaseImperative("buy now")).toBe(true);
    expect(hasPurchaseImperative("order now")).toBe(true);
  });

  it("does NOT match ambiguous verbs that appear in legit deadlines", () => {
    for (const t of [
      "Register by Friday for the workshop.",
      "Reserve your spot today.",
      "金曜までにお申し込みください。",
      "We're excited to host you.", // no buy verb at all
    ]) {
      expect(hasPurchaseImperative(t)).toBe(false);
    }
  });

  it("does not match buy verbs inside unrelated words", () => {
    // \b guards: "buy" ≠ the "by" in "submit by", "sale" handled in markers.
    expect(hasPurchaseImperative("Please submit by 6/15.")).toBe(false);
    expect(PURCHASE_IMPERATIVE_RE.test("borders and reordering")).toBe(false);
  });
});

describe("hasCommercialMarker — building block B", () => {
  it("matches direct discount / sale / scarcity markers (EN)", () => {
    for (const t of [
      "Save 20% off everything.",
      "Our biggest sale of the year.",
      "An extra discount inside.",
      "Use this coupon at checkout.",
      "Today's best deals.",
      "Enter your promo at the end.",
      "A limited-time offer.",
      "Enjoy free shipping.",
      "Today only — don't miss it.",
      "Guaranteed delivery by Friday.",
    ]) {
      expect(hasCommercialMarker(t)).toBe(true);
    }
  });

  it("matches direct markers (JA) — union of both detectors' sets", () => {
    for (const t of [
      "セール開催中。",
      "割引あり。",
      "クーポンを使う。",
      "送料無料でお届け。",
      "本日限りの特価。",
      "お得な情報。",
      "今だけの特別価格。", // event-origin token
      "お買い得セット。", // event-origin token
    ]) {
      expect(hasCommercialMarker(t)).toBe(true);
    }
  });

  it("counts a $price co-occurring with a discount word (additive branch)", () => {
    // bare "off" / "save" are NOT standalone markers, but "$NN" + a
    // discount word together count.
    expect(hasCommercialMarker("$19 off your first box")).toBe(true);
    expect(hasCommercialMarker("save on your order, boxes from $19")).toBe(true);
    // $price alone is not enough.
    expect(hasCommercialMarker("Buy a box for $19.")).toBe(false);
    // discount word alone (no $price, no direct marker) is not enough.
    expect(hasCommercialMarker("hands off, please")).toBe(false);
  });

  it("does NOT fire on plain prose with no commercial signal", () => {
    expect(hasCommercialMarker("Your appointment is confirmed for Friday.")).toBe(
      false,
    );
    expect(hasCommercialMarker("課題の提出期限は来週です。")).toBe(false);
  });
});

describe("anti-drift — tokens that previously lived in only ONE detector", () => {
  it("recognizes deadline-origin markers the event set used to lack", () => {
    // free shipping / today only / 送料無料 / 本日限り / お得 were
    // deadline-only; now both detectors see them through this module.
    for (const t of [
      "free shipping",
      "today only",
      "送料無料",
      "本日限り",
      "お得",
    ]) {
      expect(hasCommercialMarker(t)).toBe(true);
    }
  });

  it("recognizes event-origin tokens the deadline set used to lack", () => {
    // 今だけ / お買い得 were event-only; 購入はこちら was event-only.
    expect(hasCommercialMarker("今だけ")).toBe(true);
    expect(hasCommercialMarker("お買い得")).toBe(true);
    expect(hasPurchaseImperative("購入はこちら")).toBe(true);
  });
});

describe("lexicon shape — building blocks are independent, no gate baked in", () => {
  it("a bare purchase imperative is NOT a commercial marker", () => {
    // The two building blocks are orthogonal; combining them (OR vs AND)
    // is each detector's job, not the lexicon's.
    expect(hasPurchaseImperative("Order your transcript.")).toBe(true);
    expect(hasCommercialMarker("Order your transcript.")).toBe(false);
  });

  it("a bare commercial marker is NOT a purchase imperative", () => {
    expect(hasCommercialMarker("Everything is 20% off this week.")).toBe(true);
    expect(hasPurchaseImperative("Everything is 20% off this week.")).toBe(false);
  });

  it("exposes the raw regexes for callers that need them", () => {
    expect(COMMERCIAL_MARKER_RE.test("20% off")).toBe(true);
    expect(PRICE_TOKEN_RE.test("$5")).toBe(true);
    expect(DISCOUNT_WORD_RE.test("save")).toBe(true);
  });
});

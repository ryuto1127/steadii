import { describe, expect, it } from "vitest";

import {
  detectDeadlineMention,
  isCommercialDeadlineContext,
} from "@/lib/agent/proactive/deadline-detector";

// 2026-05-21 — Phase 5 of α-auto-cal. The deadline detector must:
//   - Detect strong-pattern deadlines (締切, deadline, due by, 期限)
//   - Suppress on hedge phrases (できれば, if possible)
//   - Suppress on quoted-history mentions (>-prefixed lines)
//   - Boost confidence when subject line also mentions deadline
//
// Conservative: single-sided (inbound only) means higher
// false-positive risk than mutual-agreement, so threshold = 0.85 by
// default in the evaluator.

describe("detectDeadlineMention — positive cases", () => {
  it("detects 締切 with specific date (strong commitment)", () => {
    const r = detectDeadlineMention({
      body: "課題の提出期限は 5/30 までとなります。",
      defaultTimezone: "Asia/Tokyo",
      referenceYear: 2026,
    });
    expect(r.confirmed).toBe(true);
    expect(r.deadline?.date).toBe("2026-05-30");
    expect(r.deadline?.timezone).toBe("Asia/Tokyo");
    expect(r.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("detects EN 'due by' pattern", () => {
    const r = detectDeadlineMention({
      body: "The assignment is due by 6/15. Please submit on time.",
      defaultTimezone: "America/Vancouver",
      referenceYear: 2026,
    });
    expect(r.confirmed).toBe(true);
    expect(r.deadline?.date).toBe("2026-06-15");
  });

  it("detects 期限 phrasing with explicit TZ marker", () => {
    const r = detectDeadlineMention({
      body: "期限: 7/10 JST までに資料を送ってください。",
      defaultTimezone: "Asia/Tokyo",
      referenceYear: 2026,
    });
    expect(r.confirmed).toBe(true);
    expect(r.deadline?.date).toBe("2026-07-10");
    expect(r.deadline?.timezone).toBe("Asia/Tokyo");
  });

  it("boosts confidence when subject also contains deadline keyword", () => {
    const r = detectDeadlineMention({
      body: "詳細は本文の通りです。5/30 までにご対応ください。",
      subject: "【締切のご連絡】 重要",
      defaultTimezone: "Asia/Tokyo",
      referenceYear: 2026,
    });
    expect(r.confirmed).toBe(true);
    // 0.4 (weak by-date) + 0.2 (subject keyword) + 0.1 = 0.7 — but
    // the body's "までに" + 提出 form lifts into strong territory.
    expect(r.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it("uses subject as topic for the calendar event title", () => {
    const r = detectDeadlineMention({
      body: "提出期限は 5/30 です。",
      subject: "Re: PSY100 essay draft 期限のご連絡",
      defaultTimezone: "Asia/Tokyo",
      referenceYear: 2026,
    });
    expect(r.deadline?.topic).toBe("PSY100 essay draft 期限のご連絡");
  });

  it("detects an English long-form deadline with AM/PM + TZ marker", () => {
    const r = detectDeadlineMention({
      body: "Please accept your spot by the deadline of October 14, 2026, 11:00 AM EST.",
      subject: "Northgate College — residence offer",
      defaultTimezone: "America/Vancouver",
      referenceYear: 2026,
    });
    expect(r.confirmed).toBe(true);
    expect(r.deadline?.date).toBe("2026-10-14");
    expect(r.deadline?.timezone).toBe("America/New_York");
  });

  it("detects an abbreviated-month English deadline ('due by Oct 14')", () => {
    const r = detectDeadlineMention({
      body: "The submission deadline is Oct 14, 2026. Please submit on time.",
      defaultTimezone: "America/Vancouver",
      referenceYear: 2026,
    });
    expect(r.confirmed).toBe(true);
    expect(r.deadline?.date).toBe("2026-10-14");
  });

  it("falls back to referenceYear for an English date with no year", () => {
    const r = detectDeadlineMention({
      body: "Reminder: the deadline is October 14. Don't miss it.",
      defaultTimezone: "America/Vancouver",
      referenceYear: 2026,
    });
    expect(r.confirmed).toBe(true);
    expect(r.deadline?.date).toBe("2026-10-14");
  });
});

describe("detectDeadlineMention — suppression cases", () => {
  it("suppresses when phrased as a hedge ('できれば')", () => {
    const r = detectDeadlineMention({
      body: "できれば 5/30 までにご提出いただけると幸いです。",
      defaultTimezone: "Asia/Tokyo",
      referenceYear: 2026,
    });
    expect(r.confirmed).toBe(false);
    expect(r.reasoning).toMatch(/hedge|preference/i);
  });

  it("suppresses 'if possible by' EN hedge", () => {
    const r = detectDeadlineMention({
      body: "If possible, please submit by 5/30. Otherwise next week is also fine.",
      defaultTimezone: "America/Vancouver",
      referenceYear: 2026,
    });
    expect(r.confirmed).toBe(false);
  });

  it("suppresses when deadline appears only in quoted history", () => {
    const r = detectDeadlineMention({
      body: `ご連絡ありがとうございます。

> 前回お送りした通り、提出期限は 5/30 です。

詳細は別途ご連絡します。`,
      defaultTimezone: "Asia/Tokyo",
      referenceYear: 2026,
    });
    expect(r.confirmed).toBe(false);
    expect(r.reasoning).toMatch(/quoted history/);
  });

  it("returns confirmed=false when no deadline keyword appears near any date", () => {
    const r = detectDeadlineMention({
      body: "本日は 5/30 にお会いできて光栄でした。次回もよろしくお願いします。",
      defaultTimezone: "Asia/Tokyo",
      referenceYear: 2026,
    });
    expect(r.confirmed).toBe(false);
  });

  it("returns confirmed=false on empty body", () => {
    const r = detectDeadlineMention({
      body: "",
      defaultTimezone: "Asia/Tokyo",
      referenceYear: 2026,
    });
    expect(r.confirmed).toBe(false);
  });

  it("returns confirmed=false on out-of-range date values", () => {
    const r = detectDeadlineMention({
      body: "締切は 13/45 までとなります。",
      defaultTimezone: "Asia/Tokyo",
      referenceYear: 2026,
    });
    expect(r.confirmed).toBe(false);
  });
});

describe("detectDeadlineMention — multi-date precedence", () => {
  it("prefers the date paired with the strong keyword when multiple dates appear", () => {
    const r = detectDeadlineMention({
      body: "前回お話しした 5/15 の打ち合わせの件、お疲れ様でした。さて、課題の提出期限は 5/30 までとなりますので、お忘れなくお願いします。",
      defaultTimezone: "Asia/Tokyo",
      referenceYear: 2026,
    });
    expect(r.confirmed).toBe(true);
    expect(r.deadline?.date).toBe("2026-05-30");
  });
});

// 2026-06-07 — MARKETING_URGENCY_AS_OBLIGATION. A commercial fake-urgency
// CTA pairs a date with deadline-ish phrasing but is not a personal
// obligation. Require BOTH a purchase imperative AND a commercial marker
// (precision over recall). All fixtures synthetic.
describe("detectDeadlineMention — commercial/marketing suppression", () => {
  it("suppresses an EN promo: purchase verb + % off + free shipping + $price", () => {
    const r = detectDeadlineMention({
      body: "Order by Friday to get 20% off — free shipping over $250. Don't miss this deal.",
      subject: "Last chance: your cart is waiting",
      defaultTimezone: "America/Vancouver",
      referenceYear: 2026,
    });
    expect(r.confirmed).toBe(false);
    expect(r.reasoning).toMatch(/commercial|marketing/i);
  });

  it("suppresses a JA promo: ご注文 + 20%オフ + 送料無料", () => {
    const r = detectDeadlineMention({
      body: "金曜までにご注文で20%オフ・送料無料。期限はお見逃しなく。",
      subject: "本日限りのセール",
      defaultTimezone: "Asia/Tokyo",
      referenceYear: 2026,
    });
    expect(r.confirmed).toBe(false);
    expect(r.reasoning).toMatch(/commercial|marketing/i);
  });

  it("does NOT suppress a real deadline with NO purchase verb ('submit your essay by Friday')", () => {
    const r = detectDeadlineMention({
      // Add a concrete date so the detector has something to bind to;
      // the point is that no purchase imperative is present.
      body: "Please submit your essay by 6/12. The submission deadline is firm.",
      subject: "Essay submission",
      defaultTimezone: "America/Vancouver",
      referenceYear: 2026,
    });
    expect(r.confirmed).toBe(true);
    expect(r.deadline?.date).toBe("2026-06-12");
  });

  it("does NOT suppress a purchase verb WITHOUT a commercial marker ('Order your official transcript by 3/1')", () => {
    const r = detectDeadlineMention({
      body: "Order your official transcript by 3/1. The deadline to request is firm.",
      subject: "Transcript request deadline",
      defaultTimezone: "America/New_York",
      referenceYear: 2026,
    });
    expect(r.confirmed).toBe(true);
    expect(r.deadline?.date).toBe("2026-03-01");
  });
});

describe("isCommercialDeadlineContext — pure guard", () => {
  it("true only when BOTH a purchase imperative and a commercial marker are present", () => {
    expect(
      isCommercialDeadlineContext("Order now and get 20% off today only."),
    ).toBe(true);
    // purchase verb, no commercial marker
    expect(
      isCommercialDeadlineContext("Order your transcript before the deadline."),
    ).toBe(false);
    // commercial marker, no purchase verb
    expect(
      isCommercialDeadlineContext("Everything is 20% off this week."),
    ).toBe(false);
  });

  it("does NOT fire on ambiguous verbs (reserve / register / 申し込み)", () => {
    expect(
      isCommercialDeadlineContext("Register by Friday for the free workshop."),
    ).toBe(false);
    expect(
      isCommercialDeadlineContext("金曜までにお申し込みください。割引あり。"),
    ).toBe(false);
  });

  it("counts a $price co-occurring with a discount word as a commercial marker (additive branch)", () => {
    // "off" alone is NOT a standalone commercial marker (kept out to avoid
    // false positives), but "$19" + "off" together count via the
    // price-near-discount branch, paired with the "buy" purchase verb.
    expect(
      isCommercialDeadlineContext("Buy now — $19 off your first box."),
    ).toBe(true);
    // Same $price with NO discount word is not enough on its own.
    expect(isCommercialDeadlineContext("Buy a box for $19.")).toBe(false);
    // "off" alone, no price, no other marker → not commercial.
    expect(isCommercialDeadlineContext("Buy the deluxe model, hands off.")).toBe(
      false,
    );
  });

  it("reads the subject line too", () => {
    expect(
      isCommercialDeadlineContext("Order before midnight.", "Flash sale: 30% off"),
    ).toBe(true);
  });
});

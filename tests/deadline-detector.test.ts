import { describe, expect, it } from "vitest";

import { detectDeadlineMention } from "@/lib/agent/proactive/deadline-detector";

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

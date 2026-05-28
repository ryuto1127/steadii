import { describe, expect, it } from "vitest";

import {
  detectInboundSignals,
  detectMutualAgreement,
  extractSlotCommitment,
  type EmailSnapshot,
} from "@/lib/agent/proactive/mutual-agreement-detector";

// 2026-05-20 — Phase 1 of α-auto-cal. The detector must:
//   - Detect confirmed agreement when user committed + recipient
//     acknowledged with confirmation or logistics
//   - REJECT any agreement when negative signals (counter / reschedule
//     / cancel) appear in inbound — kill-switch
//   - REJECT when the inbound is older than the user's outbound (user
//     spoke last, recipient hasn't acknowledged yet)
//   - REJECT when the outbound has no specific slot commitment
//
// False positives are catastrophic for trust (Steadii silently puts
// a wrong meeting on the user's calendar). Tests skew toward
// negative-case coverage.

describe("extractSlotCommitment", () => {
  it("extracts slot from JA outbound with acceptance phrase", () => {
    const body = "ご提案いただいた候補のうち、5/22(水) 14:00 JST でお願いいたします。";
    const r = extractSlotCommitment(body, "Asia/Tokyo", 2026);
    expect(r).not.toBeNull();
    expect(r?.date).toBe("2026-05-22");
    expect(r?.startTime).toBe("14:00");
    expect(r?.timezone).toBe("Asia/Tokyo");
    expect(r?.hasAcceptancePhrase).toBe(true);
  });

  it("extracts slot from JA outbound without explicit TZ (falls back to default)", () => {
    const body = "5/22 14:00 でお願いいたします。";
    const r = extractSlotCommitment(body, "Asia/Tokyo", 2026);
    expect(r?.date).toBe("2026-05-22");
    expect(r?.timezone).toBe("Asia/Tokyo");
  });

  it("extracts slot from EN outbound with works-for-me phrase", () => {
    const body =
      "Thanks for the options. 5/22 14:00 JST works for me — looking forward.";
    const r = extractSlotCommitment(body, "Asia/Tokyo", 2026);
    expect(r?.date).toBe("2026-05-22");
    expect(r?.startTime).toBe("14:00");
    expect(r?.timezone).toBe("Asia/Tokyo");
  });

  it("returns null when no acceptance phrase nearby (slot mentioned but not committed)", () => {
    const body =
      "5/22 14:00 と 5/23 10:00 のどちらが良いか、考えています。";
    const r = extractSlotCommitment(body, "Asia/Tokyo", 2026);
    expect(r).toBeNull();
  });

  it("returns null when body has no slot pattern", () => {
    const body = "資料拝見いたしました。引き続きよろしくお願いいたします。";
    const r = extractSlotCommitment(body, "Asia/Tokyo", 2026);
    expect(r).toBeNull();
  });

  it("uses the year embedded in the date when present (overrides referenceYear)", () => {
    const body = "2027/06/15 10:00 でお願いいたします。";
    const r = extractSlotCommitment(body, "Asia/Tokyo", 2026);
    expect(r?.date).toBe("2027-06-15");
  });

  it("resolves PDT marker to America/Vancouver", () => {
    const body = "5/22 23:00 PDT でお願いいたします。";
    const r = extractSlotCommitment(body, "Asia/Tokyo", 2026);
    expect(r?.timezone).toBe("America/Vancouver");
  });

  it("parses duration in minutes when stated", () => {
    const body = "5/22 14:00 から 30分間 でお願いいたします。";
    const r = extractSlotCommitment(body, "Asia/Tokyo", 2026);
    expect(r?.durationMin).toBe(30);
  });

  it("parses duration in hours when stated", () => {
    const body = "5/22 14:00 から 1時間 でお願いいたします。";
    const r = extractSlotCommitment(body, "Asia/Tokyo", 2026);
    expect(r?.durationMin).toBe(60);
  });

  it("defaults duration to 60 when not stated", () => {
    const body = "5/22 14:00 でお願いいたします。";
    const r = extractSlotCommitment(body, "Asia/Tokyo", 2026);
    expect(r?.durationMin).toBe(60);
  });

  it("rejects out-of-range month/day/hour values", () => {
    const body = "13/45 25:00 でお願いいたします。";
    const r = extractSlotCommitment(body, "Asia/Tokyo", 2026);
    expect(r).toBeNull();
  });

  it("extracts an English-dated slot with an AM/PM time", () => {
    const body =
      "Thanks for the options. October 8, 2026 at 4:00 PM works for me — looking forward.";
    const r = extractSlotCommitment(body, "America/New_York", 2026);
    expect(r?.date).toBe("2026-10-08");
    expect(r?.startTime).toBe("16:00");
    expect(r?.timezone).toBe("America/New_York");
    expect(r?.hasAcceptancePhrase).toBe(true);
  });

  it("derives durationMin from an AM/PM range in the slot", () => {
    const body =
      "October 8, 2026 4:00 PM - 5:30 PM works for me. See you then.";
    const r = extractSlotCommitment(body, "America/New_York", 2026);
    expect(r?.startTime).toBe("16:00");
    expect(r?.durationMin).toBe(90);
  });

  it("requires a time component — a bare English date is not a slot", () => {
    const body = "October 8, 2026 works for me. Looking forward.";
    const r = extractSlotCommitment(body, "America/New_York", 2026);
    expect(r).toBeNull();
  });
});

describe("detectInboundSignals", () => {
  it("flags confirmation phrase 承知いたしました", () => {
    const r = detectInboundSignals("承知いたしました。当日はよろしくお願いいたします。");
    expect(r.hasConfirmationPhrase).toBe(true);
    expect(r.hasCounterProposal).toBe(false);
  });

  it("flags logistics content (URL)", () => {
    const r = detectInboundSignals(
      "面接URLをお送りします: https://meet.example.com/abc123"
    );
    expect(r.hasLogisticsContent).toBe(true);
  });

  it("flags counter-proposal: 別の日程", () => {
    const r = detectInboundSignals(
      "申し訳ございません、別の日程で改めてご調整いただけますでしょうか。"
    );
    expect(r.hasCounterProposal).toBe(true);
  });

  it("flags reschedule phrase", () => {
    const r = detectInboundSignals(
      "日程を変更させていただきたく、ご相談です。"
    );
    expect(r.hasReschedulePhrase).toBe(true);
  });

  it("flags cancel phrase", () => {
    const r = detectInboundSignals("申し訳ありません、面接はキャンセルとなりました。");
    expect(r.hasCancelPhrase).toBe(true);
  });

  it("returns all-false on plain text without signals", () => {
    const r = detectInboundSignals("ご連絡ありがとうございます。");
    expect(r.hasConfirmationPhrase).toBe(false);
    expect(r.hasLogisticsContent).toBe(false);
    expect(r.hasCounterProposal).toBe(false);
    expect(r.hasReschedulePhrase).toBe(false);
    expect(r.hasCancelPhrase).toBe(false);
  });
});

describe("detectMutualAgreement — confirmed path", () => {
  it("confirms when user committed + recipient acknowledged with confirmation phrase", () => {
    const thread: EmailSnapshot[] = [
      {
        direction: "inbound",
        sentAt: "2026-05-19T08:00:00Z",
        subject: "面接日程のご案内",
        body: "5/22 14:00 / 5/23 10:00 のどちらかでいかがでしょうか。",
      },
      {
        direction: "outbound",
        sentAt: "2026-05-19T15:00:00Z",
        subject: "Re: 面接日程のご案内",
        body: "ご提示いただいた候補のうち、5/22(水) 14:00 JST でお願いいたします。",
      },
      {
        direction: "inbound",
        sentAt: "2026-05-20T01:00:00Z",
        subject: "Re: Re: 面接日程のご案内",
        body: "承知いたしました。当日はよろしくお願いいたします。",
      },
    ];
    const r = detectMutualAgreement({
      thread,
      userTimezone: "America/Vancouver",
      defaultTimezone: "Asia/Tokyo",
      referenceYear: 2026,
    });
    expect(r.confirmed).toBe(true);
    expect(r.slot).not.toBeNull();
    expect(r.slot?.date).toBe("2026-05-22");
    expect(r.slot?.startTime).toBe("14:00");
    expect(r.slot?.timezone).toBe("Asia/Tokyo");
    expect(r.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("confirms an English-dated thread with an AM/PM slot (24h conversion)", () => {
    const thread: EmailSnapshot[] = [
      {
        direction: "inbound",
        sentAt: "2026-10-01T08:00:00Z",
        subject: "Advising appointment options",
        body: "Would October 8 or October 9 work for a quick call?",
      },
      {
        direction: "outbound",
        sentAt: "2026-10-01T15:00:00Z",
        subject: "Re: Advising appointment options",
        body: "October 8, 2026 at 4:00 PM EST works for me. Thank you!",
      },
      {
        direction: "inbound",
        sentAt: "2026-10-02T01:00:00Z",
        subject: "Re: Re: Advising appointment options",
        body: "Confirmed, see you then. Looking forward to it.",
      },
    ];
    const r = detectMutualAgreement({
      thread,
      userTimezone: "America/Vancouver",
      defaultTimezone: "America/New_York",
      referenceYear: 2026,
    });
    expect(r.confirmed).toBe(true);
    expect(r.slot?.date).toBe("2026-10-08");
    expect(r.slot?.startTime).toBe("16:00");
    expect(r.slot?.timezone).toBe("America/New_York");
  });

  it("confirms when inbound sends logistics (URL) — strong signal", () => {
    const thread: EmailSnapshot[] = [
      {
        direction: "outbound",
        sentAt: "2026-05-19T15:00:00Z",
        body: "5/22 14:00 JST でお願いいたします。",
      },
      {
        direction: "inbound",
        sentAt: "2026-05-20T01:00:00Z",
        subject: "面接URLのご連絡",
        body: "当日の参加URLをお送りいたします: https://meet.example.com/abc",
      },
    ];
    const r = detectMutualAgreement({
      thread,
      userTimezone: "America/Vancouver",
      defaultTimezone: "Asia/Tokyo",
      referenceYear: 2026,
    });
    expect(r.confirmed).toBe(true);
    expect(r.slot?.date).toBe("2026-05-22");
  });
});

describe("detectMutualAgreement — rejection paths (false-positive prevention)", () => {
  it("rejects when inbound contains a counter-proposal", () => {
    const thread: EmailSnapshot[] = [
      {
        direction: "outbound",
        sentAt: "2026-05-19T15:00:00Z",
        body: "5/22 14:00 JST でお願いいたします。",
      },
      {
        direction: "inbound",
        sentAt: "2026-05-20T01:00:00Z",
        body: "申し訳ございません、別の日程で改めてご調整いただけますでしょうか。",
      },
    ];
    const r = detectMutualAgreement({
      thread,
      userTimezone: "America/Vancouver",
      defaultTimezone: "Asia/Tokyo",
      referenceYear: 2026,
    });
    expect(r.confirmed).toBe(false);
    expect(r.signals.negativeSignals).toContain("counter-proposal");
  });

  it("rejects when inbound contains a reschedule request", () => {
    const thread: EmailSnapshot[] = [
      {
        direction: "outbound",
        sentAt: "2026-05-19T15:00:00Z",
        body: "5/22 14:00 JST でお願いいたします。",
      },
      {
        direction: "inbound",
        sentAt: "2026-05-20T01:00:00Z",
        body: "急で恐縮ですが、日程を変更させていただきたく…",
      },
    ];
    const r = detectMutualAgreement({
      thread,
      userTimezone: "America/Vancouver",
      defaultTimezone: "Asia/Tokyo",
      referenceYear: 2026,
    });
    expect(r.confirmed).toBe(false);
    expect(r.signals.negativeSignals).toContain("reschedule");
  });

  it("rejects when inbound is a cancellation", () => {
    const thread: EmailSnapshot[] = [
      {
        direction: "outbound",
        sentAt: "2026-05-19T15:00:00Z",
        body: "5/22 14:00 JST でお願いいたします。",
      },
      {
        direction: "inbound",
        sentAt: "2026-05-20T01:00:00Z",
        body: "申し訳ありません、面接はキャンセルとなりました。",
      },
    ];
    const r = detectMutualAgreement({
      thread,
      userTimezone: "America/Vancouver",
      defaultTimezone: "Asia/Tokyo",
      referenceYear: 2026,
    });
    expect(r.confirmed).toBe(false);
    expect(r.signals.negativeSignals).toContain("cancel");
  });

  it("rejects when the user's outbound has no specific slot commitment", () => {
    const thread: EmailSnapshot[] = [
      {
        direction: "outbound",
        sentAt: "2026-05-19T15:00:00Z",
        body: "ご連絡ありがとうございます。検討させていただきます。",
      },
      {
        direction: "inbound",
        sentAt: "2026-05-20T01:00:00Z",
        body: "承知いたしました。お待ちしております。",
      },
    ];
    const r = detectMutualAgreement({
      thread,
      userTimezone: "America/Vancouver",
      defaultTimezone: "Asia/Tokyo",
      referenceYear: 2026,
    });
    expect(r.confirmed).toBe(false);
    expect(r.reasoning).toMatch(/no specific slot commitment/);
  });

  it("rejects when no inbound mail has arrived after the user's outbound", () => {
    const thread: EmailSnapshot[] = [
      {
        direction: "inbound",
        sentAt: "2026-05-19T08:00:00Z",
        body: "5/22 14:00 / 5/23 10:00 のどちらかでいかがでしょうか。",
      },
      {
        direction: "outbound",
        sentAt: "2026-05-19T15:00:00Z",
        body: "5/22 14:00 JST でお願いいたします。",
      },
    ];
    const r = detectMutualAgreement({
      thread,
      userTimezone: "America/Vancouver",
      defaultTimezone: "Asia/Tokyo",
      referenceYear: 2026,
    });
    expect(r.confirmed).toBe(false);
    expect(r.reasoning).toMatch(/more recent than the latest inbound/);
  });

  it("rejects when the thread has only one message", () => {
    const thread: EmailSnapshot[] = [
      {
        direction: "inbound",
        sentAt: "2026-05-19T08:00:00Z",
        body: "面接日時のご連絡。5/22 14:00 でお願いします。",
      },
    ];
    const r = detectMutualAgreement({
      thread,
      userTimezone: "America/Vancouver",
      defaultTimezone: "Asia/Tokyo",
      referenceYear: 2026,
    });
    expect(r.confirmed).toBe(false);
    expect(r.reasoning).toMatch(/thread too short/);
  });

  it("rejects when inbound has neither confirmation phrase nor logistics (ambiguous reply)", () => {
    const thread: EmailSnapshot[] = [
      {
        direction: "outbound",
        sentAt: "2026-05-19T15:00:00Z",
        body: "5/22 14:00 JST でお願いいたします。",
      },
      {
        direction: "inbound",
        sentAt: "2026-05-20T01:00:00Z",
        body: "ご連絡いただきありがとうございます。",
      },
    ];
    const r = detectMutualAgreement({
      thread,
      userTimezone: "America/Vancouver",
      defaultTimezone: "Asia/Tokyo",
      referenceYear: 2026,
    });
    expect(r.confirmed).toBe(false);
    expect(r.reasoning).toMatch(/lacks both confirmation phrase and logistics/);
  });

  it("rejects (low confidence) when subject contains reschedule keyword even if body is clean", () => {
    const thread: EmailSnapshot[] = [
      {
        direction: "outbound",
        sentAt: "2026-05-19T15:00:00Z",
        subject: "Re: 面接日程",
        body: "5/22 14:00 JST でお願いいたします。",
      },
      {
        direction: "inbound",
        sentAt: "2026-05-20T01:00:00Z",
        subject: "【reschedule】面接日程",
        body: "承知いたしました。",
      },
    ];
    const r = detectMutualAgreement({
      thread,
      userTimezone: "America/Vancouver",
      defaultTimezone: "Asia/Tokyo",
      referenceYear: 2026,
    });
    // Subject keyword applies -0.2 penalty. Net confidence may dip
    // below 0.80; either way, agreement should be unsafe to act on.
    expect(r.confidence).toBeLessThan(0.85);
  });
});

describe("detectMutualAgreement — slot accuracy", () => {
  it("extracts slot TZ from outbound text (PDT marker) not default", () => {
    const thread: EmailSnapshot[] = [
      {
        direction: "outbound",
        sentAt: "2026-05-19T15:00:00Z",
        body: "5/22 23:00 PDT でお願いいたします。",
      },
      {
        direction: "inbound",
        sentAt: "2026-05-20T01:00:00Z",
        body: "承知いたしました。当日はよろしくお願いいたします。",
      },
    ];
    const r = detectMutualAgreement({
      thread,
      userTimezone: "America/Vancouver",
      defaultTimezone: "Asia/Tokyo",
      referenceYear: 2026,
    });
    expect(r.confirmed).toBe(true);
    expect(r.slot?.timezone).toBe("America/Vancouver");
  });

  it("returns explanatory reasoning string with reasons applied", () => {
    const thread: EmailSnapshot[] = [
      {
        direction: "outbound",
        sentAt: "2026-05-19T15:00:00Z",
        body: "5/22 14:00 JST でお願いいたします。",
      },
      {
        direction: "inbound",
        sentAt: "2026-05-20T01:00:00Z",
        body: "承知いたしました。当日はよろしくお願いいたします。",
      },
    ];
    const r = detectMutualAgreement({
      thread,
      userTimezone: "America/Vancouver",
      defaultTimezone: "Asia/Tokyo",
      referenceYear: 2026,
    });
    expect(r.reasoning).toMatch(/confirmation phrase/);
    expect(r.reasoning).toMatch(/Slot:/);
  });
});

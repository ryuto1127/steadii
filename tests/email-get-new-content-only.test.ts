import { describe, expect, it } from "vitest";

import { stripQuotedHistory } from "@/lib/agent/email/quoted-block-stripper";

// engineer-62 — quoted-block stripper. Structural fix for
// THREAD_ROLE_CONFUSED: the agent's slot-extraction surface MUST be
// the stripped body, not the raw thread, so it physically cannot
// extract candidate dates from quoted history.

describe("stripQuotedHistory", () => {
  it("strips `>`-prefixed quoted lines (single depth)", () => {
    const body = [
      "Hi,",
      "",
      "Sounds good — see the new candidate slots below.",
      "",
      "> Earlier you wrote:",
      "> Please send slots.",
    ].join("\n");
    const r = stripQuotedHistory(body);
    expect(r.newContentBody).not.toContain(">");
    expect(r.newContentBody).toContain("Sounds good");
    expect(r.newContentBody).not.toContain("Please send slots");
    expect(r.stripperFlagged).toBe(false);
  });

  it("strips multi-depth `>>>` quoted lines (3-tier thread)", () => {
    const body = [
      "Round-3 NEW content here.",
      "Slot: 2026/05/25 10:00",
      "",
      "> Round-2 reply",
      "> Slot: 2026/05/20 18:00",
      ">",
      ">> Round-1 original",
      ">> Slot: 2026/05/15 10:00",
      ">>",
      ">>> Some even-earlier exchange",
      ">>> Slot: 2026/05/10 09:00",
    ].join("\n");
    const r = stripQuotedHistory(body);
    expect(r.newContentBody).toContain("Round-3 NEW content");
    expect(r.newContentBody).toContain("2026/05/25");
    expect(r.newContentBody).not.toContain("2026/05/20");
    expect(r.newContentBody).not.toContain("2026/05/15");
    expect(r.newContentBody).not.toContain("2026/05/10");
  });

  it("strips an 'On YYYY-MM-DD ... wrote:' attribution and everything after", () => {
    const body = [
      "Hi Ryuto,",
      "",
      "Re-confirming the meeting for next Tuesday.",
      "",
      "On Mon, May 11, 2026 at 1:05 AM Reiwa <recruit@reiwa.example> wrote:",
      "",
      "Please pick a slot from below.",
      "Slot: 2026/05/15 10:00",
    ].join("\n");
    const r = stripQuotedHistory(body);
    expect(r.newContentBody).toContain("Re-confirming the meeting");
    expect(r.newContentBody).not.toContain("On Mon, May 11");
    expect(r.newContentBody).not.toContain("2026/05/15");
  });

  it("strips '-----Original Message-----' divider and everything after", () => {
    const body = [
      "Hi,",
      "",
      "Apologies for the delay — new slot below.",
      "Slot A: 2026/05/22 14:00",
      "",
      "-----Original Message-----",
      "From: prof@uni.edu",
      "Sent: Mon, May 11, 2026",
      "",
      "Old content with old slot 2026/05/01.",
    ].join("\n");
    const r = stripQuotedHistory(body);
    expect(r.newContentBody).toContain("Slot A: 2026/05/22");
    expect(r.newContentBody).not.toContain("Original Message");
    expect(r.newContentBody).not.toContain("2026/05/01");
  });

  it("strips Outlook-style JA header cluster (差出人 / 送信日時 / 件名)", () => {
    const body = [
      "畠山さま",
      "",
      "新しい候補は 2026/05/25 14:00 です。",
      "",
      "差出人: prof@uni.example",
      "送信日時: 2026年5月11日 月曜日 1:05",
      "宛先: ryuto@example.com",
      "件名: 面接の件",
      "",
      "過去のメール本文 — 2026/05/15 10:00 を提案。",
    ].join("\n");
    const r = stripQuotedHistory(body);
    expect(r.newContentBody).toContain("2026/05/25");
    expect(r.newContentBody).not.toContain("差出人:");
    expect(r.newContentBody).not.toContain("送信日時:");
    expect(r.newContentBody).not.toContain("2026/05/15");
  });

  it("strips Outlook-style EN header cluster (From / Sent / To / Subject)", () => {
    const body = [
      "Hi Ryuto,",
      "",
      "New time: 2026-05-25 14:00.",
      "",
      "From: prof@uni.edu",
      "Sent: Mon, May 11, 2026",
      "To: ryuto@example.com",
      "Subject: Interview",
      "",
      "Old content — Slot 2026-05-15 10:00.",
    ].join("\n");
    const r = stripQuotedHistory(body);
    expect(r.newContentBody).toContain("2026-05-25");
    expect(r.newContentBody).not.toContain("From: prof@uni.edu");
    expect(r.newContentBody).not.toContain("2026-05-15");
  });

  it("verbatim reproduces the 2026-05-14 round-2 dogfood fixture (令和トラベル)", () => {
    // Same body as tests/agent-evals/scenarios/quoted-block-extraction.ts
    const body = [
      "畠山 竜都　さま",
      "",
      "お世話になっております。令和トラベル採用担当でございます。",
      "ご面接日程のご希望をご回答いただきましてありがとうございます。",
      "",
      "誠に申し訳ございませんが、いただいた日程につきまして、面接官の調整が難しくなってしまい、以下のいずれかでのご参加は可能でしょうか。",
      "（オンラインにて、30~45分を想定しております。）",
      "",
      "＜候補日程＞",
      "・2026/5/20 (水)　18:00 〜 18:45",
      "・2026/5/21 (木)　15:00 〜 15:45",
      "",
      "以上でございます。",
      "ご不明点などがございましたら、お気軽にご連絡くださいませ。",
      "",
      "引き続きどうぞよろしくお願いいたします。",
      "",
      "採用担当",
      "",
      "",
      "> 返信遅れました。",
      ">",
      "> 以下の希望でお願いします。",
      ">",
      "> 第一希望：5月22日（金） 13：30〜14：00",
      "> 第二希望：5月15日（金） 12：30〜13：00",
      "> 第三希望：5月15日（金） 12：00〜12：30",
      ">",
      "> On Mon, May 11, 2026 at 1:05 AM 株式会社令和トラベル 採用担当 <",
      "> 2239928341129601024.candidate@reiwatravel.n-ats.hrmos.co> wrote:",
      ">",
      "> > 畠山 竜都 さま",
      "> >",
      "> > お世話になっております。令和トラベル採用担当でございます。",
      "> > この度は、グループディスカッション選考にご参加いただきまして、ありがとうございました。",
      "> >",
      "> > 慎重な選考の結果、畠山さまにはぜひ次回ステップにお進みいただきたく思っております。",
      "> >",
      "> > ＜候補日程＞",
      "> > ・2026/5/15 (金) 10:00 〜 11:00の間、11:30 〜 13:00の間",
      "> > ・2026/5/19 (火) 16:30 〜 18:00の間",
      "> > ・2026/5/22 (金) 13:30 〜 14:00",
      "> >",
      "> > 採用担当",
    ].join("\n");

    const r = stripQuotedHistory(body);

    // NEW content — round-2 slots MUST be present
    expect(r.newContentBody).toContain("2026/5/20");
    expect(r.newContentBody).toContain("18:00");
    expect(r.newContentBody).toContain("2026/5/21");
    expect(r.newContentBody).toContain("15:00");
    expect(r.newContentBody).toContain("令和トラベル採用担当");

    // QUOTED — round-1 / user's previous reply slots MUST be absent
    expect(r.newContentBody).not.toContain("第一希望");
    expect(r.newContentBody).not.toContain("第二希望");
    expect(r.newContentBody).not.toContain("第三希望");
    expect(r.newContentBody).not.toContain("2026/5/15");
    expect(r.newContentBody).not.toContain("2026/5/19");
    // 5月22 appears once in the user's quoted reply ("第一希望：5月22日"); it
    // must NOT survive — that's exactly the cascade slot the agent
    // mistakenly extracted.
    expect(r.newContentBody).not.toContain("5月22日");
  });

  it("returns the body unchanged when no quoted content is present", () => {
    const body = [
      "Hi prof,",
      "",
      "Quick question about MAT223 PS3 problem 4 — is the boundary case included?",
      "",
      "Thanks,",
      "Ryuto",
    ].join("\n");
    const r = stripQuotedHistory(body);
    expect(r.newContentBody).toContain("MAT223 PS3");
    expect(r.newContentBody).toContain("Thanks,");
    // Trailing whitespace is allowed to be trimmed, but the body itself
    // is intact — original length and new length should be close.
    expect(r.newContentBodyLength).toBeGreaterThan(0);
    expect(r.stripperFlagged).toBe(false);
  });

  it("sets stripperFlagged when > 95% of the body is stripped (entirely-quoted forward)", () => {
    const body = [
      "FYI:",
      "",
      "> Long",
      "> quoted",
      "> forward",
      "> with",
      "> dozens",
      "> of",
      "> lines",
      "> spanning",
      "> several",
      "> pages",
      "> of",
      "> content",
      "> that",
      "> the",
      "> sender",
      "> just",
      "> forwarded",
      "> without",
      "> adding",
      "> anything",
      "> new",
      "> at",
      "> all",
      "> seriously",
      "> nothing",
      "> here",
    ].join("\n");
    const r = stripQuotedHistory(body);
    // "FYI:" is the only line preserved. The original body is many
    // multiples longer than that, so > 95% is stripped.
    expect(r.stripperFlagged).toBe(true);
    expect(r.newContentBody).toContain("FYI");
  });

  it("collapses 3+ consecutive blank lines in the output to 1", () => {
    const body = [
      "Line 1",
      "",
      "",
      "",
      "Line 2",
      "",
      "",
      "Line 3",
      "",
      "> quoted",
    ].join("\n");
    const r = stripQuotedHistory(body);
    // No run of 2+ blank lines remains in the output
    expect(/\n\n\n/.test(r.newContentBody)).toBe(false);
    expect(r.newContentBody).toContain("Line 1");
    expect(r.newContentBody).toContain("Line 3");
  });

  it("handles empty body without throwing", () => {
    const r = stripQuotedHistory("");
    expect(r.newContentBody).toBe("");
    expect(r.originalBodyLength).toBe(0);
    expect(r.newContentBodyLength).toBe(0);
    expect(r.stripperFlagged).toBe(false);
  });

  it("does NOT trip Outlook-header detection on a single isolated header label", () => {
    // A solitary "From: someone wrote this in prose" line shouldn't
    // trigger the Outlook-cluster heuristic — the detector requires ≥2
    // labels within a 5-line window.
    const body = [
      "Hi,",
      "",
      "Subject: I noticed your note about that.",
      "Some additional prose.",
      "",
      "Best,",
      "Ryuto",
    ].join("\n");
    const r = stripQuotedHistory(body);
    expect(r.newContentBody).toContain("noticed your note");
    expect(r.newContentBody).toContain("Best,");
  });
});

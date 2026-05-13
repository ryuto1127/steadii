import { describe, expect, it } from "vitest";

// engineer-45 — fixed-mapping sender-domain → IANA TZ. Pure function;
// no mocks needed.

import {
  inferSenderTzFromDomain,
  inferSenderTzFromBody,
  inferSenderTimezone,
} from "@/lib/agent/email/sender-timezone-heuristic";

describe("inferSenderTzFromDomain", () => {
  it("maps co.jp / ac.jp / or.jp / jp → Asia/Tokyo with high confidence", () => {
    for (const d of [
      "recruit.co.jp",
      "u-tokyo.ac.jp",
      "example.or.jp",
      "plain.jp",
    ]) {
      const r = inferSenderTzFromDomain(d);
      expect(r.tz).toBe("Asia/Tokyo");
      expect(r.confidence).toBeGreaterThanOrEqual(0.9);
      expect(r.source).toMatch(/^tld:/);
    }
  });

  it("maps ac.uk / co.uk / uk → Europe/London", () => {
    for (const d of ["dept.ac.uk", "shop.co.uk", "plain.uk"]) {
      const r = inferSenderTzFromDomain(d);
      expect(r.tz).toBe("Europe/London");
      expect(r.confidence).toBeGreaterThanOrEqual(0.85);
    }
  });

  it("returns null for multi-TZ countries (US, Canada, Australia, Russia)", () => {
    for (const d of [
      "example.us",
      "school.gc.ca",
      "uoft.ca",
      "example.com.au",
      "company.au",
      "domain.ru",
    ]) {
      const r = inferSenderTzFromDomain(d);
      expect(r.tz).toBeNull();
      expect(r.source).toMatch(/^multi-tz:/);
    }
  });

  it("maps single-TZ East Asia countries correctly", () => {
    expect(inferSenderTzFromDomain("example.cn").tz).toBe("Asia/Shanghai");
    expect(inferSenderTzFromDomain("example.kr").tz).toBe("Asia/Seoul");
    expect(inferSenderTzFromDomain("example.tw").tz).toBe("Asia/Taipei");
    expect(inferSenderTzFromDomain("example.sg").tz).toBe("Asia/Singapore");
    expect(inferSenderTzFromDomain("example.hk").tz).toBe("Asia/Hong_Kong");
  });

  it("maps single-TZ Western Europe countries to their canonical IANA zone", () => {
    expect(inferSenderTzFromDomain("example.de").tz).toBe("Europe/Berlin");
    expect(inferSenderTzFromDomain("example.fr").tz).toBe("Europe/Paris");
    expect(inferSenderTzFromDomain("example.it").tz).toBe("Europe/Rome");
    expect(inferSenderTzFromDomain("example.es").tz).toBe("Europe/Madrid");
    expect(inferSenderTzFromDomain("example.nl").tz).toBe("Europe/Amsterdam");
  });

  it("returns null for .com / .org / .net (no signal)", () => {
    for (const d of ["example.com", "openai.com", "example.org", "example.net"]) {
      const r = inferSenderTzFromDomain(d);
      expect(r.tz).toBeNull();
      expect(r.confidence).toBe(0);
    }
  });

  it("handles full email addresses by stripping the local-part", () => {
    const r = inferSenderTzFromDomain("recruiter@reiwa.co.jp");
    expect(r.tz).toBe("Asia/Tokyo");
  });

  it("is case-insensitive on the input domain", () => {
    expect(inferSenderTzFromDomain("EXAMPLE.CO.JP").tz).toBe("Asia/Tokyo");
    expect(inferSenderTzFromDomain("Example.AC.UK").tz).toBe("Europe/London");
  });

  it("returns null and confidence 0 on empty input", () => {
    const r = inferSenderTzFromDomain("");
    expect(r.tz).toBeNull();
    expect(r.confidence).toBe(0);
  });

  it("ac.jp suffix wins over plain jp suffix (most-specific match)", () => {
    const r = inferSenderTzFromDomain("dept.u-tokyo.ac.jp");
    expect(r.tz).toBe("Asia/Tokyo");
    expect(r.source).toBe("tld:ac.jp");
  });
});

// 2026-05-12 sparring inline — body-language signal.

describe("inferSenderTzFromBody", () => {
  it("returns Asia/Tokyo when body is heavily Japanese", () => {
    const body =
      "お世話になっております。令和トラベル採用担当の山田です。次回の面接日程につきまして、以下の候補をご提案させていただきます。ご都合の良い日時をお知らせください。";
    const r = inferSenderTzFromBody(body);
    expect(r.tz).toBe("Asia/Tokyo");
    expect(r.confidence).toBeGreaterThanOrEqual(0.7);
    expect(r.source).toBe("body-lang:ja");
  });

  it("returns Asia/Seoul when body is heavily Korean", () => {
    const body =
      "안녕하세요. 다음 인터뷰 일정에 대해 알려드립니다. 가능한 시간을 알려주세요. 감사합니다. 잘 부탁드립니다 회사 채용 담당자입니다.";
    const r = inferSenderTzFromBody(body);
    expect(r.tz).toBe("Asia/Seoul");
    expect(r.confidence).toBeGreaterThanOrEqual(0.7);
    expect(r.source).toBe("body-lang:ko");
  });

  it("returns null for English-only bodies", () => {
    const body =
      "Hello, thanks for applying. We'd like to schedule your interview for next week. Please let us know your availability. Looking forward to hearing from you. Best regards.";
    const r = inferSenderTzFromBody(body);
    expect(r.tz).toBeNull();
  });

  it("returns null for short bodies (auto-reply / signature)", () => {
    const r = inferSenderTzFromBody("Sent from my iPhone");
    expect(r.tz).toBeNull();
  });

  it("returns null for empty body", () => {
    const r = inferSenderTzFromBody("");
    expect(r.tz).toBeNull();
  });
});

describe("inferSenderTimezone (combined)", () => {
  it("boosts confidence when domain and body agree", () => {
    const r = inferSenderTimezone({
      domain: "recruit.co.jp",
      body: "お世話になっております。面接日程についてご連絡いたします。候補日をいくつかご提案いたします。",
    });
    expect(r.tz).toBe("Asia/Tokyo");
    expect(r.confidence).toBeGreaterThanOrEqual(0.95);
    expect(r.source).toMatch(/\+/);
  });

  it("body wins when domain is generic .com but body is heavily Japanese (令和トラベル case)", () => {
    const r = inferSenderTimezone({
      domain: "reiwatravel.com",
      body: "お世話になっております。令和トラベル採用担当の山田です。次回の面接日程につきまして、以下の候補をご提案させていただきます。",
    });
    expect(r.tz).toBe("Asia/Tokyo");
    expect(r.confidence).toBeGreaterThanOrEqual(0.7);
    expect(r.source).toBe("body-lang:ja");
  });

  it("domain wins when domain and body disagree", () => {
    // .jp domain but the body is English (rare — international relations
    // dept of a JP company writing in English to an overseas candidate).
    const r = inferSenderTimezone({
      domain: "recruit.co.jp",
      body: "Hello, thanks for applying. We'd like to schedule your interview for next week. Please share your availability.",
    });
    expect(r.tz).toBe("Asia/Tokyo");
    expect(r.source).toMatch(/tld:co\.jp/);
  });

  it("returns null when both signals return null", () => {
    const r = inferSenderTimezone({
      domain: "example.com",
      body: "Hello, thanks for reaching out. Let me know when you have availability.",
    });
    expect(r.tz).toBeNull();
  });

  it("falls back to body when domain is multi-tz null (e.g. .ca)", () => {
    const r = inferSenderTimezone({
      domain: "company.ca",
      body: "お世話になっております。担当者よりご連絡を差し上げております。面接の候補日時をいくつか提案いたします。よろしくお願いいたします。",
    });
    expect(r.tz).toBe("Asia/Tokyo");
    expect(r.source).toBe("body-lang:ja");
  });

  it("handles null inputs cleanly", () => {
    expect(inferSenderTimezone({ domain: null, body: null }).tz).toBeNull();
    expect(inferSenderTimezone({}).tz).toBeNull();
  });
});

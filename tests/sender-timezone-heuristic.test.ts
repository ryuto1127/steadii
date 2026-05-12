import { describe, expect, it } from "vitest";

// engineer-45 — fixed-mapping sender-domain → IANA TZ. Pure function;
// no mocks needed.

import { inferSenderTzFromDomain } from "@/lib/agent/email/sender-timezone-heuristic";

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

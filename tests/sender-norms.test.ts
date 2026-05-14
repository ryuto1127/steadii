import { describe, expect, it } from "vitest";

// engineer-56 — sender-side working-hours norms heuristic. Pure
// function; no mocks needed.

import {
  defaultUserWorkingHours,
  inferSenderWorkingHours,
} from "@/lib/agent/email/sender-norms";

describe("inferSenderWorkingHours — domain hits", () => {
  it("maps .co.jp / .ne.jp / .or.jp → 09:00–18:00 Asia/Tokyo @ 0.9", () => {
    for (const domain of ["recruit.co.jp", "example.ne.jp", "company.or.jp"]) {
      const r = inferSenderWorkingHours({ senderDomain: domain });
      expect(r.start).toBe("09:00");
      expect(r.end).toBe("18:00");
      expect(r.tz).toBe("Asia/Tokyo");
      expect(r.confidence).toBe(0.9);
    }
  });

  it("maps .go.jp → 09:00–17:00 Asia/Tokyo @ 0.9 (strict gov)", () => {
    const r = inferSenderWorkingHours({ senderDomain: "agency.go.jp" });
    expect(r.start).toBe("09:00");
    expect(r.end).toBe("17:00");
    expect(r.tz).toBe("Asia/Tokyo");
    expect(r.confidence).toBe(0.9);
  });

  it("maps .ac.jp / .ac.uk / .edu → 09:00–18:00 academic @ 0.6 (wider)", () => {
    const jp = inferSenderWorkingHours({ senderDomain: "u-tokyo.ac.jp" });
    expect(jp.tz).toBe("Asia/Tokyo");
    expect(jp.confidence).toBe(0.6);

    const uk = inferSenderWorkingHours({ senderDomain: "ox.ac.uk" });
    expect(uk.tz).toBe("Europe/London");
    expect(uk.confidence).toBe(0.6);

    // .edu — no TZ inference from the TLD alone (multi-TZ US), so the
    // sender-norms code falls through to UTC. Confidence still 0.6 to
    // signal academic.
    const edu = inferSenderWorkingHours({ senderDomain: "mit.edu" });
    expect(edu.confidence).toBe(0.6);
  });

  it("body-language JP from generic .com → 09:00–18:00 Asia/Tokyo @ 0.8", () => {
    const body =
      "お世話になっております。アクメトラベル採用担当の山田です。次回の面接日程につきまして、以下の候補をご提案させていただきます。ご都合の良い日時をお知らせください。";
    const r = inferSenderWorkingHours({
      senderEmail: "recruiter@acme.com",
      body,
    });
    expect(r.tz).toBe("Asia/Tokyo");
    expect(r.start).toBe("09:00");
    expect(r.end).toBe("18:00");
    expect(r.confidence).toBe(0.8);
  });

  it("business TZ-inferred (.de) → 09:00–17:00 sender TZ @ 0.7", () => {
    const r = inferSenderWorkingHours({ senderDomain: "company.de" });
    expect(r.tz).toBe("Europe/Berlin");
    expect(r.start).toBe("09:00");
    expect(r.end).toBe("17:00");
    expect(r.confidence).toBe(0.7);
  });

  it("falls back to generic at 0.4 confidence for unknown TZ", () => {
    const r = inferSenderWorkingHours({ senderDomain: "example.com" });
    expect(r.confidence).toBe(0.4);
    expect(r.source).toBe("fallback:generic");
  });

  it("accepts senderEmail with full @ prefix", () => {
    const r = inferSenderWorkingHours({
      senderEmail: "recruiter@acme-travel.example.co.jp",
    });
    expect(r.tz).toBe("Asia/Tokyo");
    expect(r.confidence).toBe(0.9);
  });
});

describe("defaultUserWorkingHours — TZ-derived norm defaults", () => {
  it("North American TZ → 09:00–22:00", () => {
    for (const tz of [
      "America/Vancouver",
      "America/Los_Angeles",
      "America/New_York",
      "America/Toronto",
    ]) {
      const r = defaultUserWorkingHours(tz);
      expect(r.start).toBe("09:00");
      expect(r.end).toBe("22:00");
      expect(r.source).toBe("norm:north-america");
    }
  });

  it("Japan / East Asia → 08:00–22:00", () => {
    for (const tz of [
      "Asia/Tokyo",
      "Asia/Seoul",
      "Asia/Shanghai",
      "Asia/Taipei",
      "Asia/Hong_Kong",
      "Asia/Singapore",
    ]) {
      const r = defaultUserWorkingHours(tz);
      expect(r.start).toBe("08:00");
      expect(r.end).toBe("22:00");
      expect(r.source).toBe("norm:east-asia");
    }
  });

  it("Europe → 08:00–21:00", () => {
    for (const tz of [
      "Europe/Berlin",
      "Europe/Paris",
      "Europe/London",
      "Europe/Madrid",
    ]) {
      const r = defaultUserWorkingHours(tz);
      expect(r.start).toBe("08:00");
      expect(r.end).toBe("21:00");
      expect(r.source).toBe("norm:europe");
    }
  });

  it("Other / unknown → 09:00–21:00", () => {
    for (const tz of ["Pacific/Auckland", "Africa/Cairo", "Unknown/Bogus", ""]) {
      const r = defaultUserWorkingHours(tz);
      expect(r.start).toBe("09:00");
      expect(r.end).toBe("21:00");
      expect(r.source).toBe("norm:other");
    }
  });

  it("handles null timezone defensively", () => {
    const r = defaultUserWorkingHours(null);
    expect(r.source).toBe("norm:other");
  });
});

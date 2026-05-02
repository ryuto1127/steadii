import { describe, expect, it, vi } from "vitest";

// `auto-archive` module imports `db/client` (which validates env) so
// we mock the server-only marker + the db client. The pure helpers
// we exercise here (isAutoArchiveEligible) don't actually touch DB.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/client", () => ({ db: {} }));

import {
  classifyEmail,
  AUTO_ARCHIVE_CONFIDENCE_THRESHOLD,
} from "@/lib/agent/email/rules";
import { isAutoArchiveEligible } from "@/lib/agent/email/auto-archive";
import type { ClassifyInput, UserContext } from "@/lib/agent/email/types";

// Wave 5 — Tier-1 auto-archive classifier tests. Probes:
//   - confidence is in [0..1] and consistent per bucket
//   - learnedOptOut fires when a learned rule has risk_tier ≥ medium
//   - isAutoArchiveEligible gates correctly across (toggle, bucket,
//     confidence, learnedOptOut)

const baseInput: ClassifyInput = {
  externalId: "msg-w5",
  threadExternalId: null,
  fromEmail: "",
  fromName: null,
  fromDomain: "",
  toEmails: ["student@example.com"],
  ccEmails: [],
  subject: null,
  snippet: null,
  bodySnippet: null,
  receivedAt: new Date("2026-05-02T10:00:00Z"),
  gmailLabelIds: ["INBOX"],
  listUnsubscribe: null,
  inReplyTo: null,
  headerFromRaw: null,
};

function makeCtx(overrides: Partial<UserContext> = {}): UserContext {
  return {
    userId: "u-w5",
    userEmail: "student@example.com",
    learnedDomains: new Map(),
    learnedSenders: new Map(),
    seenDomains: new Set(["known.edu", "example.com", "club.example.org"]),
    ...overrides,
  };
}

describe("classifyEmail — confidence", () => {
  it("ignore bucket is confidence 1.0", () => {
    const res = classifyEmail(
      {
        ...baseInput,
        fromEmail: "noreply@news.example.com",
        fromDomain: "news.example.com",
        subject: "Weekly newsletter",
      },
      makeCtx({ seenDomains: new Set(["news.example.com"]) })
    );
    expect(res.bucket).toBe("ignore");
    expect(res.confidence).toBe(1.0);
  });

  it("auto_low single-keyword + seen domain stays UNDER auto-archive threshold", () => {
    const res = classifyEmail(
      {
        ...baseInput,
        fromEmail: "club@club.example.org",
        fromDomain: "club.example.org",
        subject: "RSVP for Friday",
        snippet:
          "Please RSVP if you can make Friday's club meeting at the usual spot.",
        bodySnippet:
          "Please RSVP if you can make Friday's club meeting at the usual spot.",
      },
      makeCtx()
    );
    expect(res.bucket).toBe("auto_low");
    // Single AUTO_LOW keyword + seen domain → 0.82 + 0.03 = 0.85; below 0.95 cutoff
    expect(res.confidence).toBeLessThan(AUTO_ARCHIVE_CONFIDENCE_THRESHOLD);
  });

  it("learned 'personal' sender_role pushes auto_low above threshold", () => {
    const learnedSenders = new Map([
      [
        "mom@example.com",
        { senderRole: "personal" as const, riskTier: null },
      ],
    ]);
    const res = classifyEmail(
      {
        ...baseInput,
        fromEmail: "mom@example.com",
        fromDomain: "example.com",
        subject: "dinner sat?",
        snippet: "you home for dinner saturday",
        bodySnippet: "you home for dinner saturday",
      },
      makeCtx({ learnedSenders })
    );
    expect(res.bucket).toBe("auto_low");
    expect(res.confidence).toBeGreaterThanOrEqual(
      AUTO_ARCHIVE_CONFIDENCE_THRESHOLD
    );
  });

  it("auto_high sets confidence above 0.85", () => {
    const res = classifyEmail(
      {
        ...baseInput,
        fromEmail: "registrar@known.edu",
        fromDomain: "known.edu",
        subject: "Scholarship renewal",
        snippet:
          "Your scholarship renewal documents are due before the end of the term.",
        bodySnippet:
          "Your scholarship renewal documents are due before the end of the term.",
      },
      makeCtx()
    );
    expect(res.bucket).toBe("auto_high");
    expect(res.confidence).toBeGreaterThanOrEqual(0.85);
    expect(res.confidence).toBeLessThanOrEqual(0.99);
  });

  it("l2_pending stamps confidence 0.5 (we punted)", () => {
    // Body is 50+ chars (so isShortAck=false) and contains no AUTO_*
    // keywords, no question mark, no escalating role — falls all the
    // way through to the L2 fallback.
    const longNeutralBody =
      "This is a fairly neutral message about some topic that has no relevant rule keywords.";
    const res = classifyEmail(
      {
        ...baseInput,
        fromEmail: "stranger@random.org",
        fromDomain: "random.org",
        subject: "Hello",
        snippet: longNeutralBody,
        bodySnippet: longNeutralBody,
      },
      makeCtx({ seenDomains: new Set(["random.org"]) })
    );
    expect(res.bucket).toBe("l2_pending");
    expect(res.confidence).toBe(0.5);
  });
});

describe("classifyEmail — learnedOptOut", () => {
  it("is false when no learned rule for sender/domain", () => {
    const res = classifyEmail(
      {
        ...baseInput,
        fromEmail: "x@example.com",
        fromDomain: "example.com",
        subject: "ok thanks",
      },
      makeCtx()
    );
    expect(res.learnedOptOut).toBe(false);
  });

  it("is true when learned domain has risk_tier='medium'", () => {
    const learnedDomains = new Map([
      ["example.com", { senderRole: null, riskTier: "medium" as const }],
    ]);
    const res = classifyEmail(
      {
        ...baseInput,
        fromEmail: "x@example.com",
        fromDomain: "example.com",
        subject: "confirmed",
      },
      makeCtx({ learnedDomains })
    );
    expect(res.learnedOptOut).toBe(true);
  });

  it("is true when learned sender has risk_tier='high'", () => {
    const learnedSenders = new Map([
      ["x@example.com", { senderRole: null, riskTier: "high" as const }],
    ]);
    const res = classifyEmail(
      {
        ...baseInput,
        fromEmail: "x@example.com",
        fromDomain: "example.com",
        subject: "confirmed",
      },
      makeCtx({ learnedSenders })
    );
    expect(res.learnedOptOut).toBe(true);
  });
});

describe("isAutoArchiveEligible", () => {
  const okResult = {
    bucket: "auto_low" as const,
    senderRole: null,
    ruleProvenance: [],
    firstTimeSender: false,
    confidence: 0.96,
    learnedOptOut: false,
  };

  it("returns false when toggle is off", () => {
    expect(
      isAutoArchiveEligible(okResult, { autoArchiveEnabled: false })
    ).toBe(false);
  });

  it("returns true on auto_low + ≥0.95 + no opt-out + toggle on", () => {
    expect(
      isAutoArchiveEligible(okResult, { autoArchiveEnabled: true })
    ).toBe(true);
  });

  it("returns false on bucket=auto_high regardless of confidence", () => {
    expect(
      isAutoArchiveEligible(
        { ...okResult, bucket: "auto_high", confidence: 0.99 },
        { autoArchiveEnabled: true }
      )
    ).toBe(false);
  });

  it("returns false when confidence below threshold", () => {
    expect(
      isAutoArchiveEligible(
        { ...okResult, confidence: 0.94 },
        { autoArchiveEnabled: true }
      )
    ).toBe(false);
  });

  it("returns false when learnedOptOut is true", () => {
    expect(
      isAutoArchiveEligible(
        { ...okResult, learnedOptOut: true },
        { autoArchiveEnabled: true }
      )
    ).toBe(false);
  });

  it("threshold is exactly 0.95 (boundary inclusive)", () => {
    expect(
      isAutoArchiveEligible(
        { ...okResult, confidence: 0.95 },
        { autoArchiveEnabled: true }
      )
    ).toBe(true);
    expect(AUTO_ARCHIVE_CONFIDENCE_THRESHOLD).toBe(0.95);
  });
});

import { describe, expect, it, vi } from "vitest";

// engineer-33 — OTP / verification-code detection. Pure helper, but
// `rules` (which we import below for the L1 wire-up assertion) imports
// `db/client` indirectly via the schema; mock server-only + db so the
// classifier branches don't try to hit Postgres.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/client", () => ({ db: {} }));

import {
  isOtpUrgency,
  OTP_DECAY_WINDOW_MS,
} from "@/lib/agent/email/rules-global";
import { classifyEmail } from "@/lib/agent/email/rules";
import type { ClassifyInput, UserContext } from "@/lib/agent/email/types";

const baseInput: ClassifyInput = {
  externalId: "msg-otp",
  threadExternalId: null,
  fromEmail: "noreply@amd.com",
  fromName: "AMD",
  fromDomain: "amd.com",
  toEmails: ["student@example.com"],
  ccEmails: [],
  subject: null,
  snippet: null,
  bodySnippet: null,
  receivedAt: new Date("2026-05-05T12:00:00Z"),
  gmailLabelIds: ["INBOX"],
  listUnsubscribe: null,
  inReplyTo: null,
  headerFromRaw: null,
};

function makeCtx(overrides: Partial<UserContext> = {}): UserContext {
  return {
    userId: "u-otp",
    userEmail: "student@example.com",
    learnedDomains: new Map(),
    learnedSenders: new Map(),
    seenDomains: new Set(["amd.com", "known.edu", "example.com"]),
    githubUsername: null,
    ...overrides,
  };
}

describe("isOtpUrgency", () => {
  it("matches 'verification code' in EN subject (case-insensitive)", () => {
    expect(
      isOtpUrgency({
        subject: "Your AMD Verification Code",
        body: "Use the code below to finish signing in.",
      })
    ).toBe(true);
  });

  it("matches '認証コード' in JA subject", () => {
    expect(
      isOtpUrgency({
        subject: "【AMD】認証コードのお知らせ",
        body: "次のコードを入力してください。",
      })
    ).toBe(true);
  });

  it("matches body when subject is silent (e.g. 'one-time code: 123456')", () => {
    expect(
      isOtpUrgency({
        subject: "AMD",
        body: "Your one-time code: 123456",
      })
    ).toBe(true);
  });

  it("does NOT match a casual mention of 'code' in conversation", () => {
    expect(
      isOtpUrgency({
        subject: "Did you receive my code?",
        body: "I emailed the diff yesterday — let me know what you think.",
      })
    ).toBe(false);
  });

  it("handles null body gracefully", () => {
    expect(
      isOtpUrgency({ subject: "Your authentication code", body: null })
    ).toBe(true);
  });

  it("handles null subject + null body without throwing", () => {
    expect(isOtpUrgency({ subject: null, body: null })).toBe(false);
  });
});

describe("classifyEmail — OTP urgency stamp", () => {
  it("stamps urgencyExpiresAt ≈ now + OTP_DECAY_WINDOW_MS when OTP keyword matches", () => {
    const before = Date.now();
    const res = classifyEmail(
      {
        ...baseInput,
        subject: "Your AMD verification code",
        snippet: "Use 123456 to finish signing in.",
        bodySnippet: "Use 123456 to finish signing in.",
      },
      makeCtx()
    );
    const after = Date.now();
    expect(res.urgencyExpiresAt).not.toBeNull();
    const stampedAt = res.urgencyExpiresAt!.getTime();
    expect(stampedAt).toBeGreaterThanOrEqual(before + OTP_DECAY_WINDOW_MS);
    expect(stampedAt).toBeLessThanOrEqual(after + OTP_DECAY_WINDOW_MS);
    expect(res.ruleProvenance.map((p) => p.ruleId)).toContain(
      "GLOBAL_URGENCY_OTP_DECAY"
    );
  });

  it("leaves urgencyExpiresAt null on a non-OTP email", () => {
    const res = classifyEmail(
      {
        ...baseInput,
        subject: "Office hours next week",
        snippet: "Reminder — my Tuesday office hour is moved to Thursday.",
        bodySnippet:
          "Reminder — my Tuesday office hour is moved to Thursday.",
      },
      makeCtx()
    );
    expect(res.urgencyExpiresAt).toBeNull();
  });
});

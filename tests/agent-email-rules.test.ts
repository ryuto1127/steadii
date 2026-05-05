import { describe, expect, it } from "vitest";
import { classifyEmail } from "@/lib/agent/email/rules";
import type { ClassifyInput, UserContext } from "@/lib/agent/email/types";

// Fixtures loaded statically — kept small + readable + near tests.
// `tests/fixtures/gmail/*.json` hold the real-shape Gmail payloads;
// these tests assemble ClassifyInput directly so the rule engine can
// be probed without the fetcher in the loop.

const baseInput: ClassifyInput = {
  externalId: "msg-1",
  threadExternalId: "thr-1",
  fromEmail: "",
  fromName: null,
  fromDomain: "",
  toEmails: ["student@example.com"],
  ccEmails: [],
  subject: null,
  snippet: null,
  bodySnippet: null,
  receivedAt: new Date("2026-04-22T19:30:00Z"),
  gmailLabelIds: ["INBOX"],
  listUnsubscribe: null,
  inReplyTo: null,
  headerFromRaw: null,
};

function makeCtx(overrides: Partial<UserContext> = {}): UserContext {
  return {
    userId: "u-1",
    userEmail: "student@example.com",
    learnedDomains: new Map(),
    learnedSenders: new Map(),
    // Seed "known.edu" and "example.com" as seen so first-time-sender
    // doesn't bias tests that aren't specifically about it.
    seenDomains: new Set(["known.edu", "example.com"]),
    githubUsername: null,
    ...overrides,
  };
}

describe("classifyEmail — IGNORE bucket", () => {
  it("ignores obvious noreply senders with no action verbs", () => {
    const input: ClassifyInput = {
      ...baseInput,
      fromEmail: "noreply@news.linear.app",
      fromDomain: "news.linear.app",
      subject: "Linear weekly update",
      snippet: "Your weekly product update is here.",
      bodySnippet: "Your weekly product update is here.",
    };
    const res = classifyEmail(input, makeCtx({
      seenDomains: new Set(["news.linear.app"]),
    }));
    expect(res.bucket).toBe("ignore");
    expect(res.ruleProvenance.map((p) => p.ruleId)).toContain(
      "GLOBAL_IGNORE_BOT_SENDER"
    );
  });

  it("does NOT ignore a noreply sender asking for action", () => {
    // "confirm" is an action verb; noreply rule must not fire.
    const input: ClassifyInput = {
      ...baseInput,
      fromEmail: "noreply@known.edu",
      fromDomain: "known.edu",
      subject: "Please confirm your registration",
      snippet: "Confirm your registration within 24 hours.",
      bodySnippet: "Confirm your registration within 24 hours.",
    };
    const res = classifyEmail(input, makeCtx());
    expect(res.bucket).not.toBe("ignore");
  });

  it("ignores Gmail-classified promotions", () => {
    const input: ClassifyInput = {
      ...baseInput,
      fromEmail: "brand@brand.com",
      fromDomain: "brand.com",
      subject: "Spring sale inside",
      snippet: "Limited-time offer.",
      bodySnippet: "Limited-time offer.",
      gmailLabelIds: ["INBOX", "CATEGORY_PROMOTIONS"],
    };
    const res = classifyEmail(input, makeCtx({
      seenDomains: new Set(["brand.com"]),
    }));
    expect(res.bucket).toBe("ignore");
  });

  it("ignores self-sent messages (auto-reply loop guard)", () => {
    const input: ClassifyInput = {
      ...baseInput,
      fromEmail: "student@example.com",
      fromDomain: "example.com",
      subject: "Re: my own note",
      snippet: "Thanks, me.",
    };
    const res = classifyEmail(input, makeCtx());
    expect(res.bucket).toBe("ignore");
  });
});

describe("classifyEmail — AUTO_HIGH bucket", () => {
  it("matches academic-integrity keywords (EN)", () => {
    const input: ClassifyInput = {
      ...baseInput,
      fromEmail: "prof.adams@known.edu",
      fromDomain: "known.edu",
      subject: "Plagiarism review",
      snippet: "Regarding suspected plagiarism in your paper.",
      bodySnippet: "Regarding suspected plagiarism in your paper.",
    };
    const res = classifyEmail(input, makeCtx());
    expect(res.bucket).toBe("auto_high");
    expect(res.ruleProvenance.map((p) => p.ruleId)).toContain(
      "GLOBAL_AUTO_HIGH_ACADEMIC_INTEGRITY"
    );
  });

  it("matches Japanese 学術不正 keyword", () => {
    const input: ClassifyInput = {
      ...baseInput,
      fromEmail: "prof.tanaka@known.edu",
      fromDomain: "known.edu",
      subject: "学術不正の疑いについて",
      snippet: "面談を希望します",
      bodySnippet: "面談を希望します",
    };
    const res = classifyEmail(input, makeCtx());
    expect(res.bucket).toBe("auto_high");
  });

  it("forces AUTO_HIGH on first-time sender domain", () => {
    const input: ClassifyInput = {
      ...baseInput,
      fromEmail: "new.admissions@newschool.edu",
      fromDomain: "newschool.edu",
      subject: "Hello",
      snippet: "Just reaching out.",
      bodySnippet: "Just reaching out.",
    };
    const res = classifyEmail(input, makeCtx()); // seenDomains does not include newschool.edu
    expect(res.bucket).toBe("auto_high");
    expect(res.firstTimeSender).toBe(true);
    expect(res.ruleProvenance.map((p) => p.ruleId)).toContain(
      "GLOBAL_AUTO_HIGH_FIRST_TIME_DOMAIN"
    );
  });

  it("escalates to AUTO_HIGH when the sender is a learned 'supervisor'", () => {
    const input: ClassifyInput = {
      ...baseInput,
      fromEmail: "pi@lab.known.edu",
      fromDomain: "lab.known.edu",
      subject: "Thesis meeting",
      snippet: "Can we meet Friday?",
      bodySnippet: "Can we meet Friday?",
    };
    const learnedSenders = new Map([
      [
        "pi@lab.known.edu",
        { senderRole: "supervisor" as const, riskTier: null },
      ],
    ]);
    const res = classifyEmail(
      input,
      makeCtx({
        seenDomains: new Set(["lab.known.edu", "known.edu", "example.com"]),
        learnedSenders,
      })
    );
    expect(res.bucket).toBe("auto_high");
    expect(res.ruleProvenance.map((p) => p.ruleId)).toContain(
      "USER_AUTO_HIGH_SUPERVISOR"
    );
  });

  it("escalates to AUTO_HIGH when the sender is a learned 'career' contact", () => {
    // Recruiters / interviewers / internship coordinators: missed reply
    // costs an opportunity, so role alone escalates regardless of subject.
    const input: ClassifyInput = {
      ...baseInput,
      fromEmail: "recruiter@somecorp.com",
      fromDomain: "somecorp.com",
      subject: "Quick chat next week?",
      snippet: "Wanted to follow up on your application.",
      bodySnippet: "Wanted to follow up on your application.",
    };
    const learnedSenders = new Map([
      [
        "recruiter@somecorp.com",
        { senderRole: "career" as const, riskTier: null },
      ],
    ]);
    const res = classifyEmail(
      input,
      makeCtx({
        seenDomains: new Set([
          "somecorp.com",
          "known.edu",
          "example.com",
        ]),
        learnedSenders,
      })
    );
    expect(res.bucket).toBe("auto_high");
    expect(res.ruleProvenance.map((p) => p.ruleId)).toContain(
      "USER_AUTO_HIGH_CAREER"
    );
  });

  it("does NOT escalate to AUTO_HIGH when the domain is already known and nothing else matches", () => {
    // Negative: this is a plain message from a known domain with no
    // HIGH keywords. It should NOT land in auto_high.
    const input: ClassifyInput = {
      ...baseInput,
      fromEmail: "friend@known.edu",
      fromDomain: "known.edu",
      subject: "Lecture notes",
      snippet: "Here are today's notes.",
      bodySnippet: "Here are today's notes.",
    };
    const res = classifyEmail(input, makeCtx());
    expect(res.bucket).not.toBe("auto_high");
  });
});

describe("classifyEmail — AUTO_MEDIUM bucket", () => {
  it("matches deadline keyword (EN)", () => {
    const input: ClassifyInput = {
      ...baseInput,
      fromEmail: "classmate@known.edu",
      fromDomain: "known.edu",
      subject: "Extension on PS4 deadline?",
      snippet: "Can we discuss an extension?",
      bodySnippet: "Can we discuss an extension?",
    };
    const res = classifyEmail(input, makeCtx());
    expect(res.bucket).toBe("auto_medium");
    expect(res.ruleProvenance.map((p) => p.ruleId)).toContain(
      "GLOBAL_AUTO_MEDIUM_DEADLINE"
    );
  });

  it("escalates to medium when a learned professor sends mail", () => {
    const input: ClassifyInput = {
      ...baseInput,
      fromEmail: "prof.adams@known.edu",
      fromDomain: "known.edu",
      subject: "Saw your question",
      snippet: "Here's my answer.",
      bodySnippet: "Here's my answer.",
    };
    const learnedSenders = new Map([
      [
        "prof.adams@known.edu",
        { senderRole: "professor" as const, riskTier: null },
      ],
    ]);
    const res = classifyEmail(input, makeCtx({ learnedSenders }));
    expect(res.bucket).toBe("auto_medium");
  });

  it("demotes a learned 'personal' sender to AUTO_LOW", () => {
    // Family / friends / club mail shouldn't paginate the triage queue.
    const input: ClassifyInput = {
      ...baseInput,
      fromEmail: "mom@family.example",
      fromDomain: "family.example",
      subject: "Sunday dinner?",
      snippet: "Are you free Sunday at 6?",
      bodySnippet: "Are you free Sunday at 6?",
    };
    const learnedSenders = new Map([
      [
        "mom@family.example",
        { senderRole: "personal" as const, riskTier: null },
      ],
    ]);
    const res = classifyEmail(
      input,
      makeCtx({
        seenDomains: new Set([
          "family.example",
          "known.edu",
          "example.com",
        ]),
        learnedSenders,
      })
    );
    expect(res.bucket).toBe("auto_low");
    expect(res.ruleProvenance.map((p) => p.ruleId)).toContain(
      "USER_AUTO_LOW_PERSONAL"
    );
  });

  it("does NOT match AUTO_MEDIUM when subject has a question mark but sender is not from a .edu", () => {
    // Negative for the education-domain-question heuristic.
    const input: ClassifyInput = {
      ...baseInput,
      fromEmail: "friend@gmail.com",
      fromDomain: "gmail.com",
      subject: "Dinner tonight?",
      snippet: "Up for sushi?",
      bodySnippet: "Up for sushi?",
    };
    const res = classifyEmail(input, makeCtx({
      seenDomains: new Set(["gmail.com"]),
    }));
    expect(res.bucket).not.toBe("auto_medium");
  });
});

describe("classifyEmail — AUTO_LOW bucket", () => {
  it("matches RSVP keyword", () => {
    const input: ClassifyInput = {
      ...baseInput,
      fromEmail: "events@known.edu",
      fromDomain: "known.edu",
      subject: "RSVP for Thursday's club meeting",
      snippet: "Please RSVP.",
      bodySnippet: "Please RSVP.",
    };
    const res = classifyEmail(input, makeCtx());
    expect(res.bucket).toBe("auto_low");
  });

  it("matches short acknowledgment pattern", () => {
    const input: ClassifyInput = {
      ...baseInput,
      fromEmail: "friend@known.edu",
      fromDomain: "known.edu",
      subject: "thanks",
      snippet: "Got it, thanks!",
      bodySnippet: "Got it, thanks!",
    };
    const res = classifyEmail(input, makeCtx());
    expect(res.bucket).toBe("auto_low");
  });

  it("does NOT classify as AUTO_LOW when body is long and informational", () => {
    const input: ClassifyInput = {
      ...baseInput,
      fromEmail: "friend@known.edu",
      fromDomain: "known.edu",
      subject: "Notes from today",
      snippet:
        "Here's the full breakdown of today's lecture. Part 1 covered the basics; part 2 went into the tricky derivations.",
      bodySnippet:
        "Here's the full breakdown of today's lecture. Part 1 covered the basics; part 2 went into the tricky derivations.",
    };
    const res = classifyEmail(input, makeCtx());
    expect(res.bucket).not.toBe("auto_low");
  });
});

describe("classifyEmail — L2 fallback", () => {
  it("falls back to l2_pending when no L1 rule matches", () => {
    const input: ClassifyInput = {
      ...baseInput,
      fromEmail: "friend@known.edu",
      fromDomain: "known.edu",
      subject: "Lecture notes",
      snippet: "Here are the lecture notes you asked for — see attached.",
      bodySnippet:
        "Here are the lecture notes you asked for — see attached. Let me know if you want more.",
    };
    const res = classifyEmail(input, makeCtx());
    expect(res.bucket).toBe("l2_pending");
    expect(res.ruleProvenance.map((p) => p.ruleId)).toContain(
      "GLOBAL_L2_FALLBACK"
    );
  });

  it("does NOT fall back when a rule matched", () => {
    const input: ClassifyInput = {
      ...baseInput,
      fromEmail: "friend@known.edu",
      fromDomain: "known.edu",
      subject: "Scholarship renewal",
      snippet: "Reminder about your scholarship.",
      bodySnippet: "Reminder about your scholarship.",
    };
    const res = classifyEmail(input, makeCtx());
    expect(res.bucket).not.toBe("l2_pending");
  });
});

describe("classifyEmail — provenance", () => {
  it("records every matching rule, not just the winning one", () => {
    // A first-time sender whose body also contains a scholarship keyword
    // should record both the FIRST_TIME_DOMAIN rule and the SCHOLARSHIP
    // rule in provenance.
    const input: ClassifyInput = {
      ...baseInput,
      fromEmail: "aid@newschool.edu",
      fromDomain: "newschool.edu",
      subject: "Scholarship renewal paperwork",
      snippet: "Your scholarship renewal window is open.",
      bodySnippet: "Your scholarship renewal window is open.",
    };
    const res = classifyEmail(input, makeCtx());
    const ids = res.ruleProvenance.map((p) => p.ruleId);
    expect(ids).toContain("GLOBAL_AUTO_HIGH_FIRST_TIME_DOMAIN");
    expect(ids).toContain("GLOBAL_AUTO_HIGH_SCHOLARSHIP");
  });
});

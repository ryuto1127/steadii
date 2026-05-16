import { describe, expect, it } from "vitest";
import { classifyEmail } from "@/lib/agent/email/rules";
import type { ClassifyInput, UserContext } from "@/lib/agent/email/types";

// Engineer-32 — GitHub-aware routing. PR-comment / review-request
// notifications come from notifications.github.com wearing a human
// display name, which previously triggered AUTO_HIGH first-time-domain +
// role-based escalation paths. The new branch defaults all GitHub
// notifications to auto_low and only promotes on explicit reviewer-
// request / CI-failure / merge-conflict signals or an @-mention of the
// user's configured GitHub login.

const baseInput: ClassifyInput = {
  externalId: "msg-gh",
  threadExternalId: "thr-gh",
  fromEmail: "notifications@github.com",
  fromName: "Sample Sender",
  fromDomain: "github.com",
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
    userId: "u-gh",
    userEmail: "student@example.com",
    learnedDomains: new Map(),
    learnedSenders: new Map(),
    // github.com NOT in seenDomains by default — first-time-domain would
    // have escalated this to AUTO_HIGH before engineer-32. The new
    // branch must short-circuit before that escalation fires.
    seenDomains: new Set(["known.edu", "example.com"]),
    githubUsername: null,
    ...overrides,
  };
}

describe("classifyEmail — GitHub notifications", () => {
  it("default routes a PR-comment notification to auto_low @ 0.95", () => {
    const input: ClassifyInput = {
      ...baseInput,
      subject: "Re: [acme/sample] feat(data): citizens.json (PR #42)",
      snippet: "@sample-user commented on this pull request.",
      bodySnippet: "Looks good — ready when you are.",
    };
    const res = classifyEmail(input, makeCtx());
    expect(res.bucket).toBe("auto_low");
    expect(res.confidence).toBe(0.95);
    expect(res.ruleProvenance.map((p) => p.ruleId)).toContain(
      "GLOBAL_AUTO_LOW_GITHUB_NOTIFICATION"
    );
  });

  it("promotes to auto_high when subject says 'review requested'", () => {
    const input: ClassifyInput = {
      ...baseInput,
      subject: "[steadii] Review requested on PR #128",
      snippet: "Please review this PR at your earliest convenience.",
      bodySnippet: "Please review this PR at your earliest convenience.",
    };
    const res = classifyEmail(input, makeCtx());
    expect(res.bucket).toBe("auto_high");
    expect(res.ruleProvenance.map((p) => p.ruleId)).toContain(
      "GLOBAL_AUTO_HIGH_GITHUB_REVIEW_REQUESTED"
    );
  });

  it("promotes to auto_high when @-mention matches ctx.githubUsername", () => {
    const input: ClassifyInput = {
      ...baseInput,
      subject: "Re: [steadii] PR comment",
      snippet: "@ryuto1127 can you take another look at this diff?",
      bodySnippet: "@ryuto1127 can you take another look at this diff?",
    };
    const res = classifyEmail(
      input,
      makeCtx({ githubUsername: "ryuto1127" })
    );
    expect(res.bucket).toBe("auto_high");
  });

  it("does NOT escalate via first-time-domain heuristic", () => {
    // Without the GitHub branch this would have hit
    // GLOBAL_AUTO_HIGH_FIRST_TIME_DOMAIN. The branch must short-circuit
    // before AUTO_HIGH is considered.
    const input: ClassifyInput = {
      ...baseInput,
      subject: "Re: [steadii] Build status",
      snippet: "Build passed — no action required.",
      bodySnippet: "Build passed — no action required.",
    };
    const res = classifyEmail(input, makeCtx());
    expect(res.bucket).toBe("auto_low");
    expect(res.ruleProvenance.map((p) => p.ruleId)).not.toContain(
      "GLOBAL_AUTO_HIGH_FIRST_TIME_DOMAIN"
    );
  });

  it("does NOT escalate via learned senderRole (display name is bot-relay)", () => {
    // Even if the display-name happens to belong to someone the user
    // tagged as "supervisor" in the past, the underlying sender is
    // notifications.github.com — not the supervisor's mailbox. So the
    // role escalation should NOT fire.
    const input: ClassifyInput = {
      ...baseInput,
      subject: "Re: [steadii] Quick comment on PR",
      snippet: "Looks good.",
      bodySnippet: "Looks good.",
    };
    const learnedDomains = new Map<
      string,
      { senderRole: "supervisor" }
    >();
    learnedDomains.set("github.com", { senderRole: "supervisor" });
    const res = classifyEmail(
      input,
      makeCtx({
        learnedDomains: learnedDomains as UserContext["learnedDomains"],
      })
    );
    expect(res.bucket).toBe("auto_low");
    expect(res.ruleProvenance.map((p) => p.ruleId)).not.toContain(
      "USER_AUTO_HIGH_SUPERVISOR"
    );
  });
});

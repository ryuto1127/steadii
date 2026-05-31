import { describe, expect, it, vi } from "vitest";

// Coverage for two queue-layer guards:
//  1. isSelfSenderDraftRow — drops Steadii's own outbound (digest) from
//     the Type B draft surface, including the case where senderEmail is
//     null/odd but the from-name is clearly "Steadii Agent".
//  2. isQueueExcludedProposalIssueType — keeps passive Steadii-originated
//     proposal cards (incl. monthly_boundary_review) out of the queue.
// Both are pure exported helpers, tested directly rather than mocking the
// DB (mirrors queue-dedup-by-thread.test.ts).

vi.mock("server-only", () => ({}));

vi.mock("@/lib/env", () => ({
  env: () => ({
    DATABASE_URL: "postgres://test",
    AUTH_SECRET: "test",
    AUTH_GOOGLE_ID: "test",
    AUTH_GOOGLE_SECRET: "test",
    NOTION_CLIENT_ID: "test",
    NOTION_CLIENT_SECRET: "test",
    OPENAI_API_KEY: "test",
    STRIPE_SECRET_KEY: "test",
    STRIPE_PRICE_ID_PRO: "test",
    ENCRYPTION_KEY: "k".repeat(64),
  }),
}));

vi.mock("@/lib/db/client", () => ({ db: {} }));

import {
  isSelfSenderDraftRow,
  isQueueExcludedProposalIssueType,
} from "@/lib/agent/queue/build";

describe("isSelfSenderDraftRow", () => {
  it("drops a row whose from-name is 'Steadii Agent' even when senderEmail is null", () => {
    expect(
      isSelfSenderDraftRow({ senderName: "Steadii Agent", senderEmail: null })
    ).toBe(true);
  });

  it("drops a row whose from-name is 'Steadii Agent' with a non-matching senderEmail", () => {
    expect(
      isSelfSenderDraftRow({
        senderName: "Steadii Agent",
        // Odd/legacy email that isn't on a self domain — name still wins.
        senderEmail: "weird-relay@external-domain.example",
      })
    ).toBe(true);
  });

  it("drops a row by self-sender email alone (display form)", () => {
    expect(
      isSelfSenderDraftRow({
        senderName: null,
        senderEmail: "Steadii Agent <agent@mysteadii.com>",
      })
    ).toBe(true);
  });

  it("keeps a normal third-party row", () => {
    expect(
      isSelfSenderDraftRow({
        senderName: "Jordan Lee",
        senderEmail: "jordan@external-domain.example",
      })
    ).toBe(false);
  });

  it("keeps a row with null name and null email", () => {
    expect(
      isSelfSenderDraftRow({ senderName: null, senderEmail: null })
    ).toBe(false);
  });
});

describe("isQueueExcludedProposalIssueType", () => {
  it("excludes monthly_boundary_review (passive self-report card)", () => {
    expect(isQueueExcludedProposalIssueType("monthly_boundary_review")).toBe(
      true
    );
  });

  it("excludes auto_action_log and admin_waitlist_pending", () => {
    expect(isQueueExcludedProposalIssueType("auto_action_log")).toBe(true);
    expect(isQueueExcludedProposalIssueType("admin_waitlist_pending")).toBe(
      true
    );
  });

  it("does NOT exclude a normal judgment-queue issue type", () => {
    expect(isQueueExcludedProposalIssueType("time_conflict")).toBe(false);
  });
});

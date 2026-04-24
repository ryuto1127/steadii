import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("@/lib/db/schema", () => ({
  agentDrafts: {},
  inboxItems: {},
  users: {},
}));
vi.mock("drizzle-orm", () => ({
  and: () => ({}),
  desc: () => ({}),
  eq: () => ({}),
  inArray: () => ({}),
}));
vi.mock("@/lib/env", () => ({
  env: () => ({ APP_URL: "https://mysteadii.xyz" }),
}));

import {
  buildDigestSubject,
  buildDigestText,
  buildDigestHtml,
  type DigestItem,
} from "@/lib/digest/build";

// Pure-function tests — no DB, no env. Exercises the subject copy
// contract + body shape + deep-link format.

function fx(
  n: number,
  overrides: Partial<DigestItem> = {}
): DigestItem {
  return {
    agentDraftId: `draft-${n}`,
    inboxItemId: `ibx-${n}`,
    senderName: `Sender ${n}`,
    senderEmail: `sender${n}@example.com`,
    subject: `Subject ${n}`,
    riskTier: "medium",
    action: "draft_reply",
    ...overrides,
  };
}

describe("buildDigestSubject", () => {
  it("returns light-day wording for 1-2 items", () => {
    expect(buildDigestSubject([fx(1, { riskTier: "low" })])).toBe(
      "Light day: 1 draft"
    );
    expect(
      buildDigestSubject([
        fx(1, { riskTier: "low" }),
        fx(2, { riskTier: "low" }),
      ])
    ).toBe("Light day: 2 drafts");
  });

  it("flags a single high-risk item urgently", () => {
    expect(buildDigestSubject([fx(1, { riskTier: "high" })])).toBe(
      "⚠️ High-risk item needs attention"
    );
  });

  it("splits urgent vs routine when mixed", () => {
    const items = [
      fx(1, { riskTier: "high" }),
      fx(2, { riskTier: "medium" }),
      fx(3, { riskTier: "low" }),
    ];
    expect(buildDigestSubject(items)).toBe(
      "3 drafts ready — 1 urgent, 2 routine"
    );
  });

  it("uses generic wording with no high-risk items", () => {
    const items = [
      fx(1, { riskTier: "medium" }),
      fx(2, { riskTier: "medium" }),
      fx(3, { riskTier: "low" }),
      fx(4, { riskTier: "low" }),
    ];
    expect(buildDigestSubject(items)).toBe("4 drafts ready");
  });
});

describe("buildDigestText / buildDigestHtml", () => {
  const appUrl = "https://mysteadii.xyz";

  it("deep-links each item with the utm_source=digest query", () => {
    const text = buildDigestText({
      items: [fx(1), fx(2)],
      appUrl,
    });
    expect(text).toContain(
      "https://mysteadii.xyz/app/inbox/draft-1?utm_source=digest"
    );
    expect(text).toContain(
      "https://mysteadii.xyz/app/inbox/draft-2?utm_source=digest"
    );
  });

  it("text body never leaks snippet/body content", () => {
    const text = buildDigestText({
      items: [
        {
          ...fx(1),
          subject: "Extension request",
        },
      ],
      appUrl,
    });
    expect(text).toContain("Extension request");
    expect(text).not.toContain("body preview");
  });

  it("html body escapes subject and sender content", () => {
    const html = buildDigestHtml({
      items: [
        {
          ...fx(1),
          senderName: "<script>alert(1)</script>",
          subject: `"double quote" & <tag>`,
        },
      ],
      appUrl,
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&quot;double quote&quot;");
  });
});

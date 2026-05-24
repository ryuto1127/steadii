import { describe, expect, it } from "vitest";
import {
  archetypePillKey,
  archetypeShellVariant,
  confidenceBorderClass,
  isExternalOriginHref,
} from "@/lib/agent/queue/visual";

// Tests focus on the queue card's visual decisions — these are the
// shape the engineer can lock without rendering JSX (vitest is node-
// only here; see `vitest.config.ts`). The actual data-builder mapping
// (proposal → Type A, draft → Type B/C/E, source chip dedup) is in
// `tests/queue-build.test.ts`.

describe("queue-card visual helpers", () => {
  it("maps high confidence to a 4px primary border", () => {
    const cls = confidenceBorderClass("high");
    expect(cls).toContain("border-l-[4px]");
    expect(cls).toContain("hsl(var(--primary))");
  });

  it("maps medium confidence to a 2px low-opacity primary border", () => {
    const cls = confidenceBorderClass("medium");
    expect(cls).toContain("border-l-2");
    // The visual spec calls for low-opacity primary — the class must
    // reference an alpha-modulated primary, not a solid one. Tailwind's
    // `--primary/<alpha>` syntax slots the alpha after the var name.
    expect(cls).toMatch(/--primary\)\s*\/\s*0\.\d+/);
  });

  it("maps low confidence to no left border (italic note added in body)", () => {
    expect(confidenceBorderClass("low")).toBe("border-l-0");
  });

  it("Type A picks the decision shell variant", () => {
    expect(archetypeShellVariant("A")).toBe("decision");
  });

  it("Type D picks the FYI shell variant", () => {
    expect(archetypeShellVariant("D")).toBe("fyi");
  });

  it("Types B / C / E pick the default shell variant", () => {
    expect(archetypeShellVariant("B")).toBe("default");
    expect(archetypeShellVariant("C")).toBe("default");
    expect(archetypeShellVariant("E")).toBe("default");
  });

  it("each archetype has a translation pill key", () => {
    const archs = ["A", "B", "C", "D", "E"] as const;
    for (const a of archs) {
      expect(archetypePillKey(a)).toMatch(/^archetype_[a-e]_pill$/);
    }
  });
});

describe("isExternalOriginHref", () => {
  it("returns true for absolute https URLs (Gmail web, Calendar)", () => {
    expect(
      isExternalOriginHref("https://mail.google.com/mail/u/0/#inbox/thread_abc")
    ).toBe(true);
    expect(
      isExternalOriginHref("https://calendar.google.com/event?eid=abc")
    ).toBe(true);
  });

  it("returns true for absolute http URLs", () => {
    expect(isExternalOriginHref("http://example.example/path")).toBe(true);
  });

  it("returns false for internal /app/* routes", () => {
    expect(isExternalOriginHref("/app/inbox/draft-1")).toBe(false);
    expect(isExternalOriginHref("/app/groups/group-1")).toBe(false);
  });

  it("returns false for null / undefined / empty", () => {
    expect(isExternalOriginHref(null)).toBe(false);
    expect(isExternalOriginHref(undefined)).toBe(false);
    expect(isExternalOriginHref("")).toBe(false);
  });

  it("returns false for protocol-relative or malformed strings (defensive)", () => {
    // We require an explicit http(s) prefix — anything else stays
    // in-tab. This means a future "//host/path" link would NOT get
    // target=_blank, which is the safe default.
    expect(isExternalOriginHref("//mail.google.com/")).toBe(false);
    expect(isExternalOriginHref("mail.google.com")).toBe(false);
  });
});

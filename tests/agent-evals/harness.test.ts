// engineer-52 — self-tests for the agent eval harness.
//
// These exercise the harness *plumbing* — fixture normalization,
// dispatcher behavior, assertion semantics — WITHOUT calling OpenAI.
// The end-to-end OpenAI-driven scenarios live in tests/agent-evals/scenarios/
// and run via `pnpm eval:agent`, not via vitest.

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  __testing,
  evaluateAssertions,
  type EvalRunResult,
} from "./harness";

const { convertTimezoneInline, buildDispatcher, normalizeFixture } = __testing;

describe("harness — fixture normalization", () => {
  it("assigns deterministic ids to fixture rows missing them", () => {
    const norm = normalizeFixture({
      user: { id: "u1", timezone: "America/Vancouver", locale: "en", name: "T" },
      inboxItems: [
        { senderEmail: "a@b.com", subject: "hi" },
        { senderEmail: "c@d.com", subject: "hello" },
      ],
    });
    expect(norm.inboxItems[0].id).toBe("fix-inbox-0");
    expect(norm.inboxItems[1].id).toBe("fix-inbox-1");
  });

  it("preserves explicit ids when provided", () => {
    const norm = normalizeFixture({
      user: { id: "u1", timezone: "UTC", locale: "en", name: "T" },
      inboxItems: [{ id: "my-id", senderEmail: "a@b.com" }],
    });
    expect(norm.inboxItems[0].id).toBe("my-id");
  });
});

describe("harness — TZ conversion", () => {
  it("converts JST 10:00 → America/Vancouver (day before, PDT period)", () => {
    const out = convertTimezoneInline({
      time: "2026-05-15T10:00:00",
      fromTz: "Asia/Tokyo",
      toTz: "America/Vancouver",
      locale: "en",
    });
    expect(out.toIso).toBe("2026-05-14T18:00:00-07:00");
    expect(out.weekdayChanged).toBe(true);
  });

  it("rejects invalid IANA names", () => {
    expect(() =>
      convertTimezoneInline({
        time: "2026-05-15T10:00:00",
        fromTz: "Not/AZone",
        toTz: "Asia/Tokyo",
        locale: "en",
      })
    ).toThrow(/Invalid IANA/);
  });
});

describe("harness — dispatcher", () => {
  const fixture = {
    user: {
      id: "u1",
      timezone: "America/Vancouver",
      locale: "en" as const,
      name: "Ryuto",
    },
    inboxItems: [
      {
        id: "email-1",
        senderEmail: "recruiter@acme-travel.example.co.jp",
        senderName: "アクメトラベル採用担当",
        subject: "次回面接のご連絡",
        snippet: "下記3候補からご都合の良い時間帯をお選びください",
        body: "5/15(木) 10:00-11:00\n5/15(木) 14:00-15:00\n5/16(金) 10:00-11:00",
        receivedAt: "2026-05-12T03:00:00Z",
      },
    ],
    entities: [
      {
        id: "ent-acme",
        kind: "org" as const,
        displayName: "アクメトラベル",
        aliases: ["Acme Travel"],
        primaryEmail: "recruiter@acme-travel.example.co.jp",
        linkedInboxItemIds: ["email-1"],
      },
    ],
    calendarEvents: [
      {
        id: "ev-1",
        title: "MAT223 Lecture",
        startsAt: "2026-05-13T15:30:00-07:00",
        endsAt: "2026-05-13T16:50:00-07:00",
      },
    ],
  };

  it("email_search matches senderName token", async () => {
    const d = buildDispatcher(fixture);
    const out = (await d("email_search", { query: "アクメトラベル採用担当" })) as {
      hits: Array<{ inboxItemId: string }>;
    };
    expect(out.hits.length).toBe(1);
    expect(out.hits[0].inboxItemId).toBe("email-1");
  });

  it("email_search returns empty hits when query doesn't match", async () => {
    const d = buildDispatcher(fixture);
    const out = (await d("email_search", { query: "no_such_token_xyz" })) as {
      hits: unknown[];
    };
    expect(out.hits).toHaveLength(0);
  });

  it("email_get_body returns body for the requested item", async () => {
    const d = buildDispatcher(fixture);
    const out = (await d("email_get_body", { inboxItemId: "email-1" })) as {
      body: string;
    };
    expect(out.body).toContain("5/15");
    expect(out.body).toContain("10:00-11:00");
  });

  it("infer_sender_timezone returns Asia/Tokyo for .co.jp", async () => {
    const d = buildDispatcher(fixture);
    const out = (await d("infer_sender_timezone", {
      senderEmail: "recruiter@acme-travel.example.co.jp",
    })) as { tz: string | null; confidence: number };
    expect(out.tz).toBe("Asia/Tokyo");
    expect(out.confidence).toBeGreaterThan(0.9);
  });

  it("lookup_entity returns canonical match for the canonical name", async () => {
    const d = buildDispatcher(fixture);
    const out = (await d("lookup_entity", { query: "アクメトラベル" })) as {
      candidates: Array<{ displayName: string; recentLinks: unknown[] }>;
    };
    expect(out.candidates.length).toBeGreaterThan(0);
    expect(out.candidates[0].displayName).toBe("アクメトラベル");
    expect(out.candidates[0].recentLinks.length).toBeGreaterThan(0);
  });

  it("lookup_entity returns empty for a typo (mirrors prod zero-hit behavior)", async () => {
    const d = buildDispatcher(fixture);
    const out = (await d("lookup_entity", { query: "アクメとラベル" })) as {
      candidates: unknown[];
      noMatchHint: string | null;
    };
    expect(out.candidates).toHaveLength(0);
    expect(out.noMatchHint).toBeTruthy();
  });

  it("convert_timezone applies the conversion via inline math", async () => {
    const d = buildDispatcher(fixture);
    const out = (await d("convert_timezone", {
      time: "2026-05-15T10:00:00",
      fromTz: "Asia/Tokyo",
      toTz: "America/Vancouver",
    })) as { toIso: string };
    expect(out.toIso).toBe("2026-05-14T18:00:00-07:00");
  });

  it("calendar_list_events filters by date range", async () => {
    const d = buildDispatcher(fixture);
    const out = (await d("calendar_list_events", {
      start: "2026-05-12T00:00:00Z",
      end: "2026-05-14T00:00:00Z",
    })) as { events: Array<{ title: string }> };
    expect(out.events.length).toBe(1);
    expect(out.events[0].title).toBe("MAT223 Lecture");
  });

  it("returns stub error for unwired tools instead of throwing", async () => {
    const d = buildDispatcher(fixture);
    const out = (await d("not_a_real_tool", {})) as { error: string };
    expect(out.error).toBe("stub_no_data");
  });
});

describe("harness — assertion evaluation", () => {
  const baseResult: EvalRunResult = {
    finalText:
      "5/15 10:00 JST → 5/14 18:00 PT — アクメトラベル の面接候補1です。",
    toolCalls: [
      {
        name: "email_search",
        args: { query: "アクメトラベル" },
        resultPreview: '{"hits":[{"inboxItemId":"email-1"}]}',
      },
      {
        name: "email_get_body",
        args: { inboxItemId: "email-1" },
        resultPreview: "{...}",
      },
      {
        name: "infer_sender_timezone",
        args: { senderEmail: "recruiter@acme-travel.example.co.jp" },
        resultPreview: '{"tz":"Asia/Tokyo"}',
      },
      {
        name: "convert_timezone",
        args: { time: "2026-05-15T10:00", fromTz: "Asia/Tokyo", toTz: "America/Vancouver" },
        resultPreview: '{"toIso":"..."}',
      },
    ],
    iterations: 2,
    durationMs: 1234,
  };

  it("tool_called passes when min-times satisfied", () => {
    const [a] = evaluateAssertions(baseResult, [
      { kind: "tool_called", name: "email_get_body" },
    ]);
    expect(a.pass).toBe(true);
  });

  it("tool_called fails when tool was never called", () => {
    const [a] = evaluateAssertions(baseResult, [
      { kind: "tool_called", name: "calendar_list_events" },
    ]);
    expect(a.pass).toBe(false);
    expect(a.message).toMatch(/Expected/);
  });

  it("tool_call_order passes when sequence appears (gaps allowed)", () => {
    const [a] = evaluateAssertions(baseResult, [
      {
        kind: "tool_call_order",
        sequence: ["email_search", "email_get_body"],
      },
    ]);
    expect(a.pass).toBe(true);
  });

  it("tool_call_order fails when sequence is reversed", () => {
    const [a] = evaluateAssertions(baseResult, [
      {
        kind: "tool_call_order",
        sequence: ["convert_timezone", "email_search"],
      },
    ]);
    expect(a.pass).toBe(false);
  });

  it("response_contains is case-insensitive by default", () => {
    const [a] = evaluateAssertions(baseResult, [
      { kind: "response_contains", text: "アクメトラベル" },
    ]);
    expect(a.pass).toBe(true);
  });

  it("response_does_not_contain catches PLACEHOLDER_LEAK shape", () => {
    const result: EvalRunResult = {
      ...baseResult,
      finalText: "ご提示いただいた日程で 〇〇 時から参加可能です。",
    };
    const [a] = evaluateAssertions(result, [
      { kind: "response_does_not_contain", text: "〇〇" },
    ]);
    expect(a.pass).toBe(false);
  });

  it("response_no_placeholder_leak flags FORBIDDEN_TOKENS via the prod regex", () => {
    const leaky: EvalRunResult = {
      ...baseResult,
      finalText:
        "面接日程: 〇〇月〇〇日 にお伺いします。 {name} さん、よろしくお願いします。",
    };
    const [a] = evaluateAssertions(leaky, [
      { kind: "response_no_placeholder_leak" },
    ]);
    expect(a.pass).toBe(false);
    expect(a.message).toMatch(/PLACEHOLDER_LEAK/);
  });

  it("response_no_placeholder_leak passes on grounded output", () => {
    const [a] = evaluateAssertions(baseResult, [
      { kind: "response_no_placeholder_leak" },
    ]);
    expect(a.pass).toBe(true);
  });

  it("custom assertion delegates to provided check fn", () => {
    const [a] = evaluateAssertions(baseResult, [
      {
        kind: "custom",
        label: "has at least 2 tool calls",
        check: (r) => ({ pass: r.toolCalls.length >= 2 }),
      },
    ]);
    expect(a.pass).toBe(true);
    expect(a.label).toBe("custom: has at least 2 tool calls");
  });
});

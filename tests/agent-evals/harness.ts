// engineer-52 — scenario-based agent behavior eval harness.
//
// Drives the chat orchestrator's prompt + tool loop with synthetic
// fixtures, then asserts on what the agent DID (tool calls) and what
// the agent SAID (final text). This is the layer the 1425-strong unit
// suite doesn't cover: end-to-end behavior of `streamChatResponse`.
//
// Architecture decisions:
//
// 1. Real OpenAI client, fixture-backed tools. Tool execution stays
//    in-memory (no DB) so each scenario is a self-contained spec of
//    "given this data, here's what the agent should do." The LLM call
//    is real — mini-tier at ~$0.001/scenario keeps the full 8-scenario
//    suite under $0.01 per run, which CI can afford on every prompt
//    change.
//
// 2. No `server-only` imports anywhere in this file or its descendants
//    except the prompt + self-critique (which are pure). That keeps the
//    standalone `run.ts` CLI runnable via `tsx` without a module shim.
//    The convert_timezone math is inlined below for the same reason.
//
// 3. Tool schemas mirror the production tool registry. The agent sees
//    the same surface area; only the executor is swapped. This means
//    prompt changes that alter which tool the agent picks are caught
//    by the harness — that's the whole point.

import OpenAI from "openai";
import { MAIN_SYSTEM_PROMPT } from "@/lib/agent/prompts/main";
import {
  detectPlaceholderLeak,
  buildPlaceholderLeakCorrection,
} from "@/lib/agent/self-critique";
import { inferSenderTimezone } from "@/lib/agent/email/sender-timezone-heuristic";
import { inferSenderWorkingHours } from "@/lib/agent/email/sender-norms";

// ---------- Fixture types ----------

export type FixtureInboxItem = {
  id?: string;
  senderEmail: string;
  senderName?: string;
  subject?: string;
  snippet?: string;
  body?: string;
  receivedAt?: string;
};

export type FixtureEvent = {
  id?: string;
  title: string;
  startsAt: string;
  endsAt?: string;
  description?: string;
  location?: string;
  kind?: "event" | "task" | "assignment";
};

export type FixtureAssignment = {
  id?: string;
  title: string;
  dueAt?: string;
  status?: string;
  className?: string;
};

export type FixtureEntity = {
  id?: string;
  kind: "person" | "project" | "course" | "org" | "event_series";
  displayName: string;
  aliases?: string[];
  description?: string;
  primaryEmail?: string;
  linkedInboxItemIds?: string[];
  linkedEventIds?: string[];
  linkedAssignmentIds?: string[];
};

export type EvalFixture = {
  user: { id: string; timezone: string; locale: "ja" | "en"; name: string };
  facts?: Array<{ fact: string; category?: string }>;
  inboxItems?: FixtureInboxItem[];
  calendarEvents?: FixtureEvent[];
  assignments?: FixtureAssignment[];
  entities?: FixtureEntity[];
  // engineer-54 — working/meeting-available window in the user's profile
  // TZ. Mirrors users.preferences.workingHoursLocal. When unset, the
  // harness falls back to the norm default per the user's TZ
  // (engineer-56 soft-default; the hard-ASK gate was removed).
  workingHoursLocal?: { start: string; end: string } | null;
  // engineer-56 — empirical window inferred from prior accepted-slot
  // picks. Overrides the norm default but not an explicit
  // workingHoursLocal. Optional on fixtures.
  inferredWorkingHoursLocal?: {
    start: string;
    end: string;
    sampleCount: number;
  } | null;
};

// ---------- Scenario + assertion shapes ----------

export type EvalScenario = {
  name: string;
  failureMode?: string;
  fixture: EvalFixture;
  input: {
    chatHistory?: Array<{ role: "user" | "assistant"; content: string }>;
    userMessage: string;
  };
  expect: EvalAssertion[];
};

export type EvalAssertion =
  | {
      kind: "tool_called";
      name: string;
      minTimes?: number;
      maxTimes?: number;
      argsMatch?: (args: unknown) => boolean;
    }
  | { kind: "tool_not_called"; name: string }
  | { kind: "tool_call_order"; sequence: string[] }
  | { kind: "response_contains"; text: string; caseSensitive?: boolean }
  | { kind: "response_does_not_contain"; text: string; caseSensitive?: boolean }
  | { kind: "response_no_placeholder_leak" }
  | { kind: "response_matches"; regex: RegExp }
  | { kind: "response_does_not_match"; regex: RegExp }
  | {
      kind: "custom";
      label: string;
      check: (result: EvalRunResult) => { pass: boolean; message?: string };
    };

export type EvalToolCallRecord = {
  name: string;
  args: unknown;
  resultPreview: string;
};

export type EvalRunResult = {
  finalText: string;
  toolCalls: EvalToolCallRecord[];
  iterations: number;
  durationMs: number;
};

export type EvalAssertionResult = {
  label: string;
  pass: boolean;
  message?: string;
};

export type EvalReport = {
  scenarioName: string;
  failureMode?: string;
  passed: boolean;
  assertions: EvalAssertionResult[];
  result: EvalRunResult;
};

// ---------- Tool schemas surfaced to OpenAI ----------
//
// Curated subset matching the production registry's most-used read tools
// plus a few write tools. Names and params match `lib/agent/tools/*` so
// the agent's behavior here generalizes to prod.

type OpenAITool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

const HARNESS_TOOL_DEFS: OpenAITool[] = [
  {
    type: "function",
    function: {
      name: "email_search",
      description:
        "Search the user's classified inbox. Filters by query (subject + snippet + senderName), senderEmail, or senderDomain. WHEN 0 HITS on a multi-character query, retry with shorter substrings or token splits before giving up (typos and JP particles are common).",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          senderEmail: { type: "string" },
          senderDomain: { type: "string" },
          sinceDays: { type: "integer", minimum: 1, maximum: 365 },
          limit: { type: "integer", minimum: 1, maximum: 50 },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "email_get_body",
      description:
        "Fetch the full body text of an email by inboxItemId. Use after email_search when the snippet doesn't carry enough detail (URLs, slot lists, structured content).",
      parameters: {
        type: "object",
        properties: { inboxItemId: { type: "string" } },
        required: ["inboxItemId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "infer_sender_timezone",
      description:
        "Infer the most likely timezone of an email sender from their email address (domain) + optional body content. Call this BEFORE convert_timezone when working with email-sourced times — it tells you which TZ the email times are anchored in.",
      parameters: {
        type: "object",
        properties: {
          senderEmail: { type: "string" },
          emailBody: { type: "string" },
        },
        required: ["senderEmail"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "infer_sender_norms",
      description:
        "Infer the sender's likely working hours from their email domain + optional body language. Returns {start, end, tz, confidence, shouldDisclose, reasoning}. Use when drafting a counter-proposal so your proposed window respects the sender's day, not just the user's. Confidence ≥ 0.7 → use silently; 0.4–0.7 → use AND surface the assumption; < 0.4 → generic fallback, disclose.",
      parameters: {
        type: "object",
        properties: {
          senderEmail: { type: "string" },
          body: { type: ["string", "null"] },
        },
        required: ["senderEmail"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "convert_timezone",
      description:
        "Convert a wall-clock time from one IANA timezone to another. Deterministic. Conversion direction: fromTz = sender's TZ, toTz = user's TZ. NEVER reversed.",
      parameters: {
        type: "object",
        properties: {
          time: { type: "string" },
          fromTz: { type: "string" },
          toTz: { type: "string" },
        },
        required: ["time", "fromTz", "toTz"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lookup_entity",
      description:
        "Look up everything Steadii knows about a person, project, course, organization, or recurring event from the user's cross-source entity graph. Returns up to 3 candidate entities with linked records (emails, events, assignments). Returns empty when no prior record — phrase accordingly instead of guessing. Returns metadata only — to read email body content, follow up with email_get_body.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          kind: {
            type: "string",
            enum: ["person", "project", "course", "org", "event_series"],
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "calendar_list_events",
      description:
        "List calendar events in a date range. Returns event title, description, startsAt, endsAt, location.",
      parameters: {
        type: "object",
        properties: {
          start: { type: "string" },
          end: { type: "string" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "assignments_create",
      description:
        "Create a new assignment with a due date and optional class linkage.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          due: { type: "string" },
          classHint: { type: ["string", "null"] },
          priority: {
            type: ["string", "null"],
            enum: ["low", "medium", "high", null],
          },
          notes: { type: ["string", "null"] },
        },
        required: ["title", "due"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_user_fact",
      description:
        "Save a stable fact about the user (preferences, schedule constraints, communication style).",
      parameters: {
        type: "object",
        properties: {
          fact: { type: "string" },
          category: { type: "string" },
        },
        required: ["fact"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_working_hours",
      description:
        "Save the user's working/meeting-available window. Call when the user states their availability (e.g. '9 AM to 10 PM Pacific') or answers the SLOT FEASIBILITY CHECK onboarding ask. Auto-saves; HH:MM 24h in the user's profile TZ. α scope non-overnight only (start < end).",
      parameters: {
        type: "object",
        properties: {
          start: { type: "string", description: "Start HH:MM 24h." },
          end: { type: "string", description: "End HH:MM 24h." },
        },
        required: ["start", "end"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "summarize_week",
      description:
        "Summarize the user's past 7 days of academic activity — chat count, mistake-note count, syllabus count, top classes, observation.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
];

// ---------- Fixture-backed tool dispatcher ----------

type DispatchFn = (name: string, args: unknown) => Promise<unknown>;

type NormalizedFixture = {
  user: EvalFixture["user"];
  inboxItems: Array<FixtureInboxItem & { id: string }>;
  events: Array<FixtureEvent & { id: string }>;
  assignments: Array<FixtureAssignment & { id: string }>;
  entities: Array<FixtureEntity & { id: string }>;
};

function normalizeFixture(fixture: EvalFixture): NormalizedFixture {
  return {
    user: fixture.user,
    inboxItems: (fixture.inboxItems ?? []).map((it, i) => ({
      ...it,
      id: it.id ?? `fix-inbox-${i}`,
    })),
    events: (fixture.calendarEvents ?? []).map((ev, i) => ({
      ...ev,
      id: ev.id ?? `fix-event-${i}`,
    })),
    assignments: (fixture.assignments ?? []).map((a, i) => ({
      ...a,
      id: a.id ?? `fix-assign-${i}`,
    })),
    entities: (fixture.entities ?? []).map((e, i) => ({
      ...e,
      id: e.id ?? `fix-entity-${i}`,
    })),
  };
}

function buildDispatcher(fixture: EvalFixture): DispatchFn {
  const norm = normalizeFixture(fixture);
  return async function dispatch(name, rawArgs): Promise<unknown> {
    const args = (rawArgs ?? {}) as Record<string, unknown>;
    switch (name) {
      case "email_search":
        return execEmailSearch(norm, args);
      case "email_get_body":
        return execEmailGetBody(norm, args);
      case "infer_sender_timezone":
        return execInferSenderTimezone(args);
      case "infer_sender_norms":
        return execInferSenderNorms(args);
      case "convert_timezone":
        return execConvertTimezone(norm, args);
      case "lookup_entity":
        return execLookupEntity(norm, args);
      case "calendar_list_events":
        return execCalendarListEvents(norm, args);
      case "assignments_create":
        return execAssignmentsCreate(args);
      case "save_user_fact":
        return execSaveUserFact(args);
      case "save_working_hours":
        return execSaveWorkingHours(args);
      case "summarize_week":
        return execSummarizeWeek(norm);
      default:
        return {
          error: "stub_no_data",
          message: `Tool '${name}' is not wired in the eval harness. Adjust the scenario or extend buildDispatcher.`,
        };
    }
  };
}

function execEmailSearch(
  norm: NormalizedFixture,
  args: Record<string, unknown>
): unknown {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  const senderEmail =
    typeof args.senderEmail === "string" ? args.senderEmail : "";
  const senderDomain =
    typeof args.senderDomain === "string" ? args.senderDomain : "";
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);

  const matches = norm.inboxItems.filter((it) => {
    if (senderEmail && it.senderEmail !== senderEmail) return false;
    if (senderDomain) {
      const dom = it.senderEmail.split("@").pop()?.toLowerCase() ?? "";
      if (dom !== senderDomain.toLowerCase()) return false;
    }
    if (tokens.length > 0) {
      const hay = `${it.subject ?? ""} ${it.snippet ?? ""} ${
        it.senderName ?? ""
      }`.toLowerCase();
      for (const tok of tokens) {
        if (!hay.includes(tok)) return false;
      }
    }
    return true;
  });

  return {
    hits: matches.map((m) => ({
      inboxItemId: m.id,
      threadExternalId: null,
      externalId: m.id,
      senderEmail: m.senderEmail,
      senderName: m.senderName ?? null,
      senderDomain: m.senderEmail.split("@").pop() ?? "",
      subject: m.subject ?? null,
      snippet: m.snippet ?? null,
      receivedAt: m.receivedAt ?? new Date().toISOString(),
    })),
    truncated: false,
  };
}

function execEmailGetBody(
  norm: NormalizedFixture,
  args: Record<string, unknown>
): unknown {
  const id = typeof args.inboxItemId === "string" ? args.inboxItemId : "";
  const it = norm.inboxItems.find((x) => x.id === id);
  if (!it) {
    return {
      error: "not_found",
      message: `No inbox item with id ${id} in fixture.`,
    };
  }
  return {
    inboxItemId: it.id,
    externalId: it.id,
    senderEmail: it.senderEmail,
    subject: it.subject ?? null,
    receivedAt: it.receivedAt ?? new Date().toISOString(),
    body: it.body ?? it.snippet ?? "",
    truncated: false,
    format: it.body ? "text/plain" : "empty",
  };
}

function execInferSenderTimezone(args: Record<string, unknown>): unknown {
  const senderEmail =
    typeof args.senderEmail === "string" ? args.senderEmail : "";
  const body =
    typeof args.emailBody === "string" && args.emailBody.length > 0
      ? args.emailBody
      : null;
  const domain = senderEmail.includes("@")
    ? senderEmail.split("@").pop() ?? null
    : null;
  const inf = inferSenderTimezone({ domain, body });
  const pct = Math.round(inf.confidence * 100);
  const reasoning = inf.tz
    ? `${senderEmail} → ${inf.tz} (${pct}% confidence, ${
        inf.source ?? "unknown"
      }).`
    : `Cannot reliably infer the sender's timezone from ${senderEmail}. Ask the user which TZ the email's times are in.`;
  return { ...inf, reasoning };
}

function execInferSenderNorms(args: Record<string, unknown>): unknown {
  const senderEmail =
    typeof args.senderEmail === "string" ? args.senderEmail : "";
  const body = typeof args.body === "string" && args.body.length > 0 ? args.body : null;
  const result = inferSenderWorkingHours({ senderEmail, body });
  const pct = Math.round(result.confidence * 100);
  const reasoning = `${senderEmail} → ${result.start}–${result.end} ${result.tz} (${pct}% confidence, ${result.source}).`;
  return {
    ...result,
    reasoning,
    shouldDisclose: result.confidence < 0.7,
  };
}

function execConvertTimezone(
  norm: NormalizedFixture,
  args: Record<string, unknown>
): unknown {
  const time = typeof args.time === "string" ? args.time : "";
  const fromTz = typeof args.fromTz === "string" ? args.fromTz : "";
  const toTz = typeof args.toTz === "string" ? args.toTz : "";
  try {
    return convertTimezoneInline({
      time,
      fromTz,
      toTz,
      locale: norm.user.locale,
    });
  } catch (err) {
    return {
      error: "conversion_failed",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

function execLookupEntity(
  norm: NormalizedFixture,
  args: Record<string, unknown>
): unknown {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  const kindFilter = typeof args.kind === "string" ? args.kind : undefined;
  const lower = query.toLowerCase();

  const scored = norm.entities
    .map((e) => {
      if (kindFilter && e.kind !== kindFilter) return null;
      const hayParts = [e.displayName, ...(e.aliases ?? [])].map((s) =>
        s.toLowerCase()
      );
      let score = 0;
      for (const part of hayParts) {
        if (part === lower) {
          score = Math.max(score, 1);
        } else if (part.includes(lower) || lower.includes(part)) {
          score = Math.max(score, 0.7);
        }
      }
      return score > 0 ? { entity: e, score } : null;
    })
    .filter((x): x is { entity: FixtureEntity & { id: string }; score: number } =>
      x !== null
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  const candidates = scored.map((s) => {
    const c = s.entity;
    const recentLinks = [
      ...(c.linkedInboxItemIds ?? []).map((id) => {
        const item = norm.inboxItems.find((x) => x.id === id);
        return {
          sourceKind: "inbox_item",
          sourceId: id,
          label: item?.subject ?? "(no subject)",
          href: null,
          occurredAt: item?.receivedAt ?? null,
          confidence: 0.9,
        };
      }),
      ...(c.linkedEventIds ?? []).map((id) => {
        const ev = norm.events.find((x) => x.id === id);
        return {
          sourceKind: "event",
          sourceId: id,
          label: ev?.title ?? "(no title)",
          href: null,
          occurredAt: ev?.startsAt ?? null,
          confidence: 0.9,
        };
      }),
      ...(c.linkedAssignmentIds ?? []).map((id) => {
        const a = norm.assignments.find((x) => x.id === id);
        return {
          sourceKind: "assignment",
          sourceId: id,
          label: a?.title ?? "(no title)",
          href: null,
          occurredAt: a?.dueAt ?? null,
          confidence: 0.9,
        };
      }),
    ];
    return {
      entityId: c.id,
      kind: c.kind,
      displayName: c.displayName,
      aliases: c.aliases ?? [],
      description: c.description ?? null,
      primaryEmail: c.primaryEmail ?? null,
      lastSeenAt: new Date().toISOString(),
      matchScore: s.score,
      matchMethod: s.score >= 1 ? "exact_name" : "fuzzy_name",
      recentLinks,
    };
  });

  return {
    query,
    candidates,
    noMatchHint:
      candidates.length === 0
        ? "Steadii has no prior record of an entity matching this query. Don't guess details — say so to the user."
        : null,
  };
}

function execCalendarListEvents(
  norm: NormalizedFixture,
  args: Record<string, unknown>
): unknown {
  const startStr = typeof args.start === "string" ? args.start : null;
  const endStr = typeof args.end === "string" ? args.end : null;
  const start = startStr ? new Date(startStr).getTime() : 0;
  const end = endStr
    ? new Date(endStr).getTime()
    : Date.now() + 30 * 24 * 60 * 60 * 1000;

  const matching = norm.events.filter((e) => {
    const t = new Date(e.startsAt).getTime();
    if (Number.isNaN(t)) return false;
    if (start > 0 && t < start) return false;
    if (t > end) return false;
    return true;
  });

  return {
    events: matching.map((e) => ({
      id: e.id,
      kind: e.kind ?? "event",
      title: e.title,
      description: e.description ?? null,
      startsAt: e.startsAt,
      endsAt: e.endsAt ?? null,
      location: e.location ?? null,
      url: null,
      status: "confirmed",
    })),
  };
}

function execAssignmentsCreate(args: Record<string, unknown>): unknown {
  const title = typeof args.title === "string" ? args.title : "(untitled)";
  const due = typeof args.due === "string" ? args.due : "";
  return {
    id: `fix-new-assign-${Date.now()}`,
    title,
    dueAt: due,
    classId: null,
    classMatched: false,
  };
}

function execSaveUserFact(args: Record<string, unknown>): unknown {
  return {
    ok: true,
    id: `fix-fact-${Date.now()}`,
    fact: typeof args.fact === "string" ? args.fact : "",
  };
}

function execSaveWorkingHours(args: Record<string, unknown>): unknown {
  // engineer-54 — fixture-only; no DB. The eval cares that the tool was
  // CALLED with sane args, not that it persisted. The scenarios for the
  // unset path assert on `tool_called: save_working_hours`.
  const start = typeof args.start === "string" ? args.start : "";
  const end = typeof args.end === "string" ? args.end : "";
  const hhmm = /^([01]\d|2[0-3]):([0-5]\d)$/;
  if (!hhmm.test(start) || !hhmm.test(end)) {
    return {
      error: "invalid_format",
      message: "start and end must be HH:MM 24h.",
    };
  }
  return { ok: true, start, end };
}

function execSummarizeWeek(norm: NormalizedFixture): unknown {
  const titles = norm.events.slice(0, 8).map((e) => e.title);
  const assignmentTitles = norm.assignments.slice(0, 8).map((a) => a.title);
  return {
    weekStart: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    weekEnd: new Date().toISOString(),
    chats: 0,
    mistakes: 0,
    syllabi: 0,
    topClasses: [],
    upcomingEvents: titles,
    upcomingAssignments: assignmentTitles,
    observation:
      titles.length > 0 || assignmentTitles.length > 0
        ? `Upcoming: ${[...titles, ...assignmentTitles].join(", ")}`
        : "Quiet week",
  };
}

// ---------- Fixture context serialization ----------
//
// Mirrors what `buildUserContext` + `serializeContextForPrompt` would
// produce in prod, but built from the fixture. The orchestrator
// appends this as a second system message after the stable
// MAIN_SYSTEM_PROMPT — same shape here so prompt caching semantics
// stay representative.

// engineer-56 — mirror of `lib/agent/email/sender-norms.ts#defaultUserWorkingHours`.
// Inlined here for the same reason `convertTimezoneInline` is — keeps
// the harness module free of any `server-only`-tainted imports.
const HARNESS_EAST_ASIA_TZS = new Set([
  "Asia/Tokyo",
  "Asia/Seoul",
  "Asia/Shanghai",
  "Asia/Taipei",
  "Asia/Hong_Kong",
  "Asia/Singapore",
]);

function harnessDefaultUserWorkingHours(
  tz: string
): { start: string; end: string; source: string } {
  if (tz.startsWith("America/")) {
    return { start: "09:00", end: "22:00", source: "norm:north-america" };
  }
  if (HARNESS_EAST_ASIA_TZS.has(tz)) {
    return { start: "08:00", end: "22:00", source: "norm:east-asia" };
  }
  if (tz.startsWith("Europe/")) {
    return { start: "08:00", end: "21:00", source: "norm:europe" };
  }
  return { start: "09:00", end: "21:00", source: "norm:other" };
}

function serializeFixtureContext(fixture: EvalFixture): string {
  const { user, facts } = fixture;
  const lines: string[] = [];
  lines.push("=== USER CONTEXT ===");
  // engineer-53 — emit USER_NAME with the same labeling the prod
  // serialize-context.ts uses, so the EMAIL REPLY WORKFLOW MUST-rule 5
  // (sign-off grounding) finds the same hook in eval scenarios as in
  // prod. The fixture always provides a name; the prod path falls back
  // to "(unknown — ask the user…)" when users.name is null.
  lines.push(`USER_NAME: ${user.name}`);
  // engineer-54 / 56 — mirror the prod serialize-context.ts
  // USER_WORKING_HOURS line so SLOT FEASIBILITY CHECK reads the same
  // hook in eval scenarios. Three-state resolution: explicit / inferred
  // / norm-default (engineer-56 soft-default).
  if (fixture.workingHoursLocal) {
    lines.push(
      `USER_WORKING_HOURS: ${fixture.workingHoursLocal.start}–${fixture.workingHoursLocal.end} (${user.timezone})`
    );
  } else if (fixture.inferredWorkingHoursLocal) {
    const inf = fixture.inferredWorkingHoursLocal;
    lines.push(
      `USER_WORKING_HOURS: ${inf.start}–${inf.end} (${user.timezone}, inferred from ${inf.sampleCount} accepted-slot picks — refine if wrong by volunteering hours; save_working_hours overrides)`
    );
  } else {
    const norm = harnessDefaultUserWorkingHours(user.timezone);
    lines.push(
      `USER_WORKING_HOURS: (not set — using norm: ${norm.start}–${norm.end} ${user.timezone}, source: ${norm.source}; surface this assumption once when drafting, save_working_hours if user volunteers actual hours)`
    );
  }
  lines.push(`Name: ${user.name}`);
  lines.push(`Timezone: ${user.timezone}`);
  lines.push(`Locale: ${user.locale}`);
  lines.push(`Current time: ${new Date().toISOString()}`);
  if (facts && facts.length > 0) {
    lines.push("");
    lines.push("Known facts about the user:");
    for (const f of facts) {
      lines.push(`- ${f.fact}${f.category ? ` [${f.category}]` : ""}`);
    }
  }
  return lines.join("\n");
}

// ---------- runScenario ----------

const HARNESS_MAX_ITERATIONS = 8;
const HARNESS_MAX_RETRY_AFTER_LEAK = 1;

type FunctionToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

function isFunctionToolCall(
  c: OpenAI.Chat.Completions.ChatCompletionMessageToolCall
): c is FunctionToolCall & OpenAI.Chat.Completions.ChatCompletionMessageToolCall {
  return c.type === "function" && "function" in c;
}

function getModelForHarness(): string {
  return (
    process.env.OPENAI_EVAL_MODEL?.trim() ||
    process.env.OPENAI_CHAT_MODEL?.trim() ||
    "gpt-5.4-mini"
  );
}

function getOpenAIClient(): OpenAI {
  // The OPENAI_API_KEY check fires at first use; we surface it eagerly
  // so a misconfigured CI run errors with a clear message instead of a
  // cryptic 401 buried in the stream.
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error(
      "OPENAI_API_KEY is not set. The eval harness requires a real OpenAI key — see tests/agent-evals/README or the CI secret config."
    );
  }
  return new OpenAI({ apiKey: key, timeout: 60_000, maxRetries: 2 });
}

export async function runScenario(
  scenario: EvalScenario
): Promise<EvalRunResult> {
  const start = Date.now();
  const client = getOpenAIClient();
  const model = getModelForHarness();
  const dispatcher = buildDispatcher(scenario.fixture);
  const toolCalls: EvalToolCallRecord[] = [];

  const conversation: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: MAIN_SYSTEM_PROMPT },
    { role: "system", content: serializeFixtureContext(scenario.fixture) },
    ...(scenario.input.chatHistory ?? []).map((m) => ({
      role: m.role,
      content: m.content,
    })),
    { role: "user", content: scenario.input.userMessage },
  ];

  let iterations = 0;
  let finalText = "";

  while (iterations < HARNESS_MAX_ITERATIONS) {
    iterations += 1;

    const resp = await client.chat.completions.create({
      model,
      messages: conversation,
      tools: HARNESS_TOOL_DEFS,
      tool_choice: "auto",
    });

    const choice = resp.choices[0];
    const msg = choice?.message;
    const text = msg?.content ?? "";
    // Narrow OpenAI's union (function tool call vs custom tool call) to
    // the function variant. We don't register any custom tools so this
    // filter only drops calls we couldn't have made anyway.
    const calls: FunctionToolCall[] = (msg?.tool_calls ?? []).filter(
      isFunctionToolCall
    );
    finalText = text;

    if (calls.length === 0) {
      break;
    }

    conversation.push({
      role: "assistant",
      content: text || null,
      tool_calls: calls.map((c) => ({
        id: c.id,
        type: "function" as const,
        function: { name: c.function.name, arguments: c.function.arguments },
      })),
    });

    for (const call of calls) {
      let parsedArgs: unknown;
      try {
        parsedArgs = JSON.parse(call.function.arguments || "{}");
      } catch {
        parsedArgs = {};
      }

      let result: unknown;
      try {
        result = await dispatcher(call.function.name, parsedArgs);
      } catch (err) {
        result = {
          error: "tool_failed",
          message: err instanceof Error ? err.message : String(err),
        };
      }

      const serialized = JSON.stringify(result);
      toolCalls.push({
        name: call.function.name,
        args: parsedArgs,
        resultPreview: serialized.slice(0, 300),
      });

      conversation.push({
        role: "tool",
        tool_call_id: call.id,
        content: serialized,
      });
    }
  }

  // Self-critique pass — mirrors orchestrator.ts. Catches a regression
  // of PLACEHOLDER_LEAK: if the agent re-acquires the habit of emitting
  // 〇〇 / {placeholder} / etc, we want the eval to fail loudly even
  // when the orchestrator's runtime retry would otherwise mask it.
  // We run the retry and report the BEST output, but the
  // `response_no_placeholder_leak` assertion checks the BEST output —
  // so a regression that's robust enough to leak twice still fails.
  //
  // engineer-54 — retry now drives a small tool loop. Without this the
  // retry pass became a punt: the model would emit `候補を直して再度返信文
  // を作り直します` (acknowledge without doing) and that text replaced
  // finalText, breaking the downstream scenario assertions. Mirrors the
  // orchestrator.ts retry-with-tools pattern (PR #235): one round of
  // tool calls allowed, then one final text-only pass.
  if (finalText.trim().length >= 20) {
    let retries = 0;
    while (retries < HARNESS_MAX_RETRY_AFTER_LEAK) {
      const leak = detectPlaceholderLeak(finalText);
      if (!leak.hasLeak) break;
      retries += 1;
      conversation.push({ role: "assistant", content: finalText });
      conversation.push({
        role: "system",
        content: buildPlaceholderLeakCorrection(leak.matched),
      });
      try {
        const retry = await client.chat.completions.create({
          model,
          messages: conversation,
          tools: HARNESS_TOOL_DEFS,
          tool_choice: "auto",
        });
        const retryMsg = retry.choices[0]?.message;
        const retryText = retryMsg?.content ?? "";
        const retryToolCalls = (retryMsg?.tool_calls ?? []).filter(
          isFunctionToolCall
        );

        if (retryToolCalls.length > 0) {
          // Execute the retry's tool calls and make one more text-only
          // pass so the model can compose a grounded response from the
          // fetched values. Matches the orchestrator's pattern.
          conversation.push({
            role: "assistant",
            content: retryText || null,
            tool_calls: retryToolCalls.map((c) => ({
              id: c.id,
              type: "function" as const,
              function: {
                name: c.function.name,
                arguments: c.function.arguments,
              },
            })),
          });
          for (const call of retryToolCalls) {
            let parsedArgs: unknown;
            try {
              parsedArgs = JSON.parse(call.function.arguments || "{}");
            } catch {
              parsedArgs = {};
            }
            let result: unknown;
            try {
              result = await dispatcher(call.function.name, parsedArgs);
            } catch (err) {
              result = {
                error: "tool_failed",
                message:
                  err instanceof Error ? err.message : String(err),
              };
            }
            const serialized = JSON.stringify(result);
            toolCalls.push({
              name: call.function.name,
              args: parsedArgs,
              resultPreview: serialized.slice(0, 300),
            });
            conversation.push({
              role: "tool",
              tool_call_id: call.id,
              content: serialized,
            });
          }
          // Final text-only pass.
          const finalPass = await client.chat.completions.create({
            model,
            messages: conversation,
          });
          const finalPassText =
            finalPass.choices[0]?.message?.content ?? "";
          if (finalPassText.length > 0) {
            const finalLeak = detectPlaceholderLeak(finalPassText);
            if (!finalLeak.hasLeak) {
              finalText = finalPassText;
            }
          }
        } else if (retryText.length > 0) {
          // No tool calls — accept the retry text only if it's longer
          // than the original (heuristic guard against punt-style
          // "I'll redo this" replies that strip substantive content).
          const retryLeak = detectPlaceholderLeak(retryText);
          if (
            !retryLeak.hasLeak &&
            retryText.length >= finalText.length * 0.6
          ) {
            finalText = retryText;
          }
        }
      } catch {
        // best-effort; keep the original text
        break;
      }
    }
  }

  return {
    finalText,
    toolCalls,
    iterations,
    durationMs: Date.now() - start,
  };
}

// ---------- Assertion evaluation ----------

export function evaluateAssertions(
  result: EvalRunResult,
  assertions: EvalAssertion[]
): EvalAssertionResult[] {
  return assertions.map((a) => evaluateOne(result, a));
}

function evaluateOne(
  result: EvalRunResult,
  assertion: EvalAssertion
): EvalAssertionResult {
  switch (assertion.kind) {
    case "tool_called": {
      const calls = result.toolCalls.filter((c) => c.name === assertion.name);
      const argsOk = assertion.argsMatch
        ? calls.some((c) => assertion.argsMatch!(c.args))
        : true;
      const min = assertion.minTimes ?? 1;
      const max = assertion.maxTimes ?? Infinity;
      const pass = calls.length >= min && calls.length <= max && argsOk;
      return {
        label: `tool_called: ${assertion.name}${
          assertion.minTimes ? ` (≥${assertion.minTimes}x)` : ""
        }${assertion.maxTimes ? ` (≤${assertion.maxTimes}x)` : ""}`,
        pass,
        message: pass
          ? undefined
          : `Expected ≥${min} call(s)${
              max !== Infinity ? ` and ≤${max}` : ""
            }, got ${calls.length}${
              assertion.argsMatch && calls.length > 0 && !argsOk
                ? " (none matched argsMatch)"
                : ""
            }.`,
      };
    }
    case "tool_not_called": {
      const calls = result.toolCalls.filter((c) => c.name === assertion.name);
      const pass = calls.length === 0;
      return {
        label: `tool_not_called: ${assertion.name}`,
        pass,
        message: pass
          ? undefined
          : `Expected 0 calls, got ${calls.length}.`,
      };
    }
    case "tool_call_order": {
      const seq = assertion.sequence;
      let i = 0;
      for (const c of result.toolCalls) {
        if (c.name === seq[i]) i += 1;
        if (i >= seq.length) break;
      }
      const pass = i >= seq.length;
      return {
        label: `tool_call_order: ${seq.join(" → ")}`,
        pass,
        message: pass
          ? undefined
          : `Sequence not satisfied. Matched ${i}/${seq.length}. Actual order: ${result.toolCalls
              .map((c) => c.name)
              .join(" → ")}`,
      };
    }
    case "response_contains": {
      const haystack = assertion.caseSensitive
        ? result.finalText
        : result.finalText.toLowerCase();
      const needle = assertion.caseSensitive
        ? assertion.text
        : assertion.text.toLowerCase();
      const pass = haystack.includes(needle);
      return {
        label: `response_contains: ${JSON.stringify(assertion.text)}`,
        pass,
        message: pass
          ? undefined
          : `Final text did not contain expected substring.\n   Actual: ${truncate(
              result.finalText,
              400
            )}`,
      };
    }
    case "response_does_not_contain": {
      const haystack = assertion.caseSensitive
        ? result.finalText
        : result.finalText.toLowerCase();
      const needle = assertion.caseSensitive
        ? assertion.text
        : assertion.text.toLowerCase();
      const pass = !haystack.includes(needle);
      return {
        label: `response_does_not_contain: ${JSON.stringify(assertion.text)}`,
        pass,
        message: pass
          ? undefined
          : `Final text contained forbidden substring "${assertion.text}".\n   Actual: ${truncate(
              result.finalText,
              400
            )}`,
      };
    }
    case "response_no_placeholder_leak": {
      const leak = detectPlaceholderLeak(result.finalText);
      const pass = !leak.hasLeak;
      return {
        label: "response_no_placeholder_leak",
        pass,
        message: pass
          ? undefined
          : `PLACEHOLDER_LEAK detected: ${leak.matched.join(", ")}.\n   Actual: ${truncate(
              result.finalText,
              400
            )}`,
      };
    }
    case "response_matches": {
      const pass = assertion.regex.test(result.finalText);
      return {
        label: `response_matches: ${assertion.regex.toString()}`,
        pass,
        message: pass
          ? undefined
          : `Final text did not match regex.\n   Actual: ${truncate(
              result.finalText,
              400
            )}`,
      };
    }
    case "response_does_not_match": {
      const pass = !assertion.regex.test(result.finalText);
      return {
        label: `response_does_not_match: ${assertion.regex.toString()}`,
        pass,
        message: pass
          ? undefined
          : `Final text matched a forbidden regex.\n   Actual: ${truncate(
              result.finalText,
              400
            )}`,
      };
    }
    case "custom": {
      const out = assertion.check(result);
      return {
        label: `custom: ${assertion.label}`,
        pass: out.pass,
        message: out.message,
      };
    }
  }
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n) + "…";
}

// ---------- Convenience: run + assert in one call ----------

export async function evaluateScenario(
  scenario: EvalScenario
): Promise<EvalReport> {
  const result = await runScenario(scenario);
  const assertions = evaluateAssertions(result, scenario.expect);
  return {
    scenarioName: scenario.name,
    failureMode: scenario.failureMode,
    passed: assertions.every((a) => a.pass),
    assertions,
    result,
  };
}

// ---------- Inlined TZ conversion (matches lib/agent/tools/convert-timezone) ----------
//
// Duplicated here so the harness module doesn't pull in `server-only`
// via the real tool file. The semantics are identical — same Intl
// DateTimeFormat approach — so a regression in the harness math
// surfaces immediately in `harness.test.ts`. If the real
// convertTimezoneSync ever diverges, this code is the next stop.

type ConvertTimezoneResult = {
  toIso: string;
  toDisplay: string;
  fromDisplay: string;
  weekdayChanged: boolean;
};

function convertTimezoneInline(args: {
  time: string;
  fromTz: string;
  toTz: string;
  locale: "en" | "ja";
}): ConvertTimezoneResult {
  const { time, fromTz, toTz, locale } = args;
  assertValidIana(fromTz, "fromTz");
  assertValidIana(toTz, "toTz");
  const instant = parseToInstant(time, fromTz);
  return {
    toIso: formatIsoWithOffset(instant, toTz),
    toDisplay: formatHumanDisplay(instant, toTz, locale),
    fromDisplay: formatHumanDisplay(instant, fromTz, locale),
    weekdayChanged: computeWeekdayChanged(instant, fromTz, toTz),
  };
}

function assertValidIana(tz: string, paramName: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    throw new Error(`Invalid IANA timezone for ${paramName}: ${tz}`);
  }
}

function parseToInstant(time: string, fromTz: string): Date {
  if (hasExplicitOffset(time)) {
    const d = new Date(time);
    if (Number.isNaN(d.getTime())) {
      throw new Error(`Invalid time string: ${time}`);
    }
    return d;
  }
  return wallClockToUtc(time, fromTz);
}

function hasExplicitOffset(s: string): boolean {
  if (s.endsWith("Z") || s.endsWith("z")) return true;
  return /\d[+-]\d{2}:?\d{2}$/.test(s);
}

function wallClockToUtc(time: string, tz: string): Date {
  const wall = parseWallClock(time);
  let guess = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second
  );
  for (let i = 0; i < 2; i++) {
    const offsetMs = computeOffsetMs(new Date(guess), tz);
    guess =
      Date.UTC(
        wall.year,
        wall.month - 1,
        wall.day,
        wall.hour,
        wall.minute,
        wall.second
      ) - offsetMs;
  }
  return new Date(guess);
}

type WallClock = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function parseWallClock(s: string): WallClock {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(s);
  if (!m) {
    throw new Error(`Unrecognized wall-clock format: ${s}`);
  }
  return {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4]),
    minute: Number(m[5]),
    second: m[6] ? Number(m[6]) : 0,
  };
}

function computeOffsetMs(instant: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "longOffset",
  }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const offsetRaw = get("timeZoneName");
  if (!offsetRaw || offsetRaw === "GMT") return 0;
  const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(offsetRaw);
  if (!m) return 0;
  const sign = m[1] === "-" ? -1 : 1;
  const h = Number(m[2]);
  const min = Number(m[3] ?? "0");
  return sign * (h * 60 + min) * 60 * 1000;
}

function formatIsoWithOffset(instant: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "longOffset",
  }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  let hour = get("hour");
  if (hour === "24") hour = "00";
  const offsetRaw = get("timeZoneName");
  const offset =
    offsetRaw && offsetRaw !== "GMT" ? offsetRaw.replace("GMT", "") : "+00:00";
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get(
    "minute"
  )}:${get("second")}${offset}`;
}

function formatHumanDisplay(
  instant: Date,
  tz: string,
  locale: "en" | "ja"
): string {
  const intlLocale = locale === "ja" ? "ja-JP" : "en-US";
  const dateFmt = new Intl.DateTimeFormat(intlLocale, {
    timeZone: tz,
    month: locale === "ja" ? "long" : "short",
    day: "numeric",
    weekday: "short",
  });
  const timeFmt = new Intl.DateTimeFormat(intlLocale, {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const datePart = dateFmt.format(instant);
  const timePart = timeFmt.format(instant);
  const tzAbbr = resolveTzAbbreviation(instant, tz);
  return `${datePart} ${timePart} ${tzAbbr}`;
}

function resolveTzAbbreviation(instant: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    timeZoneName: "short",
  }).formatToParts(instant);
  const abbr = parts.find((p) => p.type === "timeZoneName")?.value;
  if (!abbr) return tz;
  if (/^GMT[+-]?\d/.test(abbr)) return tz;
  return abbr;
}

function computeWeekdayChanged(
  instant: Date,
  fromTz: string,
  toTz: string
): boolean {
  return formatYmd(instant, fromTz) !== formatYmd(instant, toTz);
}

function formatYmd(instant: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// Re-export for tests
export const __testing = {
  convertTimezoneInline,
  buildDispatcher,
  normalizeFixture,
  HARNESS_TOOL_DEFS,
};

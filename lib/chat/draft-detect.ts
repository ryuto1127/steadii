// engineer-63 — heuristic detection of a draft-email-shaped code block inside
// an assistant message + extraction of the reply target from the assistant
// turn's accumulated tool_calls (sparring PR #260 made tool_calls accumulate
// across iterations, which is what makes this resolvable client-side without
// a schema migration).
//
// Pure functions, no I/O — wired into MarkdownMessage and unit-tested.

export type DraftConfidence = "confident" | "maybe";

export type DraftBlock = {
  // The fenced code-block body, with surrounding ``` fences stripped. This is
  // the text the Send button would dispatch and the Edit textarea pre-fills.
  body: string;
  // Confident = both a greeting AND a closing marker. Maybe = one of the two
  // (smaller affordance + tooltip per handoff Part 3 edge case).
  confidence: DraftConfidence;
  // Character offsets into the original message content. Used by /api/chat/
  // draft-edit to slice out the body and substitute new content while keeping
  // the surrounding prose + meta-commentary intact.
  bodyStart: number;
  bodyEnd: number;
};

// Greeting markers — JP + EN forms commonly used in academic / professional
// email. Keep this list short on purpose: false positives (e.g. a code snippet
// that happens to contain "Dear" in a string literal) are worse than missing
// a casual draft, because the action bar appears with destructive Send.
const GREETING_MARKERS = [
  "お世話になっております",
  "お世話になります",
  "お疲れ様",
  "お疲れさま",
  "Dear ",
  "Hi ",
  "Hello ",
  "Hello,",
  "Hi,",
];

const CLOSING_MARKERS = [
  "よろしくお願いいたします",
  "よろしくお願い致します",
  "よろしくお願いします",
  "Best,",
  "Best regards,",
  "Sincerely,",
  "Kind regards,",
  "Thanks,",
  "Thank you,",
];

// Minimum body length below which we treat it as a non-draft (filters out
// trivial snippets like `pnpm typecheck`, single SQL statements, etc.).
const MIN_BODY_LENGTH = 100;

// Matches a fenced code block: optional language tag after ```, then any
// content, then ``` on its own line (or at end). The `s` flag lets `.` match
// newlines for the body capture.
const FENCED_CODE_RE = /```[\w-]*\n([\s\S]*?)```/g;

function hasGreeting(body: string): boolean {
  return GREETING_MARKERS.some((m) => body.includes(m));
}

function hasClosing(body: string): boolean {
  return CLOSING_MARKERS.some((m) => body.includes(m));
}

// Scan an assistant message's content for fenced code blocks that look like
// drafted emails. Returns one entry per qualifying block in order of
// appearance.
export function detectDraftBlocks(content: string): DraftBlock[] {
  if (!content) return [];
  const out: DraftBlock[] = [];
  // Reset lastIndex defensively — the regex is a module-level value with the
  // `g` flag, which makes it stateful per-execution context. Tests / repeated
  // calls would otherwise resume from a leftover position.
  FENCED_CODE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FENCED_CODE_RE.exec(content)) !== null) {
    const body = m[1].trimEnd();
    if (body.length < MIN_BODY_LENGTH) continue;
    const greet = hasGreeting(body);
    const close = hasClosing(body);
    if (!greet && !close) continue;
    const confidence: DraftConfidence = greet && close ? "confident" : "maybe";
    out.push({
      body,
      confidence,
      bodyStart: m.index + m[0].indexOf(m[1]),
      bodyEnd: m.index + m[0].indexOf(m[1]) + m[1].length,
    });
  }
  return out;
}

// Replace a draft block's body inside the original assistant message content,
// preserving the surrounding prose + the code fences themselves. Used by
// /api/chat/draft-edit to update messages.content. The slice math relies on
// bodyStart/End from a fresh detectDraftBlocks() call against the unmodified
// content — if the content has drifted (e.g. agent re-streamed in between),
// the caller should re-detect, not reuse stale offsets.
export function replaceDraftBody(
  content: string,
  block: DraftBlock,
  newBody: string
): string {
  return (
    content.slice(0, block.bodyStart) +
    newBody +
    content.slice(block.bodyEnd)
  );
}

// Shape of a single entry in the persisted messages.tool_calls JSON array.
// Mirrors OpenAI's chat.completions tool-call wire format because that's what
// the orchestrator writes (lib/agent/orchestrator.ts → persistedToolCalls).
export type StoredToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

// Walk an assistant turn's tool_calls in reverse and return the inboxItemId
// of the most-recent email body fetch. That fetch is the strongest signal
// the agent grounded its draft in a specific inbound email — the body
// chunk is what the agent read before composing the reply, so its inbox_item
// is the right reply target.
//
// Both `email_get_body` and `email_get_new_content_only` count; the agent
// uses the latter on reply-intent turns (engineer-62) but historically used
// the former, and chats opened from older sessions may have either shape.
export function extractReplyTargetInboxItemId(
  toolCalls: unknown
): string | null {
  if (!Array.isArray(toolCalls)) return null;
  const calls = toolCalls as StoredToolCall[];
  for (let i = calls.length - 1; i >= 0; i--) {
    const c = calls[i];
    if (!c || typeof c !== "object") continue;
    const name = c.function?.name;
    if (
      name !== "email_get_body" &&
      name !== "email_get_new_content_only"
    ) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(c.function.arguments || "{}");
    } catch {
      continue;
    }
    const id = (parsed as { inboxItemId?: unknown })?.inboxItemId;
    if (typeof id === "string" && id.length > 0) return id;
  }
  return null;
}

// Auto-prefix subject with "Re: " unless it already starts with one (case-
// insensitive). Avoids "Re: Re: Re:" stacking when the original subject
// itself was already a reply.
export function buildReplySubject(originalSubject: string | null): string {
  const trimmed = (originalSubject ?? "").trim();
  if (!trimmed) return "Re:";
  if (/^re\s*:/i.test(trimmed)) return trimmed;
  return `Re: ${trimmed}`;
}

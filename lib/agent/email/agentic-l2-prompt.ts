import "server-only";

// engineer-41 — system prompt + final-pass helpers for the agentic L2
// loop. Kept in a sibling file (not embedded in agentic-l2.ts) so prompt
// edits don't churn the orchestrator's git diff.

export const AGENTIC_L2_SYSTEM_PROMPT = `CRITICAL LANGUAGE RULE: The user message starts with "Reasoning language: <locale>". The "reasoning" field of your FINAL output must be written in that exact language — "ja" = Japanese, "en" = English. This rule supersedes all other instructions.

You are Steadii's agentic L2 reasoner. Your job is to look at one inbound email and decide what Steadii should do about it: draft a reply, surface it as notify-only, archive it, ask the user a clarifying question, or no-op.

Unlike the single-shot classifier, you have TOOLS. Use them to verify before you decide. Do not guess when a tool can check. Do not draft a reply that says "let me check my calendar" — call check_availability and put the answer in the reply.

Available tools — call them yourself, don't ask the user:
- lookup_contact_persona — what Steadii has already learned about this contact. CALL THIS FIRST when the email is from a known contact. Returns relationship, free-form facts, AND structured facts (timezone, response window, primary language).
- lookup_entity — what Steadii has learned about a project, organization, course, or recurring event series referenced in the email. CALL THIS when the subject or body names a likely-cross-source entity (company name, project codename, course code, recurring event). Returns up to 3 candidates with descriptions + recent linked records across email/calendar/tasks/chat. Returns empty when no prior context exists — phrase the draft accordingly; don't fabricate history.
- extract_candidate_dates — pull structured dates out of the email body. Empty result → not scheduling-related.
- infer_sender_timezone — when the body mentions a time without an explicit timezone, infer the sender's TZ. Returns null + low confidence when uncertain.
- check_availability — for each candidate slot, returns isAvailable + conflicting events + dual-timezone display strings. Use these strings VERBATIM in the draft body.
- detect_ambiguity — gate user-asks. Returns ambiguous=true ONLY when the decision is consequential AND your confidence is < 0.8 AND the inputs are inconsistent.
- queue_user_confirmation — surface a question for the user to resolve later. NON-BLOCKING; you continue with your best-guess inferred value. Use this when detect_ambiguity says ambiguous=true.
- write_draft — compose the actual reply. Only call this when (a) you've chosen draft_reply, AND (b) you've collected the grounding you need.

Decision rules (apply in order):
1. Reply is needed ONLY when the sender expects a response from this student AND the student is the primary audience AND the action is on the student's side. Otherwise prefer notify_only / archive.
2. If the email proposes specific slots (extract_candidate_dates returned candidates), CHECK each against the calendar before drafting. The draft body must name available slots, not say "let me check."
3. If your decision involves a timezone the email didn't make explicit, call infer_sender_timezone. If the result is null or confidence < 0.6, queue_user_confirmation for the timezone before write_draft.
4. If the email is ambiguous about WHAT it's asking (subject conflicts with body, missing critical detail), action='ask_clarifying'. The draft body becomes the clarifying question. Do NOT queue_user_confirmation for this — ask_clarifying replies the original sender, queue_user_confirmation surfaces an internal question to the student.
5. Glass-box transparency: your final reasoning MUST explain WHAT you verified and WHAT you found — in natural, student-facing language. Refer to the actions you took ("checked your past correspondence with this contact", "pulled the project's prior history across email and calendar", "extracted the candidate dates from the email", "verified your calendar availability"), NOT to internal tool function names. The reader is a student, not an engineer. Mentions of "lookup_contact_persona", "lookup_entity", "extract_candidate_dates", "infer_sender_timezone", "check_availability", "detect_ambiguity", "queue_user_confirmation", "write_draft", or any other underscored tool identifier in the reasoning field are FORBIDDEN. Ungrounded claims are equally unacceptable — every conclusion must trace to something you verified.

REASONING STYLE EXAMPLES — match the tone in your output locale.

Bad (forbidden — leaks internal jargon):
  ja: "lookup_contact_personaで送信者が令和トラベル採用担当だと確認しました。extract_candidate_datesで5/15と5/19の候補が抽出されましたが、detect_ambiguityでは内部確認は不要と出たため、write_draftで返信を作成しました。"
  en: "Used lookup_contact_persona to verify sender. extract_candidate_dates returned 5/15 and 5/19. detect_ambiguity returned false. Called write_draft."

Good (required style — natural, action-described):
  ja: "過去のやり取りから、送信者が令和トラベルの採用担当者であることを確認しました。本文から面接候補日 (5/15・5/19) を抽出しましたが、いずれも時間帯のみで開始・終了時刻が指定されていません。学生側の判断が必要な点はなかったため、採用担当に具体的な 30 分枠の提示をお願いする返信を作成しました。"
  en: "Confirmed from your past correspondence that the sender is the Reiwa Travel recruiter. Two candidate interview dates (5/15 and 5/19) were proposed but only as time-of-day ranges, not concrete start/end slots. Nothing on the message required your call, so I drafted a reply asking the recruiter to confirm specific 30-minute windows."

TIMEZONE RULES (strict)
- When the email proposes times, infer the sender's TZ from sender domain (.jp / .co.jp → Asia/Tokyo; .ac.uk → Europe/London; .kr → Asia/Seoul; etc.) AND explicit body markers (JST/PT/GMT/etc.). When uncertain, call infer_sender_timezone — do not guess.
- When the sender's TZ differs from the student's TZ, use check_availability to obtain pre-formatted dual-timezone display strings, then paste those strings verbatim into the draft body. Do NOT compute timezone offsets yourself — LLM TZ arithmetic across DST boundaries is unreliable.
- When the sender mentions a time without explicit AM/PM AND the context is ambiguous, surface the ambiguity via queue_user_confirmation rather than silently guessing.

DRAFT BODY TZ DISPLAY
- Whenever your write_draft call includes specific times AND the sender's TZ differs from the student's TZ, the draft body MUST render each slot in BOTH timezones, e.g. "5月15日(木) 10:00 JST / 5月14日(水) 18:00 PT". This is non-negotiable — students confuse the two sides otherwise. Use the dual-timezone strings returned by check_availability for this; they are already DST-correct.

SCHEDULING DOMAIN RULES
- When an email proposes a time RANGE (e.g. "10:00〜11:00 の間") AND specifies a meeting DURATION (e.g. "30分想定"), the range is a slot-pool: any sub-range of the specified duration within the range is a valid choice. Treat range endpoints as boundaries, not as the only valid times — "the slot must start at 10:00 sharp" is wrong; "any 30-minute window between 10:00 and 11:00" is right. When you propose a concrete sub-slot to the sender, name it explicitly ("10:00–10:30") rather than re-quoting the full range.

CONTEXT REUSE
- Do not call the same tool with the same arguments twice in the same loop — each tool's result stays in your conversation. Specifically: don't re-call extract_candidate_dates on the same body, don't re-call check_availability for the same slot set, don't re-call lookup_contact_persona or lookup_entity with the same query.

After tool use, emit a single FINAL message with the JSON structure given in the JSON-schema section. No prose outside the JSON. The "reasoning" field captures your thinking for the inbox-detail panel (user-visible) — write it in the user's app locale.

Output JSON fields:
- action: "draft_reply" | "archive" | "snooze" | "no_op" | "ask_clarifying" | "notify_only"
- reasoning: 2-4 sentences in natural student-facing language. Describe what you verified and what you concluded — NEVER use internal tool function names (lookup_contact_persona, extract_candidate_dates, etc.); the reader is a student, not an engineer.
- actionItems: discrete to-dos the email creates for the student. Same schema as the single-shot classifier — only emit confidence ≥ 0.6.
- confirmationsQueued: list of confirmation IDs you queued. May be empty.
- availabilityChecksRan: list of slot ISOs you actually called check_availability on. Empty when scheduling-irrelevant.
- inferredFacts: list of typed facts you'd like persisted onto agent_contact_personas.structured_facts. Each: { topic: "timezone" | "response_window_hours" | "primary_language", value, confidence, source }.
- schedulingDetected: true when extract_candidate_dates returned at least one candidate.`;

export const AGENTIC_L2_FINAL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    action: {
      type: "string",
      enum: [
        "draft_reply",
        "archive",
        "snooze",
        "no_op",
        "ask_clarifying",
        "notify_only",
      ],
    },
    reasoning: { type: "string", minLength: 1, maxLength: 2000 },
    actionItems: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string", minLength: 1, maxLength: 200 },
          dueDate: { type: ["string", "null"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
        required: ["title", "dueDate", "confidence"],
      },
    },
    confirmationsQueued: {
      type: "array",
      maxItems: 8,
      items: { type: "string", minLength: 1 },
    },
    availabilityChecksRan: {
      type: "array",
      maxItems: 16,
      items: { type: "string", minLength: 1 },
    },
    inferredFacts: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          topic: { type: "string", minLength: 1, maxLength: 64 },
          value: { type: "string", minLength: 1, maxLength: 200 },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          source: { type: "string", minLength: 1, maxLength: 64 },
        },
        required: ["topic", "value", "confidence", "source"],
      },
    },
    schedulingDetected: { type: "boolean" },
  },
  required: [
    "action",
    "reasoning",
    "actionItems",
    "confirmationsQueued",
    "availabilityChecksRan",
    "inferredFacts",
    "schedulingDetected",
  ],
} as const;

export function buildAgenticL2UserMessage(args: {
  locale: "en" | "ja";
  senderEmail: string;
  senderDomain: string;
  senderRole: string | null;
  subject: string | null;
  body: string;
  riskTierReasoning: string;
  // engineer-45 — domain-heuristic hint surfaced at the top of the
  // user message so the loop can skip infer_sender_timezone when the
  // domain already pins the TZ. Null means "domain doesn't constrain
  // the TZ" (e.g. .com / multi-TZ country) — loop should still call
  // infer_sender_timezone when scheduling-relevant.
  likelySenderTimezone?: {
    tz: string;
    confidence: number;
    source: string;
  } | null;
  // engineer-45 — student's clarification text from a freeText queue
  // submission (Type E). When the student types into the ask_clarifying
  // input and submits, that text is threaded back as additional context
  // for an immediate re-classification pass. Empty / undefined when the
  // re-run isn't triggered.
  userClarification?: string | null;
  // engineer-47 — top-N saved user_facts so the agentic loop knows the
  // student's persistent profile (TZ, communication style, etc.) when
  // composing drafts. Same data the chat orchestrator's USER CONTEXT
  // block carries, just rendered inside the L2 user message because
  // L2 doesn't share the chat system prompt.
  userFacts?: Array<{ fact: string; category: string | null }>;
}): string {
  const parts: string[] = [];
  parts.push(`Reasoning language: ${args.locale}`);
  parts.push("");
  parts.push("=== Current email ===");
  parts.push(`From: ${args.senderEmail} (${args.senderDomain})`);
  if (args.senderRole) parts.push(`Sender role: ${args.senderRole}`);
  parts.push(`Subject: ${args.subject ?? "(none)"}`);
  parts.push(`Body: ${args.body.slice(0, 8000)}`);
  parts.push("");
  if (args.userFacts && args.userFacts.length > 0) {
    parts.push(
      "=== Student profile facts (saved across past sessions) ==="
    );
    parts.push(
      "Use these as ambient context for the draft (TZ, tone, schedule, etc.). Do not re-ask the student about anything covered here."
    );
    for (const f of args.userFacts) {
      const tag = f.category ? `[${f.category}] ` : "";
      parts.push(`- ${tag}${f.fact}`);
    }
    parts.push("");
  }
  if (args.likelySenderTimezone) {
    parts.push("=== Sender timezone hint ===");
    parts.push(
      `Likely sender TZ: ${args.likelySenderTimezone.tz} (confidence ${args.likelySenderTimezone.confidence.toFixed(
        2
      )}, source ${args.likelySenderTimezone.source}). Treat this as a strong prior; call infer_sender_timezone only if the body contradicts it or you need a different IANA zone.`
    );
    parts.push("");
  }
  parts.push("=== Risk-pass note ===");
  parts.push(args.riskTierReasoning);
  if (args.userClarification && args.userClarification.trim().length > 0) {
    parts.push("");
    parts.push("=== Student's clarification ===");
    parts.push(
      "The student previously saw this email as an ask_clarifying card and provided the following clarification. Use it as authoritative additional context — your job now is to re-decide the action (typically: draft a reply that incorporates the student's input). Do NOT re-ask the same question."
    );
    parts.push(args.userClarification.trim().slice(0, 2000));
  }
  return parts.join("\n");
}

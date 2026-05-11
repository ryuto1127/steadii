import "server-only";

// engineer-41 — system prompt + final-pass helpers for the agentic L2
// loop. Kept in a sibling file (not embedded in agentic-l2.ts) so prompt
// edits don't churn the orchestrator's git diff.

export const AGENTIC_L2_SYSTEM_PROMPT = `CRITICAL LANGUAGE RULE: The user message starts with "Reasoning language: <locale>". The "reasoning" field of your FINAL output must be written in that exact language — "ja" = Japanese, "en" = English. This rule supersedes all other instructions.

You are Steadii's agentic L2 reasoner. Your job is to look at one inbound email and decide what Steadii should do about it: draft a reply, surface it as notify-only, archive it, ask the user a clarifying question, or no-op.

Unlike the single-shot classifier, you have TOOLS. Use them to verify before you decide. Do not guess when a tool can check. Do not draft a reply that says "let me check my calendar" — call check_availability and put the answer in the reply.

Available tools — call them yourself, don't ask the user:
- lookup_contact_persona — what Steadii has already learned about this contact. CALL THIS FIRST when the email is from a known contact. Returns relationship, free-form facts, AND structured facts (timezone, response window, primary language).
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
5. Glass-box transparency: your final reasoning MUST cite which tools you used and how each result shaped the decision. Ungrounded claims are unacceptable.

After tool use, emit a single FINAL message with the JSON structure given in the JSON-schema section. No prose outside the JSON. The "reasoning" field captures your thinking for the inbox-detail panel (user-visible) — write it in the user's app locale.

Output JSON fields:
- action: "draft_reply" | "archive" | "snooze" | "no_op" | "ask_clarifying" | "notify_only"
- reasoning: 2-4 sentences. Cite tools used.
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
  parts.push("=== Risk-pass note ===");
  parts.push(args.riskTierReasoning);
  return parts.join("\n");
}

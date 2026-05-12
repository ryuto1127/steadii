import "server-only";
import { inferSenderTzFromDomain } from "../email/sender-timezone-heuristic";

// engineer-46 — kept here (not re-exported from orchestrator) so the
// prompt module has no upward dependency on the orchestrator file.
// The orchestrator imports this type back from here.
export type ClarificationSeed = {
  originalDraftId: string;
  reasoning: string | null;
  draftBody: string | null;
  senderEmail: string;
  senderDomain: string;
  senderName: string | null;
  subject: string | null;
  bodyForPipeline: string;
  receivedAt: string;
};

// engineer-46 — system prompt block prepended to a chat opened from a
// Type E ask_clarifying queue card. Tells the model:
//   1. why the chat exists (it is the multi-turn continuation of an
//      agentic L2 reasoning pass that paused on ambiguity),
//   2. what the original email said + the ambiguity that triggered the
//      pause (L2's saved `reasoning` field),
//   3. how to finish (call resolve_clarification once you have enough
//      info to draft, closing the original card in the queue),
//   4. iteration cap so the model doesn't loop on the student forever.
//
// Keep this stable-prefix-friendly — variable bits (sender / subject /
// body) ride at the end so prompt-cache hits land on the policy block.

const STABLE_PREFIX = [
  "# CLARIFICATION CHAT MODE",
  "",
  "This chat session is the multi-turn continuation of an agentic L2 email-reasoning pass. The previous pass decided it lacked context to draft a reply and surfaced a Type E ask_clarifying card to the student. The student clicked “Steadii と話す” instead of typing into the inline textarea, so they want to work the answer out with you collaboratively.",
  "",
  "Your job:",
  "1. Ask the student short, specific questions — one or two at a time, not a checklist — to gather the missing context.",
  "2. Reuse anything you can already infer from the email (sender, subject, body snippet). Do NOT re-ask facts the email itself answers.",
  "3. When you've collected enough to act, call `write_draft` to compose the reply, then call `resolve_clarification` with the draft fields and a short student-facing `reasoning`. That closes the original card in the queue and inserts a new draft for the student to review.",
  "4. If the student decides the email needs no reply, call `resolve_clarification` with newAction = 'notify_only' (or 'no_op' when the email is mooted) — same shape, body can be a one-line stub.",
  "",
  "Iteration cap: at most ~8 student turns. If by then the answer still isn't clear, call `resolve_clarification` with newAction = 'ask_clarifying' and a body that captures the best clarifying question you can pose to the original sender, then explain what you did to the student.",
  "",
  "Style:",
  "- Match the student's app locale. Switch with them if they switch.",
  "- Be terse. The student wants a short Q-and-A, not a lecture.",
  "- Never name internal tool functions in chat or in `reasoning`. Refer to actions in plain language (\"I'll check your calendar\", not \"I'll call check_availability\").",
  "- Timezone display follows the same dual-TZ rule as agentic L2 drafts: when the sender's TZ differs from the student's, use `convert_timezone` and paste both sides into anything you draft.",
];

export function buildClarificationSeedPrompt(
  seed: ClarificationSeed
): string {
  const tzHint = inferSenderTzFromDomain(seed.senderDomain);
  const lines: string[] = [];
  lines.push(...STABLE_PREFIX);
  lines.push("");
  lines.push("## Original email");
  lines.push(
    `From: ${seed.senderEmail} (${seed.senderDomain})${seed.senderName ? ` — ${seed.senderName}` : ""}`
  );
  lines.push(`Subject: ${seed.subject ?? "(none)"}`);
  lines.push(`Received: ${seed.receivedAt}`);
  if (tzHint.tz) {
    lines.push(
      `Likely sender TZ (domain heuristic): ${tzHint.tz} (confidence ${tzHint.confidence.toFixed(2)}, source ${tzHint.source ?? "unknown"}). Treat as a prior; verify against explicit body markers when they appear.`
    );
  }
  lines.push("");
  lines.push("Body (snippet — fetch full body with `email_get_body` if you need more):");
  lines.push(seed.bodyForPipeline.slice(0, 8000));
  lines.push("");
  lines.push("## Why the agentic pass paused");
  lines.push(
    seed.reasoning?.trim() ||
      "(No reasoning was saved on the original draft. Treat the email as fully ambiguous and ask the student what they want to do.)"
  );
  if (seed.draftBody && seed.draftBody.trim().length > 0) {
    lines.push("");
    lines.push("## Clarifying question shown on the card");
    lines.push(seed.draftBody.trim());
  }
  lines.push("");
  lines.push("## Resolution call");
  lines.push(
    `When you call resolve_clarification, pass originalDraftId = "${seed.originalDraftId}". The chat will keep working after the call, but the queue card will close and a new draft will appear for the student to send.`
  );
  return lines.join("\n");
}

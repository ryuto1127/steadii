import "server-only";
import type { FanoutResult } from "./fanout";

// Re-export so callers can import the type from a single place when they
// only need the prompt-builder + the shape.
export type { FanoutResult } from "./fanout";

// Per-source character caps. Per-source rather than a single total budget
// per locked decision §12.2 — easier to reason about, no cross-source
// merger truncation logic in v1.
//
// engineer-38 — `senderBody` replaces the prior `mistakeBody` slot. The
// caps stay the same per phase: 250/500/800 chars per past reply body.
const CAPS = {
  classify: {
    senderBody: 250,
    similarSentBody: 250,
    syllabusChunk: 250,
    calendarRows: 8,
  },
  draft: {
    senderBody: 500,
    similarSentBody: 500,
    syllabusChunk: 500,
    calendarRows: 25,
  },
  deep: {
    // High-risk drafts paid for the deep pass already. Per §5.3
    // risk-tier scaling, allow chars-per-row to scale up.
    senderBody: 800,
    similarSentBody: 800,
    syllabusChunk: 900,
    calendarRows: 25,
  },
};

export type FanoutPromptPhase = "classify" | "deep" | "draft";

// Render the fanout context as a sequence of clearly-labelled prompt
// blocks. Each block carries a stable footnote tag (mistake-1, syllabus-2,
// calendar-3, email-N) that the model is required to cite in its reasoning
// — the citation regex in `<ReasoningPanel />` keys off the same shape.
export function buildFanoutContextBlocks(
  fanout: FanoutResult,
  phase: FanoutPromptPhase
): string {
  const caps = CAPS[phase];
  const lines: string[] = [];

  // === Class binding ===
  lines.push("=== Class binding ===");
  if (fanout.classBinding.classId && fanout.classBinding.className) {
    const code = fanout.classBinding.classCode
      ? ` (${fanout.classBinding.classCode})`
      : "";
    lines.push(
      `Class: ${fanout.classBinding.className}${code} — bound by ${fanout.classBinding.method} (confidence ${fanout.classBinding.confidence.toFixed(2)})`
    );
  } else {
    lines.push(
      "(no class identified — fanout is vector-only across the user's corpus)"
    );
  }

  // === Contact persona (engineer-39) ===
  // Sets tone + register before any per-message context. The model is
  // instructed (in classify-deep / draft system prompts) NOT to echo
  // facts back unless the user asked. When no persona exists yet (first
  // interaction or persona-learner hasn't run), render a short empty
  // state so the model knows the absence is data, not a missing block.
  lines.push("");
  const persona = fanout.contactPersona;
  if (persona && (persona.relationship || persona.facts.length > 0)) {
    const header = persona.relationship
      ? `=== Contact persona — ${persona.relationship} ===`
      : "=== Contact persona ===";
    lines.push(header);
    if (persona.facts.length === 0) {
      lines.push("(relationship known, no specific facts learned yet)");
    } else {
      for (const f of persona.facts) {
        lines.push(`- ${f}`);
      }
    }
  } else {
    lines.push("=== Contact persona ===");
    lines.push(
      "(no learned persona — first interaction or fresh contact)"
    );
  }

  // === How you usually reply to this sender (N, most-recent first) ===
  // engineer-38 — replaces the legacy `mistake-N` slot. Per-source tag
  // is `self-N` so the citation regex (and future feedback UIs) can key
  // off a stable shape; "self" = past reply written by THIS user.
  lines.push("");
  lines.push(
    `=== How you usually reply to this sender (${fanout.senderHistory.length}, most-recent first) ===`
  );
  if (fanout.senderHistory.length === 0) {
    lines.push("(none — no past replies the user has sent to this sender)");
  } else {
    fanout.senderHistory.forEach((h, i) => {
      const date = h.sentAt.toISOString().slice(0, 10);
      const subj = h.draftSubject ?? "(no subject)";
      const body = (h.draftBody ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, caps.senderBody);
      lines.push(`self-${i + 1}: [${date}] Subject: "${subj}"`);
      lines.push(`  Body: "${body}"`);
    });
  }

  // === Similar emails you've written before (N) ===
  // 2026-05-08 — concrete few-shot examples for tone / register on
  // first-time recipients. Citation tag is `similar-N` so the model can
  // reference specific examples in its reasoning. Populated only on the
  // draft phase (see fanout.ts) — classify + deep get an empty list.
  lines.push("");
  lines.push(
    `=== Similar emails you've written before (${fanout.similarSent.length}) ===`
  );
  if (fanout.similarSent.length === 0) {
    lines.push(
      "(none — no past sent emails on similar topics, or this is the classify phase)"
    );
  } else {
    fanout.similarSent.forEach((s, i) => {
      const date = s.sentAt.toISOString().slice(0, 10);
      const subj = s.subject ?? "(no subject)";
      const recipient = s.recipientName ?? s.recipientEmail ?? "(unknown)";
      const body = s.body
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, caps.similarSentBody);
      lines.push(`similar-${i + 1}: [${date}] To: ${recipient} :: "${subj}"`);
      lines.push(`  Body: "${body}"`);
    });
  }

  // === Relevant syllabus sections (N) ===
  lines.push("");
  lines.push(
    `=== Relevant syllabus sections (${fanout.syllabusChunks.length}) ===`
  );
  if (fanout.syllabusChunks.length === 0) {
    lines.push("(none — no syllabus chunks above the relevance floor)");
  } else {
    fanout.syllabusChunks.forEach((c, i) => {
      const text = c.chunkText
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, caps.syllabusChunk);
      lines.push(
        `syllabus-${i + 1}: ${c.syllabusTitle} [sim=${c.similarity.toFixed(2)}] — ${text}`
      );
    });
  }

  // === Calendar (events + Google Tasks + Steadii assignments) ===
  lines.push("");
  const calendarTotal =
    fanout.calendar.events.length +
    fanout.calendar.tasks.length +
    fanout.calendar.assignments.length;
  lines.push(`=== Calendar (next days, ${calendarTotal} items) ===`);
  if (calendarTotal === 0) {
    lines.push(
      "(empty — calendar/tasks not connected or genuinely no items in the window)"
    );
  } else {
    let i = 0;
    for (const e of fanout.calendar.events.slice(0, caps.calendarRows)) {
      i++;
      const where = e.location ? ` @ ${e.location}` : "";
      lines.push(
        `calendar-${i}: ${e.start} → ${e.end} :: ${e.title}${where}`
      );
    }
    for (const t of fanout.calendar.tasks.slice(0, caps.calendarRows - i)) {
      i++;
      const status = t.completed ? " (done)" : "";
      const note = t.notes
        ? ` — ${t.notes.replace(/\s+/g, " ").trim().slice(0, 80)}`
        : "";
      lines.push(`calendar-${i}: due ${t.due} :: ${t.title}${status}${note}`);
    }
    for (const a of fanout.calendar.assignments.slice(
      0,
      caps.calendarRows - i
    )) {
      i++;
      const cls = a.className ? ` [${a.className}]` : "";
      const status = a.status === "done" ? " (done)" : ` (${a.status})`;
      lines.push(
        `calendar-${i}: due ${a.due} :: ${a.title}${cls}${status} [steadii]`
      );
    }
  }

  // Empty-corpus hint per §9.1 — when ALL structured signal sources are
  // empty (calendar can be empty for a different reason — disconnected),
  // prepend a hint so the model doesn't over-hedge. engineer-39: persona
  // joins this gate; it's the strongest sender-context signal for a
  // first-interaction contact.
  const personaEmpty =
    !persona ||
    (!persona.relationship && persona.facts.length === 0);
  if (
    fanout.senderHistory.length === 0 &&
    fanout.syllabusChunks.length === 0 &&
    personaEmpty
  ) {
    lines.unshift(
      "[Empty-corpus hint: this user has no past replies to this sender, learned persona, or relevant syllabus chunks. Reason from the email content alone.]",
      ""
    );
  }

  return lines.join("\n");
}

// Pure helpers for building the ChatGPT-handoff prompt + URL. Kept
// separate from chatgpt-handoff.ts (which pulls DB context) so unit
// tests can exercise the prompt logic without booting a DB / env.
//
// "Open in ChatGPT" lands the user at chatgpt.com with a pre-filled
// prompt via the `?prompt=` query param. ChatGPT supports this for
// unauthenticated and authenticated visitors alike.

const CHATGPT_BASE_URL = "https://chatgpt.com/";

// Cap to keep URLs under most browsers' practical 2-3KB ceiling.
// Empirically 1.5KB encoded → ~5KB once URL-encoded with non-ASCII
// (Japanese inflates significantly). 1500 is a safe budget.
const MAX_PROMPT_BYTES = 1500;

export type HandoffContext = {
  classes: {
    code: string | null;
    name: string;
    professor: string | null;
  }[];
  recentMistakes: { title: string }[];
};

export function buildHandoffPrompt(
  question: string,
  ctx: HandoffContext
): string {
  const lines: string[] = [];

  if (ctx.classes.length > 0) {
    lines.push(
      "Context: I'm a university student. Currently taking these classes:"
    );
    for (const c of ctx.classes) {
      const code = c.code ? `${c.code} ` : "";
      const prof = c.professor ? ` — Prof ${c.professor}` : "";
      lines.push(`- ${code}${c.name}${prof}`);
    }
    lines.push("");
  }

  if (ctx.recentMistakes.length > 0) {
    lines.push(
      "Recent topics I've struggled with (use to calibrate explanation depth):"
    );
    for (const m of ctx.recentMistakes) {
      lines.push(`- ${m.title}`);
    }
    lines.push("");
  }

  lines.push("My question:");
  lines.push(question.trim());

  if (ctx.classes.length > 0 || ctx.recentMistakes.length > 0) {
    lines.push("");
    lines.push(
      "Please answer with awareness of the above context. Default to undergraduate-level explanation unless I ask for deeper."
    );
  }

  return lines.join("\n");
}

export function buildHandoffUrl(prompt: string): string {
  const trimmed = trimPromptToBudget(prompt);
  const encoded = encodeURIComponent(trimmed);
  return `${CHATGPT_BASE_URL}?prompt=${encoded}`;
}

// Keeps the prompt under our self-imposed byte budget. We trim the
// CONTEXT bullets first, since the question itself is the thing the
// user actually wants ChatGPT to answer — losing a class entry is
// preferable to truncating the question.
function trimPromptToBudget(prompt: string): string {
  if (byteLen(prompt) <= MAX_PROMPT_BYTES) return prompt;
  const lines = prompt.split("\n");
  const questionIdx = lines.findIndex((l) => l === "My question:");
  if (questionIdx <= 0) {
    // Pathological — no context section. Hard-truncate the tail by
    // bytes (slice on bytes, not chars, so multibyte JP doesn't break).
    return sliceBytes(prompt, MAX_PROMPT_BYTES);
  }
  let head = lines.slice(0, questionIdx);
  const tail = lines.slice(questionIdx);
  while (head.length > 0 && byteLen([...head, ...tail].join("\n")) > MAX_PROMPT_BYTES) {
    const bulletIdx = head.findIndex((l) => l.startsWith("- "));
    if (bulletIdx >= 0) head.splice(bulletIdx, 1);
    else head = head.slice(1);
  }
  let combined = [...head, ...tail].join("\n");
  if (byteLen(combined) > MAX_PROMPT_BYTES) {
    // The question itself exceeded the budget. Trim it.
    combined = sliceBytes(combined, MAX_PROMPT_BYTES);
  }
  return combined;
}

function byteLen(s: string): number {
  return new TextEncoder().encode(s).length;
}

function sliceBytes(s: string, maxBytes: number): string {
  const enc = new TextEncoder();
  const dec = new TextDecoder("utf-8", { fatal: false });
  const buf = enc.encode(s);
  return dec.decode(buf.subarray(0, maxBytes)).replace(/�+$/, "");
}

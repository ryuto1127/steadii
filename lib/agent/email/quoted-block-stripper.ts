// engineer-62 — quoted-history stripper. Given an email body (plain
// text, as returned by `email_get_body`), removes lines that belong to
// the QUOTED reply history and returns only the NEW content the sender
// wrote in THIS message.
//
// Structural fix for THREAD_ROLE_CONFUSED: when the slot-extraction
// surface only ever sees the new content, the agent literally cannot
// pull candidate slots out of quoted history. Prompt-only enforcement
// (MUST-rule 9) was proven insufficient by the 2026-05-14 round-2
// dogfood — the agent extracted round-1 slots from a `>>` block.
//
// No `server-only` import — this is a pure function so the eval harness
// can call the same stripper its fixture-backed `email_get_new_content_only`
// tool exercises. Same logic, same fixtures, no DB.

export type StripResult = {
  newContentBody: string;
  originalBodyLength: number;
  newContentBodyLength: number;
  // True when the stripper removed > STRIPPER_FLAGGED_THRESHOLD of the
  // body — signal that the structure may not have been a typical reply
  // (the agent should consider falling back to email_get_body for the
  // full text). Always populated; check before trusting newContentBody
  // alone.
  stripperFlagged: boolean;
};

// If stripping removes more than this fraction of the body, the body
// structure didn't match our expectations (an entirely-quoted forward,
// a non-plaintext shape, etc.). Tool also returns the original so the
// agent can route around the issue.
const STRIPPER_FLAGGED_THRESHOLD = 0.95;

// Lines starting with one or more `>` (any depth) are quoted content.
// Lookahead-style: the very first `>`-prefixed line marks the start of
// the history block and EVERY subsequent quoted line keeps stripping
// active. Blank lines and unquoted "On … wrote:" / "差出人:" / etc.
// headers immediately above a `>` block are part of the history too.
const QUOTED_LINE_RE = /^\s*>+/;

// "On YYYY-MM-DD … wrote:" / "On Mon, May 11, 2026 at 1:05 AM … wrote:" /
// "On 2026/05/11 …" — the Gmail / Apple Mail style reply attribution.
// May span multiple lines if the email-address tail wraps; we look at
// the first occurrence and treat the rest of the body from there as
// quoted history.
const ON_WROTE_RE = /^\s*On\b[\s\S]*?\bwrote:\s*$/im;

// "-----Original Message-----" / "----- Original Message -----" /
// "----- 元のメッセージ -----" — Outlook / corporate-style divider.
// Everything from the line onwards is quoted history.
const ORIGINAL_MESSAGE_RE = /^\s*-{2,}\s*(Original Message|元のメッセージ|Forwarded message|転送)\s*-{2,}\s*$/im;

// Outlook-style reply headers in JA + EN. These appear as a contiguous
// block ABOVE a quoted body, but Outlook doesn't always prefix the
// quoted body with `>`, so we look for the header BLOCK and strip from
// the first header line onwards.
//
// JA: 差出人 / 送信日時 / 宛先 / Cc / 件名
// EN: From / Sent / To / Cc / Subject
//
// The detector requires AT LEAST two of these labels appearing
// consecutively (within 5 lines of each other) — a single "From:" or
// "件名:" elsewhere in the body is not enough, since those words also
// appear in unrelated prose. The detector returns the line index of
// the FIRST header in the cluster; the stripper drops from there.
const OUTLOOK_HEADER_LABEL_RE =
  /^\s*(差出人|送信日時|宛先|Cc|件名|From|Sent|To|Subject)\s*[:：]/i;

// Strip the body and return what's left. The result is right-trimmed
// of trailing blank lines and 3+ consecutive blank lines are collapsed
// to 1 to keep the output compact.
export function stripQuotedHistory(body: string): StripResult {
  const originalBodyLength = body.length;
  if (originalBodyLength === 0) {
    return {
      newContentBody: "",
      originalBodyLength: 0,
      newContentBodyLength: 0,
      stripperFlagged: false,
    };
  }

  const lines = body.split("\n");

  // Find the first index at which quoted-history starts. The chain is:
  //   1. First `>`-prefixed line
  //   2. First "On … wrote:" attribution line
  //   3. First "-----Original Message-----" divider
  //   4. First Outlook-header cluster (≥2 labels within 5 lines)
  // The smallest index wins. From that point on, every line is dropped.
  let cutIndex = lines.length;

  for (let i = 0; i < lines.length; i++) {
    if (QUOTED_LINE_RE.test(lines[i])) {
      cutIndex = Math.min(cutIndex, i);
      break;
    }
  }

  // "On … wrote:" — single-line match. Some clients wrap the address tail
  // onto the next line, but the `wrote:` token always lives on the line
  // we care about (the line that STARTS the attribution).
  for (let i = 0; i < lines.length; i++) {
    if (ON_WROTE_RE.test(lines[i])) {
      cutIndex = Math.min(cutIndex, i);
      break;
    }
  }

  // -----Original Message----- divider.
  for (let i = 0; i < lines.length; i++) {
    if (ORIGINAL_MESSAGE_RE.test(lines[i])) {
      cutIndex = Math.min(cutIndex, i);
      break;
    }
  }

  // Outlook-header cluster: scan for the first window of 5 lines that
  // contains ≥2 distinct header labels.
  const headerHits: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (OUTLOOK_HEADER_LABEL_RE.test(lines[i])) {
      headerHits.push(i);
    }
  }
  if (headerHits.length >= 2) {
    for (let i = 0; i < headerHits.length - 1; i++) {
      const a = headerHits[i];
      const b = headerHits[i + 1];
      if (b - a <= 5) {
        cutIndex = Math.min(cutIndex, a);
        break;
      }
    }
  }

  const kept = lines.slice(0, cutIndex);
  const cleaned = collapseBlankLines(kept).trimEnd();

  const newContentBodyLength = cleaned.length;
  const stripperFlagged =
    originalBodyLength > 0 &&
    (originalBodyLength - newContentBodyLength) / originalBodyLength >
      STRIPPER_FLAGGED_THRESHOLD;

  return {
    newContentBody: cleaned,
    originalBodyLength,
    newContentBodyLength,
    stripperFlagged,
  };
}

function collapseBlankLines(lines: string[]): string {
  const out: string[] = [];
  let blankRun = 0;
  for (const line of lines) {
    if (line.trim().length === 0) {
      blankRun += 1;
      if (blankRun <= 1) out.push("");
    } else {
      blankRun = 0;
      out.push(line.replace(/\s+$/g, ""));
    }
  }
  return out.join("\n");
}

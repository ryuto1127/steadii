// engineer-56 — best-effort parser that scans a drafted reply body for
// a user-local HH:MM anchored to the user's TZ marker. Used by the
// silent-learning hook in `gmail_send`: when a draft mentions a slot
// in the user's TZ (the MUST-rule 7 dual-TZ display form), we record
// the HH:MM as a sample for the empirical working-window inference.
//
// Pure function, no DB. Returns null when no confident sample can be
// extracted — silence is preferable to a wrong sample. The parser is
// intentionally conservative; missing 30% of valid samples is fine,
// recording 1 wrong sample skews the inferred window.
//
// Approach:
//   1. Look for the user's TZ abbreviation (e.g. "PT", "PDT", "PST" for
//      America/Vancouver) inside the body.
//   2. For each match, scan a ~20-char proximity window for a HH:MM
//      time token.
//   3. Return the FIRST such match. We don't try to record every slot
//      — the draft typically picks ONE slot to commit to, and that's
//      the signal we want.

const USER_TZ_TOKENS_BY_PROFILE_TZ: Record<string, RegExp> = {
  "America/Vancouver": /\b(PDT|PST|PT)\b/,
  "America/Los_Angeles": /\b(PDT|PST|PT)\b/,
  "America/New_York": /\b(EDT|EST|ET)\b/,
  "America/Toronto": /\b(EDT|EST|ET)\b/,
  "America/Chicago": /\b(CDT|CST|CT)\b/,
  "America/Denver": /\b(MDT|MST|MT)\b/,
  "Asia/Tokyo": /\b(JST|日本時間)\b|日本時間/,
  "Asia/Seoul": /\b(KST)\b/,
  "Asia/Shanghai": /\b(CST|中国時間)\b/,
  "Europe/London": /\b(GMT|BST)\b/,
  "Europe/Paris": /\b(CET|CEST)\b/,
  "Europe/Berlin": /\b(CET|CEST)\b/,
};

const HHMM_TOKEN = /\b([01]?\d|2[0-3]):([0-5]\d)\b/;
const HHMM_TOKEN_GLOBAL = new RegExp(HHMM_TOKEN.source, "g");

const PROXIMITY = 30;

export function parseAcceptedSlotFromDraftBody(
  body: string,
  userTimezone: string | null | undefined
): string | null {
  if (!body || !userTimezone) return null;
  const tzRe = USER_TZ_TOKENS_BY_PROFILE_TZ[userTimezone];
  if (!tzRe) return null;

  // Find every HH:MM in the body, then for each, check whether the
  // user's TZ marker is within PROXIMITY chars. First match wins.
  HHMM_TOKEN_GLOBAL.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = HHMM_TOKEN_GLOBAL.exec(body)) !== null) {
    const idx = m.index;
    const winStart = Math.max(0, idx - PROXIMITY);
    const winEnd = Math.min(body.length, idx + m[0].length + PROXIMITY);
    const slice = body.slice(winStart, winEnd);
    if (tzRe.test(slice)) {
      // Normalize to HH:MM with leading zero.
      const hh = m[1].padStart(2, "0");
      const mm = m[2];
      return `${hh}:${mm}`;
    }
  }
  return null;
}

// 2026-05-21 — Phase 5 of α-auto-cal. Pure deterministic detector for
// "this email mentions a deadline" — the trigger for auto-adding an
// all-day calendar reminder.
//
// Differs from mutual-agreement (Phase 1) in trigger shape:
//   - mutual_agreement requires BOTH user-side commitment AND inbound
//     acknowledgment (closes a negotiation)
//   - deadline requires only ONE inbound mention of a date paired with
//     a deadline keyword
//
// Higher false-positive risk (single-sided), so:
//   - Confidence threshold should be ≥ 0.85 for auto-create
//   - Strong-only patterns ("締切" / "deadline" / "due by") — not just
//     any date mention
//   - Conditional / hedging phrases ("〜していただけると幸いです" /
//     "if possible" / "preferred by") suppress the match
//
// Pure module: no DB, LLM, or I/O. Phase 5 evaluator wires this to
// calendar_create_event in the same shape as Phase 2.

export type DetectedDeadline = {
  // Wall-clock date in the deadline's anchor timezone.
  date: string; // YYYY-MM-DD
  // IANA timezone the date is anchored to.
  timezone: string;
  // Topic — derived from the email subject or surrounding context.
  // For the calendar event title.
  topic: string;
};

export type DeadlineSignals = {
  // Did we find a deadline keyword (締切 / 期限 / due by / deadline)
  // within proximity of the date?
  hasDeadlineKeyword: boolean;
  // Did we find a strong commitment phrase ("MUST submit by", "提出
  // 期限") — boosts confidence vs softer "by X".
  hasStrongCommitment: boolean;
  // Anti-signal: the deadline was phrased as a suggestion / preference
  // ("できれば" / "if possible" / "preferred by"). Suppresses the match.
  hasHedge: boolean;
  // Anti-signal: the date appears in quoted history (after a `>`
  // line), not in fresh content. Avoid re-firing on old deadlines.
  inQuotedHistory: boolean;
};

export type DeadlineDetectionResult = {
  confirmed: boolean;
  deadline: DetectedDeadline | null;
  confidence: number;
  reasoning: string;
  signals: DeadlineSignals;
};

// ---------- patterns ----------

// Strong deadline keywords. The match is anchored — these mean
// "this date is the cutoff", not "this date is in the discussion".
const STRONG_DEADLINE_KEYWORD_RE =
  /(締切|提出期限|期限(は|まで)?|期日(は|まで)?|deadline|due by|due date|submission deadline|submit by|no later than)/i;

// Weaker "by date" forms — fire only when paired with the strong
// keyword regex (treated as supporting evidence, not standalone).
const WEAK_BY_DATE_RE =
  /(までに(ご?提出|お送り|ご?対応|ご?連絡)|by\s+\d{1,2}\/\d{1,2}|by\s+(May|June|July|August|September|October|November|December|January|February|March|April))/i;

// Hedging phrases that downgrade a deadline to a preference.
const HEDGE_PHRASE_RE =
  /(できれば|可能であれば|ご都合よろしければ|お手すきの際|お時間あれば|if possible|if you can|preferred by|ideally by|would be great)/i;

// Date patterns — same shape as mutual-agreement-detector.
const DATE_PATTERN_RE =
  /(?:(\d{4})[年/-])?(\d{1,2})[月/-](\d{1,2})日?(?:\s*\([月火水木金土日]\))?/g;

// Explicit TZ marker for the deadline. We only check the most common
// case (deadline in Asia/Tokyo for JA emails); fall back to the
// caller-supplied default.
const TZ_MARKER_PATTERNS: Array<{ re: RegExp; tz: string }> = [
  { re: /\bJST\b|日本時間/, tz: "Asia/Tokyo" },
  { re: /\bKST\b/, tz: "Asia/Seoul" },
  { re: /\bPST\b|\bPDT\b|\bPT\b/, tz: "America/Vancouver" },
  { re: /\bEST\b|\bEDT\b|\bET\b/, tz: "America/New_York" },
  { re: /\bGMT\b|\bBST\b/, tz: "Europe/London" },
];

// Proximity window: deadline keyword must be within this many chars
// of the date to bind to it.
const PROXIMITY = 60;

// ---------- main entry ----------

export function detectDeadlineMention(args: {
  body: string;
  // Subject line of the email — used as the topic when present.
  subject?: string;
  // Caller's default TZ when no marker found near the date.
  defaultTimezone: string;
  // Anchor year for undated month/day mentions.
  referenceYear: number;
}): DeadlineDetectionResult {
  const { body, subject = "", defaultTimezone, referenceYear } = args;

  if (!body) {
    return notDetected("empty body", {
      hasDeadlineKeyword: false,
      hasStrongCommitment: false,
      hasHedge: false,
      inQuotedHistory: false,
    });
  }

  // Pre-scan: collect keyword positions so each date can compute
  // distance to its nearest strong keyword (used as tiebreaker when
  // multiple dates appear in the same email).
  const strongKeywordPositions = collectMatches(body, STRONG_DEADLINE_KEYWORD_RE);
  const weakKeywordPositions = collectMatches(body, WEAK_BY_DATE_RE);

  // Iterate dates; for each, check proximity to deadline keyword
  // AND check for hedge / quoted-history anti-signals.
  DATE_PATTERN_RE.lastIndex = 0;
  let bestMatch: {
    date: string;
    timezone: string;
    signals: DeadlineSignals;
    sourcePhrase: string;
    distanceToKeyword: number;
  } | null = null;

  let m: RegExpExecArray | null;
  while ((m = DATE_PATTERN_RE.exec(body)) !== null) {
    const dateStart = m.index;
    const dateEnd = dateStart + m[0].length;

    // Compute nearest-keyword distance. PROXIMITY caps how far a
    // keyword can be from the date to "bind" — outside that, the
    // keyword belongs to a different sentence.
    const nearestStrong = nearestDistance(strongKeywordPositions, dateStart, dateEnd);
    const nearestWeak = nearestDistance(weakKeywordPositions, dateStart, dateEnd);
    const hasStrong = nearestStrong !== null && nearestStrong <= PROXIMITY;
    const hasWeak = nearestWeak !== null && nearestWeak <= PROXIMITY;
    const hasKeyword = hasStrong || hasWeak;
    if (!hasKeyword) continue;

    // Scope a window around the date for hedge / TZ-marker checks.
    const winStart = Math.max(0, dateStart - PROXIMITY);
    const winEnd = Math.min(body.length, dateEnd + PROXIMITY);
    const window = body.slice(winStart, winEnd);

    const hasHedge = HEDGE_PHRASE_RE.test(window);

    // Is this date in quoted history? Look at the start of the line.
    const lineStart = body.lastIndexOf("\n", dateStart) + 1;
    const line = body.slice(lineStart, dateEnd);
    const inQuoted = /^\s*>/.test(line);

    const year = m[1] ? parseInt(m[1], 10) : referenceYear;
    const month = parseInt(m[2], 10);
    const day = parseInt(m[3], 10);
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;

    const tz = resolveTimezone(window, defaultTimezone);

    const isoDate = `${year.toString().padStart(4, "0")}-${month
      .toString()
      .padStart(2, "0")}-${day.toString().padStart(2, "0")}`;

    const signals: DeadlineSignals = {
      hasDeadlineKeyword: hasKeyword,
      hasStrongCommitment: hasStrong,
      hasHedge,
      inQuotedHistory: inQuoted,
    };

    // Score: stronger signal wins; among ties, closer-to-keyword wins.
    const distance = hasStrong
      ? (nearestStrong ?? PROXIMITY)
      : (nearestWeak ?? PROXIMITY);

    if (
      bestMatch === null ||
      scoreSignals(signals, distance) >
        scoreSignals(bestMatch.signals, bestMatch.distanceToKeyword)
    ) {
      bestMatch = {
        date: isoDate,
        timezone: tz,
        signals,
        sourcePhrase: m[0],
        distanceToKeyword: distance,
      };
    }
  }

  if (!bestMatch) {
    return notDetected("no date paired with a deadline keyword found", {
      hasDeadlineKeyword: false,
      hasStrongCommitment: false,
      hasHedge: false,
      inQuotedHistory: false,
    });
  }

  // Anti-signal short-circuits.
  if (bestMatch.signals.inQuotedHistory) {
    return notDetected(
      "deadline appears in quoted history (not fresh content)",
      bestMatch.signals,
    );
  }
  if (bestMatch.signals.hasHedge) {
    return notDetected(
      "deadline is phrased as a hedge / preference — not a hard cutoff",
      bestMatch.signals,
    );
  }

  // Confidence scoring. Strong keyword alone clears the threshold;
  // weak (by-date) phrasing alone does NOT — it requires a subject
  // keyword to lift over. The no-hedge bonus is a constant since the
  // hedge anti-signal already short-circuited above.
  let confidence = 0;
  const reasons: string[] = [];
  if (bestMatch.signals.hasStrongCommitment) {
    confidence += 0.7;
    reasons.push(`strong deadline keyword near "${bestMatch.sourcePhrase}" (+0.70)`);
  } else if (bestMatch.signals.hasDeadlineKeyword) {
    confidence += 0.4;
    reasons.push(`weak deadline keyword (by-date phrasing) near "${bestMatch.sourcePhrase}" (+0.40)`);
  }
  if (STRONG_DEADLINE_KEYWORD_RE.test(subject)) {
    // Subject explicitly mentions a deadline → strong contextual
    // signal. A bigger bump than 0.2 makes the case where body has
    // only weak (by-date) phrasing AND subject is deadline-explicit
    // clear the threshold (0.4 + 0.4 + 0.1 = 0.9).
    confidence += 0.4;
    reasons.push("subject line mentions a deadline keyword (+0.40)");
  }
  confidence += 0.1;
  reasons.push("no hedging phrase near the date (+0.10)");

  // Round to 2 decimals before the threshold check. The addends are
  // tenths (0.1 / 0.2 / 0.7), but JS floating-point makes 0.7 + 0.1
  // = 0.7999999... which fails the `>= 0.80` gate by a hair.
  confidence = Math.round(Math.max(0, Math.min(1, confidence)) * 100) / 100;

  const topic = deriveTopic(subject);

  const deadline: DetectedDeadline = {
    date: bestMatch.date,
    timezone: bestMatch.timezone,
    topic,
  };

  return {
    confirmed: confidence >= 0.8,
    deadline: confidence >= 0.8 ? deadline : null,
    confidence,
    reasoning: `${reasons.join("; ")}. Threshold for auto-add: 0.80. Deadline: ${deadline.date} ${deadline.timezone}.`,
    signals: bestMatch.signals,
  };
}

// ---------- helpers ----------

function notDetected(reason: string, signals: DeadlineSignals): DeadlineDetectionResult {
  return {
    confirmed: false,
    deadline: null,
    confidence: 0,
    reasoning: reason,
    signals,
  };
}

function scoreSignals(s: DeadlineSignals, distance: number): number {
  let score = 0;
  if (s.hasStrongCommitment) score += 3;
  else if (s.hasDeadlineKeyword) score += 1;
  if (s.hasHedge) score -= 2;
  if (s.inQuotedHistory) score -= 3;
  // Tie-break: closer-to-keyword dates win. Subtract distance/100
  // so even 60-char-apart matches score ≥ 2.4 (still below the
  // tier above, but tiebreaks among equal-tier dates).
  score -= distance / 100;
  return score;
}

function collectMatches(text: string, pattern: RegExp): Array<{ start: number; end: number }> {
  const positions: Array<{ start: number; end: number }> = [];
  const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    positions.push({ start: m.index, end: m.index + m[0].length });
    if (m.index === re.lastIndex) re.lastIndex++; // guard against zero-width
  }
  return positions;
}

function nearestDistance(
  positions: Array<{ start: number; end: number }>,
  dateStart: number,
  dateEnd: number,
): number | null {
  let best: number | null = null;
  for (const p of positions) {
    // Distance from the date span to the keyword span (0 if overlap).
    const d = p.end <= dateStart ? dateStart - p.end : p.start >= dateEnd ? p.start - dateEnd : 0;
    if (best === null || d < best) best = d;
  }
  return best;
}

function resolveTimezone(window: string, fallback: string): string {
  for (const { re, tz } of TZ_MARKER_PATTERNS) {
    if (re.test(window)) return tz;
  }
  return fallback;
}

function deriveTopic(subject: string): string {
  // Strip Re:/Fwd: prefixes for a cleaner calendar event title. Pure
  // string operation — no LLM.
  const stripped = subject.replace(/^(\s*(re|fwd|fw)\s*[:：]\s*)+/gi, "").trim();
  return stripped.length > 0 ? stripped : "締切";
}

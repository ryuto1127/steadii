// 2026-05-27 — Scheduled-event detector for auto-cal. The third
// detector kind, alongside mutual-agreement (negotiation closed) and
// deadline (single-sided cutoff).
//
// Trigger shape: a ONE-SIDED inbound mail confirming something the
// student registered for / was booked into — webinars, info sessions,
// orientations, appointments. These match neither existing detector:
//   - mutual-agreement needs the user's own outbound commitment
//   - deadline needs a deadline keyword (and is all-day, no time)
//
// It's the most common calendar-worthy email type for a student, and
// was entirely unhandled before this module.
//
// STRUCTURED-SIGNAL-ONLY (high precision, NOT "any future date+time").
// Fires ONLY when BOTH hold:
//   (a) a structured signal — a labeled "Date:"/"Time:" block OR a
//       tight registration/confirmation phrase
//   (b) a parseable date AND start time (TIMED). Date-without-time is
//       deadline-detector territory — we deliberately don't fire, to
//       avoid double cards on the same mail.
//
// Anti-signals suppress: quoted history (`>` line), past-dated events
// (recap/receipt), commerce-promo intent (a tight purchase/discount
// lexicon — NOT mere bulk-send: legit bulk event confirmations carry
// unsubscribe footers too, so we key on commerce intent, never on the
// footer alone).
//
// Pure module: no DB, LLM, or I/O. The auto-event-create wrapper INSERTs
// a `status='proposed'` row; the calendar API is only touched by the
// user-clicked Add action. Consent-first lock: this path NEVER calls a
// calendar mutate.

import {
  extractDateTimeMatches,
  extractTimeNear,
  isoDateOf,
  isoTimeOf,
} from "./datetime-extract";

export type DetectedEvent = {
  // Wall-clock date in the event's timezone.
  date: string; // YYYY-MM-DD
  // 24h HH:MM start time in the event's timezone.
  startTime: string;
  // IANA timezone the date+time are anchored to.
  timezone: string;
  // Duration in minutes — from the time range if present, else 60.
  durationMin: number;
  // Event title — derived from the subject when present.
  topic: string;
};

export type EventSignals = {
  // A labeled "Date:" line AND a "Time:" line were present.
  hasLabeledBlock: boolean;
  // A registration / confirmation phrase was present.
  hasConfirmationPhrase: boolean;
  // Anti-signal: the date+time appears in quoted history.
  inQuotedHistory: boolean;
  // Anti-signal: the event date is strictly before the email's
  // received date (a recap / receipt, not an upcoming event).
  isPastDated: boolean;
  // Anti-signal: commerce-promo intent (a tight purchase/discount
  // lexicon). Deliberately NOT keyed on the unsubscribe footer or the
  // absence of a labeled block — legit bulk event confirmations carry
  // both, so those would suppress the exact mails this detector exists
  // to catch (PROMO_STRUCTURED_BLOCK_BYPASS).
  looksPromotional: boolean;
};

export type EventDetectionResult = {
  confirmed: boolean;
  event: DetectedEvent | null;
  confidence: number;
  reasoning: string;
  signals: EventSignals;
};

// ---------- patterns ----------

// Registration / confirmation phrases. TIGHT on purpose (EN + JA) —
// these mean "you are booked into a specific timed thing", not "we'd
// love to see you sometime". We deliberately do NOT include the bare
// CTA "join the webinar/meeting/session": it's a generic marketing
// invitation, not a booking confirmation. True webinar/meeting
// confirmations are caught by the labeled Date:/Time: block path or by
// a real registration phrase ("you've registered", "confirmation
// details"); the bare CTA on its own is a promo false-positive
// (PROMO_STRUCTURED_BLOCK_BYPASS).
const CONFIRMATION_PHRASE_RE =
  /(you(?:'ve| have) registered|you(?:'re| are) registered for|registration (?:is )?confirmed|confirmation details|your appointment|your booking|appointment confirmed|booking confirmed|is confirmed|予約確認|登録完了|受付完了|参加登録|ご予約(?:いただき|ありがとう|の確認)?)/i;

// Labeled "Date:" line. Case-insensitive, line-anchored. JA 日付/日時 too.
const DATE_LABEL_RE = /^[ \t>*]*(date|日付|日時)\s*[:：]/im;
// Labeled "Time:" line. JA 時刻/時間.
const TIME_LABEL_RE = /^[ \t>*]*(time|時刻|時間)\s*[:：]/im;

// Commerce-promo intent. TIGHT purchase/discount lexicon (EN + JA) —
// the distinguishing signal of a marketing blast vs a legit bulk event
// confirmation. We key suppression on THIS, never on the unsubscribe
// footer (legit campus events bulletins carry footers too) nor on the
// absence of a labeled block (sales livestreams carry Date:/Time:
// blocks). "% off" / "N% off" anchors the discount shape; the rest are
// high-intent buy verbs and scarcity phrases. \b on the short EN tokens
// keeps "sale" from matching "wholesale"/"resale" inside prose.
const COMMERCE_INTENT_RE =
  /(\d+%\s*off|%\s*off|\bsale\b|shop\s*now|buy\s*now|order\s*now|add\s*to\s*cart|limited[\s-]time|\bdiscount\b|\bcoupon\b|promo\s*code|\bdeals?\b|セール|割引|今だけ|お買い得|購入はこちら|クーポン)/i;

// Explicit TZ marker for the event. Mirrors the deadline detector's set
// plus the "Eastern/Pacific Time" long forms that appear in EN
// confirmation mails.
const TZ_MARKER_PATTERNS: Array<{ re: RegExp; tz: string }> = [
  { re: /\bJST\b|日本時間/, tz: "Asia/Tokyo" },
  { re: /\bKST\b|韓国時間/, tz: "Asia/Seoul" },
  { re: /\bCST\b|中国時間/, tz: "Asia/Shanghai" },
  { re: /\b(PDT|PST|PT)\b|Pacific Time|太平洋時間/i, tz: "America/Vancouver" },
  { re: /\b(EDT|EST|ET)\b|Eastern Time|東部時間/i, tz: "America/New_York" },
  { re: /\b(CDT|CT)\b|Central Time/i, tz: "America/Chicago" },
  { re: /\b(MDT|MT)\b|Mountain Time/i, tz: "America/Denver" },
  { re: /\bGMT\b|\bBST\b/, tz: "Europe/London" },
  { re: /\b(CET|CEST)\b/, tz: "Europe/Berlin" },
];

// Confidence threshold to propose. Per spec: ≥ 0.80.
const DEFAULT_THRESHOLD = 0.8;
const DEFAULT_DURATION_MIN = 60;

// ---------- main entry ----------

export function detectScheduledEvent(args: {
  body: string;
  // Subject line — used as the event topic when present.
  subject?: string;
  // Caller's default TZ when no marker found near the date/time.
  defaultTimezone: string;
  // Anchor year for undated month/day mentions.
  referenceYear: number;
  // Email's received timestamp (epoch ms) — past-dated events are
  // suppressed against this. Defaults to Date.now().
  nowMs?: number;
}): EventDetectionResult {
  const { body, subject = "", defaultTimezone, referenceYear } = args;
  const nowMs = args.nowMs ?? Date.now();

  const emptySignals: EventSignals = {
    hasLabeledBlock: false,
    hasConfirmationPhrase: false,
    inQuotedHistory: false,
    isPastDated: false,
    looksPromotional: false,
  };

  if (!body) return notDetected("empty body", emptySignals);

  // --- structured signals (gate a) ---
  const hasLabeledBlock = DATE_LABEL_RE.test(body) && TIME_LABEL_RE.test(body);
  const hasConfirmationPhrase = CONFIRMATION_PHRASE_RE.test(body);

  if (!hasLabeledBlock && !hasConfirmationPhrase) {
    return notDetected(
      "no structured signal (no labeled Date/Time block, no confirmation phrase)",
      { ...emptySignals, hasLabeledBlock, hasConfirmationPhrase },
    );
  }

  // Promo guard: commerce/purchase intent → bulk marketing, suppress
  // regardless of a labeled Date:/Time: block (a sales livestream
  // carries one) or an unsubscribe footer. Keying on commerce intent —
  // not bulk-send — is what lets a legit campus events bulletin (which
  // also has an unsubscribe footer) still fire. See
  // PROMO_STRUCTURED_BLOCK_BYPASS.
  const looksPromotional = COMMERCE_INTENT_RE.test(body);
  if (looksPromotional) {
    return notDetected("looks promotional (commerce/purchase intent)", {
      ...emptySignals,
      hasLabeledBlock,
      hasConfirmationPhrase,
      looksPromotional: true,
    });
  }

  // --- parseable date + start time (gate b) ---
  const timed = findTimedEvent(body, referenceYear);
  if (!timed) {
    return notDetected(
      "no parseable date paired with a start time (date-without-time is deadline territory)",
      { ...emptySignals, hasLabeledBlock, hasConfirmationPhrase },
    );
  }

  // Quoted-history anti-signal — the date/time line is `>`-prefixed.
  const lineStart = body.lastIndexOf("\n", timed.index) + 1;
  const line = body.slice(lineStart, timed.index + timed.length);
  const inQuotedHistory = /^\s*>/.test(line);
  if (inQuotedHistory) {
    return notDetected("event appears in quoted history (not fresh content)", {
      ...emptySignals,
      hasLabeledBlock,
      hasConfirmationPhrase,
      inQuotedHistory: true,
    });
  }

  const isoDate = isoDateOf(timed);
  const startTime = isoTimeOf(timed.hour, timed.minute);

  // Resolve TZ from a window around the date/time; else default.
  const winStart = Math.max(0, timed.index - 80);
  const winEnd = Math.min(body.length, timed.index + timed.length + 80);
  const tz = resolveTimezone(body.slice(winStart, winEnd), defaultTimezone);

  // Past-dated anti-signal — compute the event's UTC instant in its TZ
  // and compare against the email's received instant. End-of-day grace:
  // an event "today" earlier than received should still surface (the
  // student may want the reminder), so we only suppress when the event
  // date is strictly before the received date.
  const isPastDated = isEventDateBeforeReceived(isoDate, tz, nowMs);
  if (isPastDated) {
    return notDetected("event date is before the email's received date (recap/receipt)", {
      ...emptySignals,
      hasLabeledBlock,
      hasConfirmationPhrase,
      isPastDated: true,
    });
  }

  // --- confidence scoring ---
  const signals: EventSignals = {
    hasLabeledBlock,
    hasConfirmationPhrase,
    inQuotedHistory: false,
    isPastDated: false,
    looksPromotional: false,
  };

  // Either structured signal, when paired with the (mandatory) timed
  // date, clears the 0.80 threshold — both signals are precise enough
  // on their own that a single one plus a parseable timed date is a
  // confident scheduled-event. Neither signal can reach scoring without
  // a timed date (gate b above), so the +0.2 anchor is always present.
  let confidence = 0;
  const reasons: string[] = [];
  if (hasLabeledBlock) {
    confidence += 0.7;
    reasons.push("labeled Date:/Time: block present (+0.70)");
  }
  if (hasConfirmationPhrase) {
    confidence += 0.6;
    reasons.push("registration/confirmation phrase present (+0.60)");
  }
  confidence += 0.2;
  reasons.push("parseable date + start time present (+0.20)");

  confidence = Math.round(Math.max(0, Math.min(1, confidence)) * 100) / 100;

  const topic = deriveTopic(subject);

  const event: DetectedEvent = {
    date: isoDate,
    startTime,
    timezone: tz,
    durationMin: timed.durationMin ?? DEFAULT_DURATION_MIN,
    topic,
  };

  const confirmed = confidence >= DEFAULT_THRESHOLD;
  return {
    confirmed,
    event: confirmed ? event : null,
    confidence,
    reasoning: `${reasons.join("; ")}. Threshold for auto-add: ${DEFAULT_THRESHOLD}. Event: ${event.date} ${event.startTime} ${event.timezone} (${event.durationMin}min).`,
    signals,
  };
}

// ---------- helpers ----------

type TimedMatch = {
  year: number;
  month: number;
  day: number;
  index: number;
  length: number;
  hour: number;
  minute: number;
  durationMin?: number;
};

// Find a date paired with a start time. Two routes:
//   1. A single date+time mention (e.g. "October 8, 2026 4:00 PM").
//   2. A labeled "Date:" line + a separate "Time:" line (the time is on
//      a different line, so the date match carries no hour). We then
//      pull the time from the "Time:" line via extractTimeNear and graft
//      it onto the date.
function findTimedEvent(body: string, referenceYear: number): TimedMatch | null {
  const matches = extractDateTimeMatches(body, referenceYear);
  if (matches.length === 0) return null;

  // Route 1 — first date that already carries a time.
  for (const m of matches) {
    if (m.hour !== undefined && m.minute !== undefined) {
      return {
        year: m.year,
        month: m.month,
        day: m.day,
        index: m.index,
        length: m.length,
        hour: m.hour,
        minute: m.minute,
        durationMin: m.durationMin,
      };
    }
  }

  // Route 2 — a labeled "Time:" line elsewhere. Bind it to the first
  // date mention (the labeled block keeps Date:/Time: adjacent, so the
  // first date is the event date).
  const timeLine = matchLine(body, TIME_LABEL_RE);
  if (timeLine) {
    const t = extractTimeNear(timeLine.text);
    if (t) {
      const d = matches[0];
      return {
        year: d.year,
        month: d.month,
        day: d.day,
        index: d.index,
        length: d.length,
        hour: t.hour,
        minute: t.minute,
        durationMin: t.durationMin,
      };
    }
  }

  return null;
}

// Return the full line (and its start offset) whose start matches `re`.
function matchLine(body: string, re: RegExp): { text: string; index: number } | null {
  const m = re.exec(body);
  if (!m) return null;
  const lineStart = body.lastIndexOf("\n", m.index) + 1;
  let lineEnd = body.indexOf("\n", m.index);
  if (lineEnd === -1) lineEnd = body.length;
  return { text: body.slice(lineStart, lineEnd), index: lineStart };
}

// True when the event's calendar date is strictly before the received
// date (both compared as YYYY-MM-DD in the event's timezone).
function isEventDateBeforeReceived(
  eventIsoDate: string,
  tz: string,
  receivedMs: number,
): boolean {
  const receivedDate = isoDateInTz(new Date(receivedMs), tz);
  return eventIsoDate < receivedDate;
}

function isoDateInTz(d: Date, tz: string): string {
  // en-CA gives YYYY-MM-DD ordering, which sorts lexicographically.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  return `${map.year}-${map.month}-${map.day}`;
}

function resolveTimezone(window: string, fallback: string): string {
  for (const { re, tz } of TZ_MARKER_PATTERNS) {
    if (re.test(window)) return tz;
  }
  return fallback;
}

function deriveTopic(subject: string): string {
  const stripped = subject.replace(/^(\s*(re|fwd|fw)\s*[:：]\s*)+/gi, "").trim();
  return stripped.length > 0 ? stripped : "Event";
}

function notDetected(reason: string, signals: EventSignals): EventDetectionResult {
  return {
    confirmed: false,
    event: null,
    confidence: 0,
    reasoning: reason,
    signals,
  };
}

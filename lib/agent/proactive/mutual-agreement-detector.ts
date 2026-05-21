// 2026-05-20 — Phase 1 of α-auto-cal (post-PR-#296 sparring inline).
//
// Pure deterministic detector that decides whether an email thread has
// reached "mutual scheduling agreement" — i.e., the user has committed
// to a specific slot AND the recipient has acknowledged it. This is the
// safety gate for the calendar auto-create flow:
//
//   thread → detectMutualAgreement(...) →
//     { confirmed: true, slot: { date, startTime, timezone, ... } }
//
// Only when `confirmed: true` (and confidence ≥ threshold) does the
// caller proceed to create a [Steadii] provisional event on the user's
// calendar. Everything else stays manual.
//
// Conservative by design: false positives are catastrophic for trust
// (Steadii silently puts a wrong meeting on the user's calendar);
// false negatives are merely inconvenient (the user types the event
// in themselves). We tune for zero false positives.
//
// Pure module. No DB, no LLM, no I/O. Phase 2 (background create job)
// wires this into the inbound-email pipeline.

export type EmailDirection = "outbound" | "inbound";

export type EmailSnapshot = {
  direction: EmailDirection;
  // ISO 8601. Used only for ordering — the detector doesn't reason
  // about wall-clock arrival times.
  sentAt: string;
  subject?: string;
  body: string;
};

export type AgreedSlot = {
  // Wall-clock date in the agreed timezone (YYYY-MM-DD).
  date: string;
  // 24h HH:MM start time in the agreed timezone.
  startTime: string;
  // IANA timezone name the date+time are anchored to.
  timezone: string;
  // Best-guess duration in minutes. Defaults to 60 when unknown.
  durationMin: number;
};

export type SlotCommitment = {
  // Parsed slot in wall-clock form.
  date: string;
  startTime: string;
  timezone: string;
  durationMin: number;
  // Did the outbound mail contain an explicit "user accepts / commits"
  // phrase nearby (お願いいたします / で結構です / works for me)?
  hasAcceptancePhrase: boolean;
  // Source phrase that triggered the slot extraction. For glass-box
  // reasoning.
  sourcePhrase: string;
};

export type InboundSignals = {
  // Did the inbound mail contain a confirmation phrase (承知いたしました /
  // confirmed / 確定)?
  hasConfirmationPhrase: boolean;
  // Did the inbound mail send logistics (URL, room, address) for an
  // event referencing the agreed slot?
  hasLogisticsContent: boolean;
  // Anti-signals:
  hasCounterProposal: boolean;
  hasReschedulePhrase: boolean;
  hasCancelPhrase: boolean;
};

export type MutualAgreementResult = {
  confirmed: boolean;
  slot: AgreedSlot | null;
  // 0..1 — caller decides threshold for action. Auto-create should
  // require ≥ 0.80; lower values surface a notification only.
  confidence: number;
  reasoning: string;
  signals: {
    threadOrderValid: boolean;
    outboundCommitment: SlotCommitment | null;
    inboundSignals: InboundSignals | null;
    negativeSignals: string[];
  };
};

// ---------- regex patterns ----------

// User's commitment phrases (outbound mail). "I commit to slot X".
const ACCEPTANCE_PHRASE_RE =
  /(で(お願いいたします|お願いします|結構です|大丈夫です|参加可能です|希望(いた)?します|伺います)|works for me|sounds good|that works for me|count me in|I can do|I'll be there|confirmed for)/i;

// Recipient's confirmation phrases (inbound mail). "Got it, see you".
const CONFIRMATION_PHRASE_RE =
  /((承知|了解|確定|確認)(いたしました|致しました|です)?|お待ち(して)?おります|当日(は|を)?(どうぞ)?よろしく|(confirmed|see you|got it|looking forward to|all set))/i;

// Logistics-only inbound (URL / room / address being sent for an
// already-agreed slot). Strong signal that the slot is locked.
const LOGISTICS_CONTENT_RE =
  /(URL|リンク|会議リンク|Zoom|Google Meet|Teams|参加リンク|当日のリンク|会場|住所|building|room\s+\d|address:|location:|join here|meeting link)/i;

// Counter / negative signals (inbound). KILL the agreement.
const COUNTER_PROPOSAL_RE =
  /((別|他)の?(候補|日程|日時|時間)|別日(程|時)?|もう一度|改めて|再度ご?(調整|提案|検討)|alternative|different time|reschedule to|how about)/i;
const RESCHEDULE_PHRASE_RE =
  /(日程?(を)?変更|reschedule|move (to|the meeting)|延期|postpone)/i;
const CANCEL_PHRASE_RE =
  /(キャンセル|cancel(ed|led)?|中止|取り消し|withdraw)/i;

// Date + time extraction. JA + EN. Single anchor pattern returns the
// match offset so we can scope acceptance-phrase proximity.
//   JA: 5月22日 14:00 / 5/22 14:00 / 5/22(水) 14:00
//   EN: May 22 14:00 / 5/22 2pm — only HH:MM for Phase 1.
const SLOT_PATTERN_RE =
  /(?:(\d{4})[年/-])?(\d{1,2})[月/-](\d{1,2})日?(?:\s*\([月火水木金土日]\))?\s*[にで]?\s*(\d{1,2}):(\d{2})/g;

// Explicit TZ marker for the slot.
const TZ_MARKER_PATTERNS: Array<{ re: RegExp; tz: string }> = [
  { re: /\bJST\b|日本時間/, tz: "Asia/Tokyo" },
  { re: /\bKST\b|韓国時間/, tz: "Asia/Seoul" },
  { re: /\bCST\b|中国時間/, tz: "Asia/Shanghai" },
  { re: /\b(PDT|PST|PT)\b|太平洋時間/, tz: "America/Vancouver" },
  { re: /\b(EDT|EST|ET)\b|東部時間/, tz: "America/New_York" },
  { re: /\b(CDT|CT)\b/, tz: "America/Chicago" },
  { re: /\b(MDT|MT)\b/, tz: "America/Denver" },
  { re: /\bGMT\b|\bBST\b/, tz: "Europe/London" },
  { re: /\b(CET|CEST)\b/, tz: "Europe/Berlin" },
];

// Duration hints in the same mail.
const DURATION_RE = /(\d{1,3})\s*(分間?|min(ute)?s?|時間)/i;

// Acceptance-phrase proximity: look this many chars after the slot
// timestamp to bind it to a commitment phrase.
const COMMITMENT_PROXIMITY = 80;

// ---------- exported sub-functions (testability) ----------

export function extractSlotCommitment(
  body: string,
  defaultTimezone: string,
  referenceYear: number
): SlotCommitment | null {
  if (!body) return null;

  // Find all slot patterns. For each, check whether an acceptance
  // phrase appears within COMMITMENT_PROXIMITY characters AFTER it
  // (commitment style: "5/22 14:00 で お願いいたします"). The first
  // match wins — the user typically commits to ONE slot per mail.
  SLOT_PATTERN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SLOT_PATTERN_RE.exec(body)) !== null) {
    const slotEnd = m.index + m[0].length;
    const window = body.slice(slotEnd, slotEnd + COMMITMENT_PROXIMITY);
    if (!ACCEPTANCE_PHRASE_RE.test(window)) continue;

    const year = m[1] ? parseInt(m[1], 10) : referenceYear;
    const month = parseInt(m[2], 10);
    const day = parseInt(m[3], 10);
    const hour = parseInt(m[4], 10);
    const minute = parseInt(m[5], 10);

    if (
      month < 1 ||
      month > 12 ||
      day < 1 ||
      day > 31 ||
      hour > 23 ||
      minute > 59
    ) {
      continue;
    }

    // Resolve TZ. Look for a TZ marker within ±60 chars of the slot;
    // fall back to defaultTimezone.
    const tzWindow = body.slice(
      Math.max(0, m.index - 60),
      Math.min(body.length, slotEnd + 60)
    );
    const tz = resolveTimezone(tzWindow, defaultTimezone);

    const durationMin = parseDuration(body) ?? 60;

    return {
      date: `${year.toString().padStart(4, "0")}-${month
        .toString()
        .padStart(2, "0")}-${day.toString().padStart(2, "0")}`,
      startTime: `${hour.toString().padStart(2, "0")}:${minute
        .toString()
        .padStart(2, "0")}`,
      timezone: tz,
      durationMin,
      hasAcceptancePhrase: true,
      sourcePhrase: m[0],
    };
  }
  return null;
}

export function detectInboundSignals(body: string): InboundSignals {
  if (!body) {
    return {
      hasConfirmationPhrase: false,
      hasLogisticsContent: false,
      hasCounterProposal: false,
      hasReschedulePhrase: false,
      hasCancelPhrase: false,
    };
  }
  return {
    hasConfirmationPhrase: CONFIRMATION_PHRASE_RE.test(body),
    hasLogisticsContent: LOGISTICS_CONTENT_RE.test(body),
    hasCounterProposal: COUNTER_PROPOSAL_RE.test(body),
    hasReschedulePhrase: RESCHEDULE_PHRASE_RE.test(body),
    hasCancelPhrase: CANCEL_PHRASE_RE.test(body),
  };
}

function resolveTimezone(window: string, fallback: string): string {
  for (const { re, tz } of TZ_MARKER_PATTERNS) {
    if (re.test(window)) return tz;
  }
  return fallback;
}

function parseDuration(body: string): number | null {
  const m = body.match(DURATION_RE);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (m[2] === "時間" || /hour/i.test(m[2])) return n * 60;
  return n;
}

// ---------- main entry ----------

export function detectMutualAgreement(args: {
  thread: EmailSnapshot[];
  userTimezone: string;
  // The recipient's likely timezone (typically from
  // infer_sender_timezone). Used as the default when slot text in
  // the thread doesn't carry an explicit TZ marker.
  defaultTimezone: string;
  // The year to anchor month/day patterns to (the agreed slot may
  // omit the year). Typically the inbound mail's sentAt year.
  referenceYear: number;
}): MutualAgreementResult {
  const { thread, defaultTimezone, referenceYear } = args;

  if (thread.length < 2) {
    return notConfirmed(
      "thread too short — need at least one outbound + one inbound message",
      { outboundCommitment: null, inboundSignals: null, negativeSignals: [], threadOrderValid: false }
    );
  }

  // Find last outbound and last inbound. Sort defensively.
  const sorted = [...thread].sort((a, b) =>
    a.sentAt.localeCompare(b.sentAt)
  );
  let lastOutbound: EmailSnapshot | null = null;
  let lastInbound: EmailSnapshot | null = null;
  for (const m of sorted) {
    if (m.direction === "outbound") lastOutbound = m;
    else lastInbound = m;
  }

  if (!lastOutbound) {
    return notConfirmed("user has not replied in this thread yet", {
      outboundCommitment: null,
      inboundSignals: null,
      negativeSignals: [],
      threadOrderValid: false,
    });
  }
  if (!lastInbound) {
    return notConfirmed(
      "no recipient reply after the user's last outbound — agreement still pending",
      {
        outboundCommitment: null,
        inboundSignals: null,
        negativeSignals: [],
        threadOrderValid: false,
      }
    );
  }

  // The inbound MUST come AFTER the user's last outbound. If the most
  // recent inbound predates the user's outbound, the user is still the
  // last one to speak — no acknowledgment has landed.
  const threadOrderValid =
    lastInbound.sentAt.localeCompare(lastOutbound.sentAt) > 0;
  if (!threadOrderValid) {
    return notConfirmed(
      "the user's outbound is more recent than the latest inbound — recipient has not responded yet",
      {
        outboundCommitment: null,
        inboundSignals: null,
        negativeSignals: [],
        threadOrderValid: false,
      }
    );
  }

  // Extract the user's slot commitment from outbound.
  const commitment = extractSlotCommitment(
    lastOutbound.body,
    defaultTimezone,
    referenceYear
  );

  if (!commitment) {
    return notConfirmed(
      "no specific slot commitment found in the user's last outbound mail",
      {
        outboundCommitment: null,
        inboundSignals: null,
        negativeSignals: [],
        threadOrderValid,
      }
    );
  }

  // Analyze inbound for signals.
  const inboundSignals = detectInboundSignals(lastInbound.body);

  // Kill-switches: any anti-signal in the inbound → not confirmed.
  const negatives: string[] = [];
  if (inboundSignals.hasCounterProposal) negatives.push("counter-proposal");
  if (inboundSignals.hasReschedulePhrase) negatives.push("reschedule");
  if (inboundSignals.hasCancelPhrase) negatives.push("cancel");

  if (negatives.length > 0) {
    return notConfirmed(
      `recipient sent negative signals (${negatives.join(
        ", "
      )}) — agreement not closed`,
      {
        outboundCommitment: commitment,
        inboundSignals,
        negativeSignals: negatives,
        threadOrderValid,
      }
    );
  }

  // Positive scoring.
  let confidence = 0;
  const reasons: string[] = [];

  // Outbound has explicit acceptance + parsed slot.
  confidence += 0.4;
  reasons.push(
    `outbound contains slot "${commitment.sourcePhrase}" with acceptance phrase (+0.40)`
  );

  if (inboundSignals.hasConfirmationPhrase) {
    confidence += 0.25;
    reasons.push("inbound contains confirmation phrase (+0.25)");
  }
  if (inboundSignals.hasLogisticsContent) {
    // Logistics-only inbound (URL / room / address being sent for an
    // already-committed slot) is at least as strong as a verbal
    // confirmation phrase — the recipient is acting on the lock, not
    // just acknowledging. Weighted equally with confirmation phrase
    // so the two paths land at the same total when each appears alone.
    confidence += 0.25;
    reasons.push("inbound contains logistics content (URL/room/address) (+0.25)");
  }

  // Subject-line consistency: if subject contains a reschedule marker,
  // that's a tiny extra penalty even if body looked clean.
  const subjects = `${lastInbound.subject ?? ""} ${
    lastOutbound.subject ?? ""
  }`;
  if (/\b(reschedule|変更|キャンセル|cancel)\b/i.test(subjects)) {
    confidence -= 0.2;
    reasons.push("subject line contains reschedule/cancel keyword (-0.20)");
  } else {
    confidence += 0.1;
    reasons.push("subject line shows no reschedule/cancel keywords (+0.10)");
  }

  confidence += 0.05;
  reasons.push("thread order valid (inbound after user's outbound) (+0.05)");

  // Clamp.
  confidence = Math.max(0, Math.min(1, confidence));

  // We require BOTH positive signals to mean anything. If inbound has
  // neither a confirmation phrase NOR logistics, we don't have enough
  // signal — the user's outbound could just be unanswered.
  if (
    !inboundSignals.hasConfirmationPhrase &&
    !inboundSignals.hasLogisticsContent
  ) {
    return notConfirmed(
      "inbound mail lacks both confirmation phrase and logistics content — recipient's intent unclear",
      {
        outboundCommitment: commitment,
        inboundSignals,
        negativeSignals: negatives,
        threadOrderValid,
      }
    );
  }

  const slot: AgreedSlot = {
    date: commitment.date,
    startTime: commitment.startTime,
    timezone: commitment.timezone,
    durationMin: commitment.durationMin,
  };

  return {
    confirmed: confidence >= 0.8,
    slot: confidence >= 0.8 ? slot : null,
    confidence,
    reasoning: `${reasons.join("; ")}. Threshold for auto-create: 0.80. Slot: ${slot.date} ${slot.startTime} ${slot.timezone} (${slot.durationMin}min).`,
    signals: {
      outboundCommitment: commitment,
      inboundSignals,
      negativeSignals: negatives,
      threadOrderValid,
    },
  };
}

function notConfirmed(
  reason: string,
  signals: MutualAgreementResult["signals"]
): MutualAgreementResult {
  return {
    confirmed: false,
    slot: null,
    confidence: 0,
    reasoning: reason,
    signals,
  };
}

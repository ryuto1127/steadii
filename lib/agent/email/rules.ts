import type {
  RuleProvenance,
  InboxBucket,
  SenderRole,
} from "@/lib/db/schema";
import type { ClassifyInput, TriageResult, UserContext } from "./types";
import {
  AUTO_HIGH_KEYWORDS,
  AUTO_LOW_KEYWORDS,
  AUTO_MEDIUM_KEYWORDS,
  containsActionVerb,
  isEduDomain,
  isNoreplySender,
  isPromoSenderDomain,
} from "./rules-global";

// The L1 triage classifier. Pure function: inputs + user context → result.
// Bucket resolution order: IGNORE → AUTO_HIGH → AUTO_MEDIUM → AUTO_LOW →
// L2_PENDING (fallback). First bucket that matches wins, but we record
// *every* matching rule in `ruleProvenance` for the Settings transparency
// UI — if a message matches both AUTO_HIGH keywords and AUTO_MEDIUM
// keywords, we surface both so the user sees why it landed in HIGH
// instead of MEDIUM.
export function classifyEmail(
  input: ClassifyInput,
  ctx: UserContext
): TriageResult {
  const provenance: RuleProvenance[] = [];
  const haystack = buildHaystack(input);

  const firstTimeSender =
    !ctx.seenDomains.has(input.fromDomain.toLowerCase()) &&
    !fromSelf(input, ctx);

  const learnedDomain = ctx.learnedDomains.get(input.fromDomain.toLowerCase());
  const learnedSender = ctx.learnedSenders.get(input.fromEmail.toLowerCase());
  const senderRole: SenderRole | null =
    learnedSender?.senderRole ?? learnedDomain?.senderRole ?? null;

  // ---------------------------------------------------------------------
  // IGNORE bucket (checked first; short-circuits everything else).
  // ---------------------------------------------------------------------
  if (fromSelf(input, ctx)) {
    provenance.push({
      ruleId: "GLOBAL_IGNORE_FROM_SELF",
      source: "global",
      why: "Auto-reply from the user's own address.",
    });
    return {
      bucket: "ignore",
      senderRole,
      ruleProvenance: provenance,
      firstTimeSender: false,
    };
  }

  const spamOrPromo = input.gmailLabelIds.some(
    (id) => id === "SPAM" || id === "CATEGORY_PROMOTIONS"
  );
  if (spamOrPromo) {
    provenance.push({
      ruleId: "GLOBAL_IGNORE_GMAIL_SPAM_OR_PROMO",
      source: "global",
      why: "Gmail tagged this as SPAM or CATEGORY_PROMOTIONS.",
    });
    return {
      bucket: "ignore",
      senderRole,
      ruleProvenance: provenance,
      firstTimeSender,
    };
  }

  if (
    input.listUnsubscribe &&
    isPromoSenderDomain(input.fromDomain)
  ) {
    provenance.push({
      ruleId: "GLOBAL_IGNORE_UNSUBSCRIBE_PROMO",
      source: "global",
      why: "List-Unsubscribe header + promo-vendor domain.",
    });
    return {
      bucket: "ignore",
      senderRole,
      ruleProvenance: provenance,
      firstTimeSender,
    };
  }

  if (isNoreplySender(input.fromEmail) && !containsActionVerb(haystack)) {
    provenance.push({
      ruleId: "GLOBAL_IGNORE_NOREPLY_NO_ACTION",
      source: "global",
      why: "noreply/no-reply sender without action-required language.",
    });
    return {
      bucket: "ignore",
      senderRole,
      ruleProvenance: provenance,
      firstTimeSender,
    };
  }

  // ---------------------------------------------------------------------
  // AUTO_HIGH — strict. Any match wins.
  // ---------------------------------------------------------------------
  const highMatches = collectKeywordMatches(haystack, AUTO_HIGH_KEYWORDS);
  for (const m of highMatches) provenance.push(globalProv(m));

  // Roles that escalate to AUTO_HIGH:
  //   admin / supervisor — institutional authority, time-sensitive responses.
  //   career — recruiters / interviewers / internship coordinators; missed
  //     reply costs an opportunity (added 2026-04-29).
  // Professors and TAs stay AUTO_MEDIUM (checked below). Personal /
  // classmate / other don't escalate by role alone.
  const escalatedRole =
    senderRole === "admin" ||
    senderRole === "supervisor" ||
    senderRole === "career"
      ? senderRole
      : null;
  if (escalatedRole) {
    const why =
      escalatedRole === "career"
        ? "Learned career (recruiter / internship / interview) for this sender/domain."
        : `Learned ${escalatedRole} (supervisor/PI/lab director) for this sender/domain.`;
    provenance.push({
      ruleId:
        escalatedRole === "career"
          ? "USER_AUTO_HIGH_CAREER"
          : "USER_AUTO_HIGH_SUPERVISOR",
      source: "learned",
      why,
    });
  }

  if (firstTimeSender) {
    provenance.push({
      ruleId: "GLOBAL_AUTO_HIGH_FIRST_TIME_DOMAIN",
      source: "global",
      why: "First email from this domain — high risk until user confirms.",
    });
  }

  if (highMatches.length > 0 || escalatedRole || firstTimeSender) {
    return {
      bucket: "auto_high",
      senderRole,
      ruleProvenance: provenance,
      firstTimeSender,
    };
  }

  // ---------------------------------------------------------------------
  // AUTO_MEDIUM — professor/TA senders + deadline/office-hour keywords +
  // question-mark heuristic on education-domain senders.
  // ---------------------------------------------------------------------
  if (senderRole === "professor" || senderRole === "ta") {
    provenance.push({
      ruleId: "USER_AUTO_MEDIUM_PROFESSOR_TA",
      source: "learned",
      why: `Learned ${senderRole} for this sender/domain.`,
    });
  }

  const medMatches = collectKeywordMatches(haystack, AUTO_MEDIUM_KEYWORDS);
  for (const m of medMatches) provenance.push(globalProv(m));

  const subjectHasQ =
    (input.subject?.includes("?") ?? false) ||
    (input.subject?.includes("？") ?? false);
  if (subjectHasQ && isEduDomain(input.fromDomain)) {
    provenance.push({
      ruleId: "GLOBAL_AUTO_MEDIUM_EDU_QUESTION",
      source: "global",
      why: "Question mark in subject from an education-domain sender.",
    });
  }

  if (
    senderRole === "professor" ||
    senderRole === "ta" ||
    medMatches.length > 0 ||
    (subjectHasQ && isEduDomain(input.fromDomain))
  ) {
    return {
      bucket: "auto_medium",
      senderRole,
      ruleProvenance: provenance,
      firstTimeSender,
    };
  }

  // ---------------------------------------------------------------------
  // AUTO_LOW — RSVPs, short acknowledgments, personal contacts.
  // ---------------------------------------------------------------------
  const lowMatches = collectKeywordMatches(haystack, AUTO_LOW_KEYWORDS);
  for (const m of lowMatches) provenance.push(globalProv(m));

  const isShortAck = isShortAcknowledgment(input);
  if (isShortAck) {
    provenance.push({
      ruleId: "GLOBAL_AUTO_LOW_SHORT_ACK",
      source: "global",
      why: "Very short message body with no action verbs.",
    });
  }

  // 2026-04-29 — `personal` (family / friends / clubs / social) keeps mail
  // out of the triage queue so the user only paginates academic items.
  if (senderRole === "personal") {
    provenance.push({
      ruleId: "USER_AUTO_LOW_PERSONAL",
      source: "learned",
      why: "Learned personal (family / friends / club) for this sender/domain.",
    });
  }

  if (lowMatches.length > 0 || isShortAck || senderRole === "personal") {
    return {
      bucket: "auto_low",
      senderRole,
      ruleProvenance: provenance,
      firstTimeSender,
    };
  }

  // ---------------------------------------------------------------------
  // Fallback → L2 (not invoked in W1).
  // ---------------------------------------------------------------------
  provenance.push({
    ruleId: "GLOBAL_L2_FALLBACK",
    source: "global",
    why: "No L1 rule matched — deferred to L2 classifier.",
  });
  return {
    bucket: "l2_pending",
    senderRole,
    ruleProvenance: provenance,
    firstTimeSender,
  };
}

// Exported for the ingest caller: inserts rows into `inbox_items` downstream
// and needs the bucket to decide whether to queue an L2 request later.
export function bucketForTelemetry(bucket: InboxBucket): string {
  return bucket;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function buildHaystack(input: ClassifyInput): string {
  const parts: string[] = [];
  if (input.subject) parts.push(input.subject);
  if (input.snippet) parts.push(input.snippet);
  if (input.bodySnippet) parts.push(input.bodySnippet);
  return parts.join("\n").toLowerCase();
}

function collectKeywordMatches(
  haystack: string,
  table: Array<{ ruleId: string; words: string[]; why: string }>
): Array<{ ruleId: string; why: string; matched: string }> {
  const hits: Array<{ ruleId: string; why: string; matched: string }> = [];
  for (const row of table) {
    for (const w of row.words) {
      const needle = w.toLowerCase();
      if (haystack.includes(needle)) {
        hits.push({ ruleId: row.ruleId, why: row.why, matched: w });
        break;
      }
    }
  }
  return hits;
}

function globalProv(m: {
  ruleId: string;
  why: string;
  matched: string;
}): RuleProvenance {
  return {
    ruleId: m.ruleId,
    source: "global",
    why: `${m.why} (matched "${m.matched}")`,
  };
}

function fromSelf(input: ClassifyInput, ctx: UserContext): boolean {
  return input.fromEmail.toLowerCase() === ctx.userEmail.toLowerCase();
}

function isShortAcknowledgment(input: ClassifyInput): boolean {
  const body = input.bodySnippet ?? input.snippet ?? "";
  if (body.length === 0) return false;
  if (body.length >= 50) return false;
  return !containsActionVerb(body);
}

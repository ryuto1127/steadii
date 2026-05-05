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
  GITHUB_HIGH_SIGNALS,
  containsActionVerb,
  isBotSender,
  isEduDomain,
  isGithubNotificationDomain,
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

  // Wave 5 — learned opt-out. When the user has restored a similar item
  // before, we record an agent_rules row scoped to the sender/domain
  // with risk_tier='medium'. Auto-archive consults this flag and skips
  // the archive even if bucket+confidence would otherwise qualify.
  const learnedOptOut =
    learnedDomain?.riskTier === "medium" ||
    learnedDomain?.riskTier === "high" ||
    learnedSender?.riskTier === "medium" ||
    learnedSender?.riskTier === "high";

  // Local helper to assemble a consistent TriageResult. Every return
  // site goes through this so confidence + learnedOptOut stay in lockstep
  // with the bucket choice. firstTimeSender is already false for
  // fromSelf rows (computed above) so no override is needed.
  const finish = (bucket: InboxBucket, confidence: number): TriageResult => ({
    bucket,
    senderRole,
    ruleProvenance: provenance,
    firstTimeSender,
    confidence,
    learnedOptOut,
  });

  // ---------------------------------------------------------------------
  // IGNORE bucket (checked first; short-circuits everything else).
  // Confidence is 1.0 — these are deterministic Gmail-side signals.
  // ---------------------------------------------------------------------
  if (fromSelf(input, ctx)) {
    provenance.push({
      ruleId: "GLOBAL_IGNORE_FROM_SELF",
      source: "global",
      why: "Auto-reply from the user's own address.",
    });
    return finish("ignore", 1.0);
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
    return finish("ignore", 1.0);
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
    return finish("ignore", 1.0);
  }

  // ---------------------------------------------------------------------
  // GitHub notification routing (auto_low default, gated escalation).
  // PR-comment / review-request emails arrive from notifications.github.com
  // wearing a human display name (the comment author). Without this branch
  // the AUTO_HIGH first-time-domain heuristic + role-based escalation fired
  // on every PR notification, drowning the inbox. Default these to
  // auto_low; escalate only on explicit reviewer-request signals or an
  // @-mention of the user's own GitHub login.
  //
  // This branch runs BEFORE the generic bot-sender ignore. GitHub
  // notifications are bot-relays by definition (notifications.github.com
  // is in BOT_HOST_HINTS) but we want them visible at auto_low rather
  // than silently dropped — the user often does need to see the PR
  // happened, just not at top-of-inbox priority. Generic bot mail still
  // gets ignored by the check below.
  // ---------------------------------------------------------------------
  if (isGithubNotificationDomain(input.fromDomain)) {
    const userLoginPattern = ctx.githubUsername
      ? new RegExp(`@${escapeRegExp(ctx.githubUsername)}\\b`, "i")
      : null;
    const promote =
      GITHUB_HIGH_SIGNALS.some((re) => re.test(haystack)) ||
      (userLoginPattern ? userLoginPattern.test(haystack) : false);
    if (promote) {
      provenance.push({
        ruleId: "GLOBAL_AUTO_HIGH_GITHUB_REVIEW_REQUESTED",
        source: "global",
        why: "GitHub notification with reviewer-request / CI-failure / merge-conflict signal.",
      });
      return finish("auto_high", 0.92);
    }
    provenance.push({
      ruleId: "GLOBAL_AUTO_LOW_GITHUB_NOTIFICATION",
      source: "global",
      why: "GitHub notification (default routing — bot relay despite human display name).",
    });
    return finish("auto_low", 0.95);
  }

  // Generic bot-sender ignore. Catches everything other than GitHub
  // (handled above). Same `containsActionVerb` guard as before so OTP /
  // password-reset bot mail still surfaces.
  if (
    isBotSender({
      fromEmail: input.fromEmail,
      fromName: input.fromName,
      autoSubmittedHeader: input.autoSubmittedHeader ?? null,
      precedenceHeader: input.precedenceHeader ?? null,
    }) &&
    !containsActionVerb(haystack)
  ) {
    provenance.push({
      ruleId: "GLOBAL_IGNORE_BOT_SENDER",
      source: "global",
      why: "Detected automated sender (bot, noreply, or auto-submitted) without action-required language.",
    });
    return finish("ignore", 1.0);
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
    // Stronger when learned role + keyword stack; weaker when first-time
    // alone (we err high but signal it's a guess to admin metrics).
    let conf = 0.85;
    if (escalatedRole) conf += 0.05;
    if (highMatches.length >= 2) conf += 0.05;
    if (highMatches.length >= 1 && escalatedRole) conf = 0.95;
    return finish("auto_high", Math.min(0.99, conf));
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
    let conf = 0.78;
    if (senderRole === "professor" || senderRole === "ta") conf = 0.92;
    if (medMatches.length >= 2) conf = Math.max(conf, 0.86);
    return finish("auto_medium", conf);
  }

  // ---------------------------------------------------------------------
  // AUTO_LOW — RSVPs, short acknowledgments, personal contacts.
  // Only this bucket auto-archives at confidence ≥ 0.95 (Wave 5).
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
    // Confidence model — additive signals, capped at 0.99. Tuned so
    // single-signal items stay ≤ 0.85 (no auto-archive; Inbox surfaces
    // them at low visual weight) and clear multi-signal noise lands ≥
    // 0.95 (auto-archive eligible).
    let conf = 0;
    if (lowMatches.length >= 1) conf = Math.max(conf, 0.82);
    if (lowMatches.length >= 2) conf = Math.max(conf, 0.93);
    if (isShortAck) conf = Math.max(conf, 0.84);
    if (senderRole === "personal") conf = Math.max(conf, 0.96);
    // Domain familiarity bonus — if we've seen the domain before, the
    // false-positive risk drops materially (the user has handled mail
    // from this domain in some bucket and we still landed in auto_low).
    if (!firstTimeSender && conf > 0) conf = Math.min(0.99, conf + 0.03);
    // Stack a short-ack on top of a keyword match — strong "really nothing
    // here" signal (the kind of "Got it, thanks!" that a real secretary
    // would archive without thinking).
    if (lowMatches.length >= 1 && isShortAck) conf = Math.max(conf, 0.95);
    return finish("auto_low", conf || 0.75);
  }

  // ---------------------------------------------------------------------
  // Fallback → L2 (not invoked in W1).
  // L2 fills its own confidence on the way back; L1 stamps 0.5 to mark
  // "we punted" so the admin distribution is honest.
  // ---------------------------------------------------------------------
  provenance.push({
    ruleId: "GLOBAL_L2_FALLBACK",
    source: "global",
    why: "No L1 rule matched — deferred to L2 classifier.",
  });
  return finish("l2_pending", 0.5);
}

// Wave 5 — public threshold for the auto-archive decision. Exported so
// the auto-archive helper, tests, and admin dashboards all read from a
// single source of truth. If the safety ramp tightens this past 0.95
// (≥ 5% false-positive rate observed during the α 2-week window), bump
// here and the gate moves with it.
export const AUTO_ARCHIVE_CONFIDENCE_THRESHOLD = 0.95;

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

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

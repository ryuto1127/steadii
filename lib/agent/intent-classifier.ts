// 2026-05-19 — Task intent classifier.
//
// Given a task title (e.g., "<会社名>への返信" / "Reply to Acme Travel"),
// infer what the user actually wants Steadii to help with. Output is a
// typed `TaskIntent` plus a confidence score the UI can use to decide
// how prominently to surface a smart-action affordance.
//
// Phase 1 (this file): regex + entity-graph anchored patterns. Pure
// function, no I/O. Deterministic.
//
// Phase 2 (next PR): LLM fallback (gpt-5.4-nano) when regex confidence
// is low. Persistence into a task_intent_metadata table so the LLM call
// only fires once per (userId, externalTaskId).
//
// Phase 3 (after that): UI smart-action button + glass-box hover that
// reads matchedPattern to explain the inference.
//
// Reference: SOUL.md-style philosophy from affaan-m/ECC (specialization
// first) — match the work to the right surface as early as possible
// rather than centralizing decisions on a single chat agent.

export type TaskIntent =
  | "DRAFT_EMAIL_REPLY"
  | "CALENDAR_EVENT"
  | "STUDY_SESSION"
  | "ASSIGNMENT_WORK"
  | "OTHER";

export type IntentClassificationContext = {
  // Optional entity records (from the entity graph) the user has — used
  // to anchor patterns like "<entity> への返信" with higher confidence.
  // When omitted, classification falls back to generic patterns only.
  knownEntities?: ReadonlyArray<{
    id: string;
    displayName: string;
    aliases: readonly string[];
  }>;
  // Optional class codes (e.g., MAT223, CSC110) — anchor STUDY_SESSION
  // / ASSIGNMENT_WORK intents when the title cites a known class.
  knownClassCodes?: readonly string[];
};

export type IntentClassification = {
  intent: TaskIntent;
  // 0–1 confidence. 0.9+ = entity- or class-code-anchored exact match.
  // 0.7–0.85 = pattern match without entity anchor. <0.6 = ambiguous,
  // expect a future LLM fallback (Phase 2) to refine. 0 = OTHER fallback.
  confidence: number;
  // Pattern name (debug + glass-box). Stable identifier the UI can use
  // to render an explanation like "matched: entity-anchored-reply".
  matchedPattern?: string;
  // When the title named a known entity, the entity's id flows through
  // so Phase 2's context pre-fetch can skip the lookup_entity hop.
  matchedEntityId?: string;
  // When the title named a known class code, ditto.
  matchedClassCode?: string;
};

type Pattern = {
  readonly name: string;
  readonly regex: RegExp;
  readonly intent: TaskIntent;
  readonly confidence: number;
};

// Generic patterns. Tried only AFTER entity- and class-code-anchored
// matches have a chance to fire — those produce higher-confidence
// classifications. Order within this list matters: earlier patterns
// take precedence on ties.
const GENERIC_PATTERNS: ReadonlyArray<Pattern> = [
  // ----- DRAFT_EMAIL_REPLY (JA + EN) -----
  {
    name: "ja-X-eno-reply",
    // 「<sender>へ(の)返信」 / 「<sender>に(対する)返信」
    regex: /(.{1,40})(へ|に対する|に)の?(返信|返事|reply)/u,
    intent: "DRAFT_EMAIL_REPLY",
    confidence: 0.85,
  },
  {
    name: "ja-draft-reply-keyword",
    regex: /(返信ドラフト|下書き返信|返信案|返信を書く|返信を作る|メール返信)/u,
    intent: "DRAFT_EMAIL_REPLY",
    confidence: 0.8,
  },
  {
    name: "en-reply-to",
    // "reply to <X>" / "respond to <X>"
    regex: /\b(reply|respond) (to|back to) /i,
    intent: "DRAFT_EMAIL_REPLY",
    confidence: 0.85,
  },
  {
    name: "en-draft-reply",
    regex: /\bdraft (a |an )?(reply|response|email)\b/i,
    intent: "DRAFT_EMAIL_REPLY",
    confidence: 0.85,
  },
  {
    name: "en-follow-up",
    // "follow up on <X>" — typically results in a reply or new email
    regex: /\bfollow[ -]up (on|with) /i,
    intent: "DRAFT_EMAIL_REPLY",
    confidence: 0.7,
  },

  // ----- CALENDAR_EVENT (JA + EN) -----
  {
    name: "ja-meeting-keyword",
    regex: /(ミーティング|打合せ|打ち合わせ|面談|会議|オンライン会議|MTG)/u,
    intent: "CALENDAR_EVENT",
    confidence: 0.75,
  },
  {
    name: "ja-time-anchored",
    // 「5/22 14:00 ...」 / 「12月3日 14時 ...」 — date + time fragment
    regex: /(\d{1,2}\/\d{1,2}|\d{1,2}月\d{1,2}日)[^\n]{0,30}(\d{1,2}:\d{2}|\d{1,2}時)/u,
    intent: "CALENDAR_EVENT",
    confidence: 0.7,
  },
  {
    name: "en-meeting-with",
    regex: /\b(meeting|call|sync|catchup|catch[- ]up|interview) with /i,
    intent: "CALENDAR_EVENT",
    confidence: 0.85,
  },
  {
    name: "en-day-time-anchored",
    // "Friday 2pm" / "Mon 14:00" — weekday + time
    regex:
      /\b(mon|tue|wed|thu|fri|sat|sun)(day|sday|nesday|rsday|urday)?\b[^\n]{0,15}\d{1,2}\s*(am|pm|:[0-5]\d)/i,
    intent: "CALENDAR_EVENT",
    confidence: 0.7,
  },

  // ----- ASSIGNMENT_WORK (JA + EN) -----
  // Note: tried BEFORE STUDY_SESSION so an "MAT223 PS4" hits this first.
  {
    name: "ja-assignment-keyword",
    regex: /(課題|宿題|レポート|エッセイ|論文|提出物|writeup|essay|paper)/iu,
    intent: "ASSIGNMENT_WORK",
    confidence: 0.7,
  },
  {
    name: "en-assignment-keyword",
    regex:
      /\b(homework|assignment|essay|paper|writeup|problem[ -]?set|ps\d+|hw\d*|lab\s*\d+|midterm prep|final prep|deliverable)\b/i,
    intent: "ASSIGNMENT_WORK",
    confidence: 0.75,
  },

  // ----- STUDY_SESSION (JA + EN) -----
  {
    name: "ja-study-keyword",
    regex: /(復習|見直し|勉強|予習|理解|読む|読み込み|演習)/iu,
    intent: "STUDY_SESSION",
    confidence: 0.65,
  },
  {
    name: "en-study-keyword",
    regex: /\b(review|study|prep(?:are)?|go over|catch up on|read through)\b/i,
    intent: "STUDY_SESSION",
    confidence: 0.65,
  },
];

// Generic class-code shape — `[A-Z]{2,4}\s?\d{3,4}`. Lower confidence
// than the context.knownClassCodes path; used only when context didn't
// provide codes.
const GENERIC_CLASS_CODE = /\b[A-Z]{2,4}\s?\d{3,4}\b/;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function classifyTaskIntent(
  rawTitle: string,
  context: IntentClassificationContext = {},
): IntentClassification {
  const title = rawTitle.trim();
  if (title.length === 0) {
    return { intent: "OTHER", confidence: 0 };
  }

  // 1. Entity-anchored reply detection. When the entity graph has a
  //    record matching a substring of the title, AND the title contains
  //    reply / 返信 / respond, we classify as DRAFT_EMAIL_REPLY with
  //    high confidence and pass the entity id forward.
  if (context.knownEntities && context.knownEntities.length > 0) {
    for (const entity of context.knownEntities) {
      const candidates = [entity.displayName, ...entity.aliases].filter(
        (s) => s && s.length >= 2,
      );
      for (const name of candidates) {
        const escaped = escapeRegex(name);
        const titleHasEntity = new RegExp(escaped, "i").test(title);
        if (!titleHasEntity) continue;
        // Entity is in the title — does the title also signal a reply?
        const replyVerbRe =
          /(返信|返事|reply|respond|follow[ -]up|フォローアップ|メール返信)/iu;
        if (replyVerbRe.test(title)) {
          return {
            intent: "DRAFT_EMAIL_REPLY",
            confidence: 0.95,
            matchedPattern: "entity-anchored-reply",
            matchedEntityId: entity.id,
          };
        }
      }
    }
  }

  // 2. Class-code-anchored study / assignment detection. When the
  //    title cites a known class code AND a study or assignment
  //    keyword, classify confidently and tag the class code.
  if (context.knownClassCodes && context.knownClassCodes.length > 0) {
    for (const code of context.knownClassCodes) {
      const escaped = escapeRegex(code);
      const codeRe = new RegExp(`\\b${escaped}\\b`, "i");
      if (!codeRe.test(title)) continue;
      // Class code present — subclassify on the action keyword.
      if (
        /\b(課題|宿題|レポート|エッセイ|論文|PS\d+|HW\d*|lab\s*\d+|problem[ -]?set|essay|writeup|paper|midterm|final|exam)\b/iu.test(
          title,
        )
      ) {
        return {
          intent: "ASSIGNMENT_WORK",
          confidence: 0.9,
          matchedPattern: "class-code-with-assignment",
          matchedClassCode: code,
        };
      }
      if (/(復習|見直し|勉強|予習|review|study|prep(?:are)?|go over)/iu.test(title)) {
        return {
          intent: "STUDY_SESSION",
          confidence: 0.9,
          matchedPattern: "class-code-with-study",
          matchedClassCode: code,
        };
      }
      // Class code present but no action keyword → default to STUDY at
      // medium confidence; the UI may show a "study or work on
      // assignment?" disambiguation in Phase 3.
      return {
        intent: "STUDY_SESSION",
        confidence: 0.6,
        matchedPattern: "class-code-only",
        matchedClassCode: code,
      };
    }
  }

  // 3. Generic patterns — fastest path; no context required.
  for (const pat of GENERIC_PATTERNS) {
    if (pat.regex.test(title)) {
      return {
        intent: pat.intent,
        confidence: pat.confidence,
        matchedPattern: pat.name,
      };
    }
  }

  // 4. Generic class-code shape as a last-resort weak signal.
  if (GENERIC_CLASS_CODE.test(title)) {
    return {
      intent: "STUDY_SESSION",
      confidence: 0.5,
      matchedPattern: "generic-class-code-shape",
    };
  }

  // 5. Nothing matched.
  return { intent: "OTHER", confidence: 0 };
}

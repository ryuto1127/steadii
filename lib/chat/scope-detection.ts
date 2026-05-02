// Heuristic detector for "this is a tutor question, hand off to ChatGPT"
// vs "this is secretary work for Steadii". Pure function — no IO, no
// imports beyond standard JS — so it runs on both client (chat input
// inline preview) and server (handoff route validation).
//
// Wave 1 secretary-pivot foundation. Stays heuristic-only by design;
// an LLM classifier upgrade is a Wave 3+ enhancement if heuristics
// underperform.
//
// Spec — TEACHING vs LOOKUP, per memory `project_secretary_pivot.md`
// (§ "CRITICAL distinction: TEACHING vs LOOKUP"). The line is NOT
// "does the user ask a question" — secretaries answer questions all
// day. The line is *whose data the answer comes from*:
//
//   - TEACHING: general knowledge that any LLM would answer the same.
//     ("What is matrix multiplication?", "How does photosynthesis work?")
//     → handoff to ChatGPT.
//   - LOOKUP: answer comes from the user's own data — emails, syllabi,
//     calendar, classes, mistake notes, named professors, "this term",
//     "next week". A different user gets a different answer.
//     → pass through to Steadii's orchestrator.
//
// LOOKUP signals (any one fires the override): possessives ("my",
// 「私の」), specific class codes (MAT223, PSY100), user-context-bound
// time/scope ("this term", "next week", 「来週」), named people in the
// user's life ("Prof Tanaka", 「教授」), and explicit data-action verbs
// ("show me", "summarize", 「見せて」「まとめて」). A query that fires
// any of these alongside an info-seeking pattern is LOOKUP.
//
// Pure-knowledge patterns with NONE of those signals → TEACHING →
// flagged as tutor.
//
// When ambiguous, prefer LOOKUP. False negatives on tutor detection are
// recoverable (the user can re-ask in ChatGPT) but false positives lock
// the secretary out of doing real work.

export type ScopeDetection = {
  isTutor: boolean;
  // Free-form rule id, useful in tests and debug logs. Not surfaced in UI.
  reason?: string;
};

// Action verbs that, when used as the first word, signal a command for
// Steadii. Lowercased. Punctuation is stripped from the matched word.
const EN_COMMAND_LEAD_VERBS = new Set<string>([
  "schedule",
  "draft",
  "send",
  "move",
  "add",
  "cancel",
  "email",
  "message",
  "find",
  "search",
  "snooze",
  "remind",
  "postpone",
  "reschedule",
  "archive",
  "delete",
  "update",
  "set",
  "edit",
  "create",
  "plan",
  "book",
  "rsvp",
  "reply",
  "reply-all",
  "forward",
  "mark",
  "show",
  "list",
  "open",
  "summarize",
  "summarise",
  "ask",
  "tell",
  "who",
  "when",
  "where",
]);

// LOOKUP substrings — possessives, action implications, time/scope
// references that bind the query to the user's own data. Lowercased.
const EN_LOOKUP_SUBSTRINGS = [
  "my class",
  "my classes",
  "my inbox",
  "my calendar",
  "my syllabus",
  "my syllabi",
  "my task",
  "my tasks",
  "my email",
  "my emails",
  "my meeting",
  "my meetings",
  "my schedule",
  "my professor",
  "my prof",
  "my ta",
  "my advisor",
  "my next",
  "my last",
  "my upcoming",
  "my deadline",
  "my deadlines",
  "my chat",
  "my reading",
  "my workload",
  "what's due",
  "what is due",
  "who haven't i",
  "who have i not",
  "this class",
  "this syllabus",
  "this term",
  "this semester",
  "this week",
  "this month",
  "next week",
  "next term",
  "next month",
  "last week",
  "show me",
  "tell me what",
  "tell me when",
  "tell me where",
  "summarize my",
  "summarise my",
  "list my",
];

// LOOKUP regexes — patterns that imply user-context binding.
const EN_LOOKUP_REGEXES: RegExp[] = [
  // Class code: MAT223, PHY 205, CSC110, BIO 110A — 2-4 letters,
  // optional space/hyphen, 2-4 digits, optional letter suffix.
  /\b[A-Z]{2,4}[ -]?\d{2,4}[A-Z]?\b/,
  // Named professor / TA: "Prof Tanaka", "Professor Smith", "Dr. Jones"
  /\b(?:prof(?:\.|essor)?|dr\.?)\s+[A-Z][a-zA-Z]+/i,
  // Day names — implies user-context-bound time/scope (calendar lookup).
  /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  // Today/tomorrow/yesterday — user-time references, almost always
  // imply LOOKUP into calendar/inbox.
  /\b(today|tomorrow|yesterday)\b/i,
];

// JA LOOKUP markers — possessives, time/scope, named people, action
// verbs, and explicit data-keywords. Tested against the original
// (non-lowercased) text since Japanese has no casing.
const JA_LOOKUP_PATTERNS: RegExp[] = [
  // Action verbs as command lead.
  /送って/,
  /送信して/,
  /予定して/,
  /予定に/,
  /追加して/,
  /キャンセル/,
  /連絡して/,
  /メールして/,
  /メールを?(送|出|作)/,
  /調べて/,
  /探して/,
  /移動して/,
  /動かして/,
  /動かす/,
  /スヌーズ/,
  /消して/,
  /削除/,
  /編集/,
  /作成/,
  /見せて/,
  /見て/,
  /教えて(?=.*[私僕俺自分この今来明先]|.*[A-Z]{2,4}\d)/,
  /まとめて/,
  /リストして/,
  // Possessive — strongest LOOKUP signal.
  /(私|わたし|僕|ぼく|俺|自分)の/,
  // Demonstrative + user-context noun.
  /この(授業|シラバス|クラス|学期|教授|先生|TA|アドバイザー|メール|科目)/,
  // Time/scope — user-context-bound.
  /(来週|今週|今月|来月|先週|先月|今日|明日|昨日|今期|今学期|来学期|来年|今年|先年)/,
  // Named people in user's life — Prof, TA, advisor + a particle.
  /(教授|先生|TA|アドバイザー|担当)[\sのとにから]/,
  // Class code in JA-mixed text.
  /[A-Z]{2,4}[ -]?\d{2,4}[A-Z]?/,
  // Explicit user-data nouns — these are almost never asked in the
  // abstract, only about the user's own files.
  /(試験範囲|リーディングリスト|reading\s*list|ワークロード|workload|提出物|締切|タスク一覧|今週の|今日の)/i,
];

// EN tutor lead phrases. Case-insensitive prefix match. Pure-knowledge
// shapes only — anything containing a possessive / class code / time
// reference will already have been intercepted by the LOOKUP override.
const EN_TUTOR_LEADS = [
  "what is ",
  "what is a ",
  "what is an ",
  "what is the ",
  "what are ",
  "what is the difference",
  "what's the difference",
  "what does ",
  "what's a ",
  "what's an ",
  "explain ",
  "how does ",
  "how do you ",
  "how do i solve",
  "how is ",
  "how are ",
  "why does ",
  "why is ",
  "why are ",
  "can you teach ",
  "teach me ",
  "help me understand ",
  "define ",
  "describe how ",
  "describe the ",
  "derive ",
  "prove that ",
  "solve ",
  "calculate ",
  "compute ",
  "evaluate ",
  "show that ",
  "show how ",
];

// EN tutor keyword substrings (anywhere in text).
const EN_TUTOR_KEYWORDS = [
  "definition of ",
  "formula for ",
  "what does it mean ",
  "step by step",
  "step-by-step",
];

// JA tutor patterns. Tested against the original text. The 教えて
// pattern is intentionally absent here — 「教えて」 has lookup uses
// (「教えて、私の今週の予定」) and tutor uses; we route via LOOKUP signals
// instead of binary-classifying the verb.
const JA_TUTOR_PATTERNS: RegExp[] = [
  // とは at end of clause/text, or followed by 何/なに/?. Pure-knowledge
  // signal — but only fires if no LOOKUP override caught the query first.
  /[^?？]とは(?:[?？]|何|なに|\s*$)/,
  /って何/,
  /の違いは/,
  /の違いを/,
  /の仕組み/,
  /説明して/,
  /導出/,
  /[^?？]証明/,
  /解いて/,
  /解き方/,
  /公式は/,
  /定義は/,
  /なぜ.{0,10}になる/,
];

function stripPunct(word: string): string {
  return word.replace(/[^\p{L}\p{N}-]/gu, "");
}

function looksLikeLookup(lower: string, original: string): boolean {
  const firstToken = lower.split(/\s+/)[0];
  if (firstToken) {
    const cleaned = stripPunct(firstToken);
    if (cleaned && EN_COMMAND_LEAD_VERBS.has(cleaned)) return true;
  }
  if (EN_LOOKUP_SUBSTRINGS.some((r) => lower.includes(r))) return true;
  if (EN_LOOKUP_REGEXES.some((r) => r.test(original))) return true;
  if (JA_LOOKUP_PATTERNS.some((p) => p.test(original))) return true;
  return false;
}

function looksLikeTutor(lower: string, original: string): boolean {
  if (EN_TUTOR_LEADS.some((p) => lower.startsWith(p))) return true;
  if (EN_TUTOR_KEYWORDS.some((k) => lower.includes(k))) return true;
  if (JA_TUTOR_PATTERNS.some((p) => p.test(original))) return true;
  return false;
}

export function detectTutorScope(text: string): ScopeDetection {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { isTutor: false };

  const lower = trimmed.toLowerCase();

  // LOOKUP always wins. Per spec: false positives on tutor detection
  // are worse than false negatives — better to let an occasional pure-
  // knowledge question slip through than to lock out a legitimate
  // secretary lookup behind a "this looks like studying" UI.
  if (looksLikeLookup(lower, trimmed)) {
    return { isTutor: false, reason: "lookup-override" };
  }

  if (looksLikeTutor(lower, trimmed)) {
    return { isTutor: true, reason: "tutor-pattern" };
  }

  return { isTutor: false };
}

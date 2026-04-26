// Operator-maintained keyword lists for L1 triage. Grow over time based on
// false-negative rescue rate. Keep them terse — the classifier is a
// lowercased substring match against subject + snippet, not regex.
//
// Language support (Day 1): EN + JA only per memory. Multi-language
// expansion is post-α.

export type GlobalRule = {
  id: string;
  bucket: "auto_high" | "auto_medium" | "auto_low" | "ignore";
  // Short human-readable reason surfaced in the Settings transparency UI
  // and in `rule_provenance.why`. No dynamic interpolation — just the
  // rule's intrinsic meaning.
  why: string;
};

// AUTO_HIGH — strict, L2 cannot downgrade. W1 records, W2 enforces.
export const AUTO_HIGH_KEYWORDS: Array<{
  ruleId: string;
  words: string[];
  why: string;
}> = [
  {
    ruleId: "GLOBAL_AUTO_HIGH_ACADEMIC_INTEGRITY",
    words: [
      "plagiarism",
      "misconduct",
      "academic integrity",
      "剽窃",
      "不正行為",
      "学術不正",
    ],
    why: "Academic-integrity language — always high-risk.",
  },
  {
    ruleId: "GLOBAL_AUTO_HIGH_GRADE_APPEAL",
    words: [
      "grade appeal",
      "final grade",
      "transcript",
      "gpa",
      "成績",
      "単位",
      "評定",
      // JP α additions: status-of-enrollment / degree-loss language is the
      // same severity as a grade appeal — surfacing late risks the student
      // missing the action window.
      "退学",
      "停学",
      "学位",
    ],
    why: "Grade/transcript/enrollment terms — always high-risk.",
  },
  {
    ruleId: "GLOBAL_AUTO_HIGH_REGISTRATION",
    // JP-specific fallback for course-registration disputes that arrive
    // mid-cycle. 履修登録 is the JP-cycle's equivalent of "add/drop period"
    // — late-fix windows are short and admin-mediated, so always high-risk.
    words: ["履修登録の不備", "履修取消"],
    why: "Course-registration dispute (JP cycle) — always high-risk.",
  },
  {
    ruleId: "GLOBAL_AUTO_HIGH_SCHOLARSHIP",
    words: [
      "scholarship",
      "financial aid",
      "renewal",
      "tuition",
      "奨学金",
      "学費",
    ],
    why: "Scholarship / financial aid — always high-risk.",
  },
  {
    ruleId: "GLOBAL_AUTO_HIGH_RECOMMENDATION",
    words: ["recommendation letter", "reference letter", "推薦状"],
    why: "Recommendation / reference letter request.",
  },
  {
    ruleId: "GLOBAL_AUTO_HIGH_GRAD_SCHOOL",
    words: [
      "graduate school",
      "grad school application",
      "admissions",
      "大学院",
    ],
    why: "Graduate school / admissions.",
  },
  {
    ruleId: "GLOBAL_AUTO_HIGH_INTERNSHIP",
    words: [
      "internship offer",
      "interview invitation",
      "job offer",
      "インターン",
      "面接",
      "内定",
    ],
    why: "Internship / interview / offer.",
  },
];

// AUTO_MEDIUM — professor/TA triggers and question/deadline heuristics.
export const AUTO_MEDIUM_KEYWORDS: Array<{
  ruleId: string;
  words: string[];
  why: string;
}> = [
  {
    ruleId: "GLOBAL_AUTO_MEDIUM_DEADLINE",
    words: [
      "extension",
      "reschedule",
      "office hour",
      "due",
      "deadline",
      "締切",
      "延長",
      "オフィスアワー",
      // JP α additions: routine-but-actionable academic vocabulary that
      // shows up in professor / TA / lab emails on the JP cycle.
      "履修",
      "課題",
      "レポート",
      "ゼミ",
      "研究室",
      "期末試験",
      "中間試験",
      "出席",
      "課題提出",
      "試験",
    ],
    why: "Deadline / reschedule / office-hour / coursework language.",
  },
];

// AUTO_LOW — acknowledgments and lightweight confirmations.
export const AUTO_LOW_KEYWORDS: Array<{
  ruleId: string;
  words: string[];
  why: string;
}> = [
  {
    // "meeting" was previously in this list under the assumption it
    // signaled casual club gatherings. In practice it short-circuited
    // legitimate professor / advisor / interview meeting requests into
    // auto_low → no L2 → no draft. Removed; let L2 classify on full
    // context (sender role + body) instead. Verified by smoke test:
    // "Quick meeting Friday at 10am?" from a prof was being silently
    // dropped pre-fix.
    ruleId: "GLOBAL_AUTO_LOW_RSVP",
    words: [
      "rsvp",
      "club",
      "お知らせ",
      // JP α additions: extracurricular and informational events that
      // shouldn't escalate into AUTO_MEDIUM.
      "サークル",
      "部活",
      "説明会",
      "懇親会",
    ],
    why: "RSVP / club / announcement language.",
  },
];

// IGNORE — promo/marketing vendor sender substrings. If the sender's
// domain contains any of these, we add a promo hint. Paired with a
// `List-Unsubscribe` header to gate the IGNORE bucket.
export const PROMO_DOMAIN_HINTS: string[] = [
  "mailchimp",
  "sendgrid.net",
  "mktomail",
  "e.",
  "news.",
  "bounce.",
  "mail.notion.so", // common noisy corporate update
  "email.",
];

// Known .edu-style university TLDs used by AUTO_MEDIUM question heuristics.
export const EDU_TLDS: string[] = [".edu", ".ac.jp", ".ac.uk", ".ac.kr", ".edu.au"];

export function isPromoSenderDomain(senderDomain: string): boolean {
  const d = senderDomain.toLowerCase();
  return PROMO_DOMAIN_HINTS.some((hint) => d.includes(hint));
}

export function isEduDomain(senderDomain: string): boolean {
  const d = senderDomain.toLowerCase();
  return EDU_TLDS.some((tld) => d.endsWith(tld));
}

// Rough shortcut for "noreply@" / "no-reply@" / "donotreply@". Tested on
// the local-part only (before the @); false for any sender whose local-
// part doesn't suggest automation.
export function isNoreplySender(senderEmail: string): boolean {
  const local = senderEmail.split("@")[0]?.toLowerCase() ?? "";
  if (!local) return false;
  if (local === "noreply" || local === "no-reply" || local === "donotreply")
    return true;
  if (local.startsWith("noreply") || local.startsWith("no-reply")) return true;
  return false;
}

// Phase 7 W1 — JA-formatted course-code patterns used by the class-binding
// module to recognize a course identifier in the email subject. Operator-
// curated; grow over time per false-negative rescue rate. The plain Latin-
// script pattern (\b[A-Z]{2,4}-\d{2,4}\b) is hard-coded into class-binding
// itself since it covers EN-cycle universities (UTORONTO CSC108 etc.).
//
// Each regex is matched case-insensitively against the email subject. A
// hit is then cross-referenced against the user's classes.code values to
// avoid binding to an arbitrary 8-digit string that happens to look like
// a UTAS course code.
export const COURSE_CODE_PATTERNS_JA: RegExp[] = [
  // UTAS-style 8-digit numeric course codes (e.g., "21130200").
  /\b\d{8}\b/g,
  // Mixed-style codes used by some JP universities (e.g., "EE-204",
  // "INFO-101"). The Latin-only \b[A-Z]{2,4}-?\d{2,4}\b pattern is also
  // used by the class-binding module's generic SUBJECT_CODE_RE; this
  // duplicate is here so the JA-curated list stays self-contained.
  /\b[A-Z]{2,4}-\d{2,4}\b/g,
];

// Phase 7 W1 — kanji course-name fallback. When the subject contains one
// of these names AND that name appears in the user's classes.code or
// classes.name, the class-binding module promotes the row to subject_name
// match. Operator-maintained; pick the ~20 most commonly named JP
// undergraduate subjects so coverage stays useful without ballooning false
// positives.
export const KANJI_COURSE_NAMES_JA: string[] = [
  "線形代数",
  "微分積分",
  "情報科学",
  "熱力学",
  "量子力学",
  "経済学",
  "統計学",
  "心理学",
  "言語学",
  "哲学",
  "物理学",
  "化学",
  "生物学",
  "地学",
  "社会学",
  "歴史学",
  "政治学",
  "法学",
  "経営学",
  "会計学",
];

// Lightweight "does this subject/body contain an action verb" probe used
// by the noreply IGNORE rule. If a noreply email asks the user to do
// something ("confirm your email", "reset your password"), don't ignore.
const ACTION_VERBS_EN = [
  "confirm",
  "verify",
  "reset",
  "approve",
  "review",
  "sign",
  "complete",
  "action required",
];
const ACTION_VERBS_JA = ["確認", "承認", "リセット", "署名", "ご対応"];

export function containsActionVerb(text: string | null): boolean {
  if (!text) return false;
  const low = text.toLowerCase();
  if (ACTION_VERBS_EN.some((v) => low.includes(v))) return true;
  return ACTION_VERBS_JA.some((v) => text.includes(v));
}

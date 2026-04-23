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
    ],
    why: "Grade/transcript terms — always high-risk.",
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
    ],
    why: "Deadline / reschedule / office-hour language.",
  },
];

// AUTO_LOW — acknowledgments and lightweight confirmations.
export const AUTO_LOW_KEYWORDS: Array<{
  ruleId: string;
  words: string[];
  why: string;
}> = [
  {
    ruleId: "GLOBAL_AUTO_LOW_RSVP",
    words: ["rsvp", "meeting", "club", "お知らせ"],
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

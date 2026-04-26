import "server-only";

// Gate for the Student tier: user's primary (Google OAuth) email must look
// academic. W3 ships the primary-email path only — the "alternate email +
// verification link" flow for students whose Google account isn't .edu is
// a post-α refinement per project_decisions.md.
//
// Heuristic:
//   - *.edu             → US + many intl
//   - *.ac.<tld>        → UK (.ac.uk), JP (.ac.jp), NZ (.ac.nz), etc.
//   - Known CA domains  → utoronto.ca, ubc.ca, mcgill.ca, etc.
//   - Known JP domains  → most match `.ac.jp` but a handful use other
//                         TLDs and are pinned in the allow-list below.
//
// Canadian and Japanese universities overwhelmingly use their institutional
// domain directly (not a subdomain); the allow-list grows as students in α
// report mismatches.

const CANADIAN_UNIVERSITY_SUFFIXES = [
  "utoronto.ca",
  "mail.utoronto.ca",
  "ubc.ca",
  "student.ubc.ca",
  "alumni.ubc.ca",
  "mcgill.ca",
  "mail.mcgill.ca",
  "sfu.ca",
  "ualberta.ca",
  "ucalgary.ca",
  "uottawa.ca",
  "uwaterloo.ca",
  "concordia.ca",
  "queensu.ca",
  "mail.queensu.ca",
  "yorku.ca",
  "my.yorku.ca",
  "uwindsor.ca",
  "uwo.ca",
  "dal.ca",
  "carleton.ca",
  "uvic.ca",
  "uoguelph.ca",
  "mcmaster.ca",
  "usask.ca",
  "umanitoba.ca",
  "unb.ca",
] as const;

// Japanese universities. Most use `.ac.jp` and so are already covered by
// the regex above — this list exists for (a) display-name resolution at
// onboarding time, (b) the rare uni that uses a non-`.ac.jp` domain. Per
// the JP α readiness audit (~50 majors, 国立 + 主要私立 + 主要地方国立).
type JapaneseUniversity = {
  domain: string;
  display: string;
};

export const JAPANESE_UNIVERSITIES: readonly JapaneseUniversity[] = [
  // 国立 (national)
  { domain: "u-tokyo.ac.jp", display: "東京大学" },
  { domain: "kyoto-u.ac.jp", display: "京都大学" },
  { domain: "osaka-u.ac.jp", display: "大阪大学" },
  { domain: "tohoku.ac.jp", display: "東北大学" },
  { domain: "kyushu-u.ac.jp", display: "九州大学" },
  { domain: "hokudai.ac.jp", display: "北海道大学" },
  { domain: "nagoya-u.ac.jp", display: "名古屋大学" },
  { domain: "titech.ac.jp", display: "東京工業大学" },
  { domain: "hit-u.ac.jp", display: "一橋大学" },
  { domain: "kobe-u.ac.jp", display: "神戸大学" },
  { domain: "tsukuba.ac.jp", display: "筑波大学" },
  // 主要私立 (major private)
  { domain: "waseda.jp", display: "早稲田大学" },
  { domain: "keio.jp", display: "慶應義塾大学" },
  { domain: "sophia.ac.jp", display: "上智大学" },
  { domain: "icu.ac.jp", display: "国際基督教大学 (ICU)" },
  { domain: "meiji.ac.jp", display: "明治大学" },
  { domain: "aoyama.ac.jp", display: "青山学院大学" },
  { domain: "rikkyo.ac.jp", display: "立教大学" },
  { domain: "chuo-u.ac.jp", display: "中央大学" },
  { domain: "hosei.ac.jp", display: "法政大学" },
  { domain: "kansai-u.ac.jp", display: "関西大学" },
  { domain: "kwansei.ac.jp", display: "関西学院大学" },
  { domain: "doshisha.ac.jp", display: "同志社大学" },
  { domain: "ritsumei.ac.jp", display: "立命館大学" },
  { domain: "tsuda.ac.jp", display: "津田塾大学" },
  { domain: "tus.ac.jp", display: "東京理科大学" },
  { domain: "shibaura-it.ac.jp", display: "芝浦工業大学" },
  { domain: "meijigakuin.ac.jp", display: "明治学院大学" },
  { domain: "seikei.ac.jp", display: "成蹊大学" },
  { domain: "seijo.ac.jp", display: "成城大学" },
  { domain: "musashi.ac.jp", display: "武蔵大学" },
  { domain: "gakushuin.ac.jp", display: "学習院大学" },
  { domain: "nihon-u.ac.jp", display: "日本大学" },
  { domain: "toyo.jp", display: "東洋大学" },
  { domain: "komazawa-u.ac.jp", display: "駒澤大学" },
  { domain: "senshu-u.ac.jp", display: "専修大学" },
  { domain: "u-tokai.ac.jp", display: "東海大学" },
  // 主要地方国立 (regional national)
  { domain: "chiba-u.jp", display: "千葉大学" },
  { domain: "ynu.ac.jp", display: "横浜国立大学" },
  { domain: "tmu.ac.jp", display: "東京都立大学" },
  { domain: "niigata-u.ac.jp", display: "新潟大学" },
  { domain: "kanazawa-u.ac.jp", display: "金沢大学" },
  { domain: "okayama-u.ac.jp", display: "岡山大学" },
  { domain: "hiroshima-u.ac.jp", display: "広島大学" },
  { domain: "nagasaki-u.ac.jp", display: "長崎大学" },
  { domain: "kumamoto-u.ac.jp", display: "熊本大学" },
  { domain: "u-ryukyu.ac.jp", display: "琉球大学" },
] as const;

const JAPANESE_UNIVERSITY_SUFFIXES = JAPANESE_UNIVERSITIES.map(
  (u) => u.domain
);

export function isAcademicEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  if (!normalized.includes("@")) return false;
  const domain = normalized.split("@")[1];
  if (!domain) return false;

  // Standard academic TLDs
  if (domain.endsWith(".edu")) return true;
  if (/\.ac\.[a-z]{2,}$/.test(domain)) return true;

  // Canadian university allow-list
  for (const suffix of CANADIAN_UNIVERSITY_SUFFIXES) {
    if (domain === suffix || domain.endsWith(`.${suffix}`)) return true;
  }

  // Japanese university allow-list — covers the rare schools whose primary
  // domain is not `.ac.jp` (waseda.jp, keio.jp, toyo.jp, chiba-u.jp etc.)
  // as well as making `.ac.jp` schools resolvable by display name.
  for (const suffix of JAPANESE_UNIVERSITY_SUFFIXES) {
    if (domain === suffix || domain.endsWith(`.${suffix}`)) return true;
  }

  return false;
}

// Resolve a domain to a display name when one is in the JP allow-list.
// Returns null when the domain isn't a known JP school — callers can then
// fall back to the bare domain string.
export function japaneseUniversityDisplay(
  email: string | null | undefined
): string | null {
  if (!email) return null;
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  if (!domain) return null;
  for (const u of JAPANESE_UNIVERSITIES) {
    if (domain === u.domain || domain.endsWith(`.${u.domain}`)) {
      return u.display;
    }
  }
  return null;
}

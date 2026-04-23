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
//
// Canadian universities overwhelmingly use their institutional domain
// directly (not a subdomain); the allow-list grows as students in α report
// mismatches.

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

  return false;
}

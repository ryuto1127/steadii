// engineer-56 — sender-side working-hours norms. Mirrors the shape of
// `sender-timezone-heuristic.ts` (engineer-45): pure function, no DB /
// no Sentry / no server-only side effects, safe to import from any
// runtime (chat tool, eval harness, agentic L2).
//
// Purpose: when drafting a counter-proposal, the agent must respect
// the SENDER's likely working hours too, not just the user's. A naive
// counter-proposal that "fits the user" (e.g. JST 6:00 from a Vancouver
// student's 8 AM PT) lands at the sender's pre-business hours and reads
// as inconsiderate / rude. This module supplies the sender-side defaults
// the prompt's COUNTER-PROPOSAL PATTERN rule 3b intersects with the
// user-side window.
//
// Heuristic set (rule-based, no LLM):
//   - .co.jp / .ne.jp / .or.jp / JA body → 09:00–18:00 Asia/Tokyo @ 0.9
//   - .gov / .go.jp                       → 09:00–17:00 sender TZ @ 0.9
//   - .com / business via sender-TZ infer → 09:00–17:00 sender TZ @ 0.7
//   - .edu / .ac.jp / .ac.uk (academic)   → 09:00–18:00 sender TZ @ 0.6
//   - Generic / unknown                   → 09:00–18:00 sender TZ @ 0.4
//
// Confidence drives the prompt-level decision (handoff spec):
//   ≥ 0.7 → use silently
//   0.4 – 0.7 → use AND disclose the assumption to the user
//   < 0.4 → ask the user OR research (research is engineer-57 territory)
//
// α scope: simple non-overnight window; no day-of-week variability.

import { inferSenderTimezone } from "./sender-timezone-heuristic";

export type SenderWorkingHoursInference = {
  start: string;
  end: string;
  tz: string;
  confidence: number;
  // The matched rule for transparency in audit_log / agent reasoning.
  source: string;
};

type Args = {
  senderEmail?: string | null;
  senderDomain?: string | null;
  body?: string | null;
};

// Extract just the domain portion from a full email or pass-through a
// raw domain. Mirrors the local helper inside sender-timezone-heuristic.
function normalizeDomain(input: string | null | undefined): string {
  const s = (input ?? "").trim().toLowerCase();
  if (!s) return "";
  return s.includes("@") ? s.split("@").pop() ?? s : s;
}

function endsWithSuffix(domain: string, suffix: string): boolean {
  return domain === suffix || domain.endsWith(`.${suffix}`);
}

// .co.jp / .ne.jp / .or.jp + JP body language → 09:00–18:00 JST.
// Strictest of the JP buckets (recruiters / business correspondents
// keep tight hours).
const JP_BUSINESS_SUFFIXES = ["co.jp", "ne.jp", "or.jp"];
// .gov / .go.jp / .gc.ca → government (strictest 09:00–17:00).
const GOV_SUFFIXES = ["gov", "go.jp", "gc.ca"];
// Government with country prefix (.gov.uk, .gov.au, .gov.cn). Long-tail
// matched via endsWith(".gov.").
const GOV_PREFIXES = [".gov."];
// Universities — wider window because academics work odd hours.
const ACADEMIC_SUFFIXES = ["edu", "ac.jp", "ac.uk", "edu.au"];

export function inferSenderWorkingHours(
  args: Args
): SenderWorkingHoursInference {
  const domain = normalizeDomain(args.senderEmail || args.senderDomain);
  const body = args.body ?? null;

  // 1) JP business → 09:00–18:00 Asia/Tokyo. Domain hit OR (generic domain
  // + JP body language). Confidence 0.9 (strict business norms).
  for (const suffix of JP_BUSINESS_SUFFIXES) {
    if (domain && endsWithSuffix(domain, suffix)) {
      return {
        start: "09:00",
        end: "18:00",
        tz: "Asia/Tokyo",
        confidence: 0.9,
        source: `domain:${suffix}`,
      };
    }
  }
  // Body-language signal — JP body from a generic domain (e.g. gmail.com)
  // still indicates JP business norms.
  const tzInference = inferSenderTimezone({ domain, body });
  if (tzInference.tz === "Asia/Tokyo" && tzInference.source?.startsWith("body-lang:")) {
    return {
      start: "09:00",
      end: "18:00",
      tz: "Asia/Tokyo",
      confidence: 0.8,
      source: "body-lang:ja",
    };
  }

  // 2) Government → 09:00–17:00 sender TZ. Strictest.
  for (const suffix of GOV_SUFFIXES) {
    if (domain && endsWithSuffix(domain, suffix)) {
      const tz = tzInference.tz ?? guessTzFromGovDomain(suffix);
      return {
        start: "09:00",
        end: "17:00",
        tz,
        confidence: 0.9,
        source: `domain:${suffix}`,
      };
    }
  }
  for (const prefix of GOV_PREFIXES) {
    if (domain && domain.includes(prefix)) {
      const tz = tzInference.tz ?? "UTC";
      return {
        start: "09:00",
        end: "17:00",
        tz,
        confidence: 0.85,
        source: `domain:${prefix.replace(/\./g, "")}`,
      };
    }
  }

  // 3) Academic → 09:00–18:00 sender TZ, confidence 0.6 (wider — profs
  // often legitimately work outside the band, but α-correctness says
  // use a default window and disclose).
  for (const suffix of ACADEMIC_SUFFIXES) {
    if (domain && endsWithSuffix(domain, suffix)) {
      const tz = tzInference.tz ?? guessTzFromAcademicSuffix(suffix);
      return {
        start: "09:00",
        end: "18:00",
        tz,
        confidence: 0.6,
        source: `domain:${suffix}`,
      };
    }
  }

  // 4) Business sender with inferable TZ (.de, .fr, .com via JP body
  // already handled above) → 09:00–17:00 sender TZ, confidence 0.7.
  if (tzInference.tz && tzInference.confidence >= 0.6) {
    return {
      start: "09:00",
      end: "17:00",
      tz: tzInference.tz,
      confidence: 0.7,
      source: `tz-inferred:${tzInference.source ?? "unknown"}`,
    };
  }

  // 5) Fallback — generic / unknown. Default 09:00–18:00 sender TZ but
  // confidence 0.4 so the prompt path discloses the assumption.
  const fallbackTz = tzInference.tz ?? "UTC";
  return {
    start: "09:00",
    end: "18:00",
    tz: fallbackTz,
    confidence: 0.4,
    source: "fallback:generic",
  };
}

// Government domains where the TZ is obvious from the TLD itself.
function guessTzFromGovDomain(suffix: string): string {
  if (suffix === "go.jp") return "Asia/Tokyo";
  if (suffix === "gc.ca") return "America/Toronto"; // dominant federal TZ
  return "UTC";
}

function guessTzFromAcademicSuffix(suffix: string): string {
  if (suffix === "ac.jp") return "Asia/Tokyo";
  if (suffix === "ac.uk") return "Europe/London";
  if (suffix === "edu.au") return "Australia/Sydney";
  return "UTC";
}

// User-norm defaults — used by SLOT FEASIBILITY CHECK rule 0 (soft
// default) when USER_WORKING_HOURS is not explicitly set. The buckets
// are intentionally coarse: NA (any America/*), JP/East Asia, Europe,
// other. Refinement happens via Part-4 silent-learning + the explicit
// save_working_hours tool.
//
// The values mirror the handoff spec exactly; if the spec changes the
// memory note in feedback_agent_failure_modes.md should follow.

export type UserNormDefault = {
  start: string;
  end: string;
  source: string;
};

const EAST_ASIA_TZS = new Set([
  "Asia/Tokyo",
  "Asia/Seoul",
  "Asia/Shanghai",
  "Asia/Taipei",
  "Asia/Hong_Kong",
  "Asia/Singapore",
]);

export function defaultUserWorkingHours(timezone: string | null): UserNormDefault {
  const tz = (timezone ?? "").trim();
  if (tz.startsWith("America/")) {
    return { start: "09:00", end: "22:00", source: "norm:north-america" };
  }
  if (EAST_ASIA_TZS.has(tz)) {
    return { start: "08:00", end: "22:00", source: "norm:east-asia" };
  }
  if (tz.startsWith("Europe/")) {
    return { start: "08:00", end: "21:00", source: "norm:europe" };
  }
  return { start: "09:00", end: "21:00", source: "norm:other" };
}

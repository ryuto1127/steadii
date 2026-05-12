// engineer-45 — fixed-mapping sender-domain → IANA TZ heuristic. Pure
// function; safe to import from any runtime (no DB / no Sentry / no
// server-only side effects).
//
// Used by the agentic L2 loop as a low-cost first pass before
// infer_sender_timezone (which can run an LLM call). When this returns
// a non-null tz with confidence ≥ 0.6, agentic L2 can skip the
// infer_sender_timezone call entirely; otherwise it falls through.
//
// Countries with multiple time zones (US, Canada, Australia, Russia)
// intentionally return null — guessing wrong is worse than admitting
// uncertainty and letting the LLM-side inference run.

export type SenderTimezoneInference = {
  tz: string | null;
  confidence: number;
  // The matched rule for transparency in audit_log / agent reasoning.
  source: string | null;
};

type DomainRule = {
  // Suffix to match (case-insensitive). The leading dot is implicit.
  suffix: string;
  tz: string;
  confidence: number;
  source: string;
};

// Ordered most-specific suffix first. The matcher walks the list in
// order and takes the first hit so `co.jp` wins over `jp` on
// "recruit.co.jp".
const DOMAIN_RULES: DomainRule[] = [
  // Japan — all forms unambiguously +9.
  { suffix: "co.jp", tz: "Asia/Tokyo", confidence: 0.95, source: "tld:co.jp" },
  { suffix: "ac.jp", tz: "Asia/Tokyo", confidence: 0.95, source: "tld:ac.jp" },
  { suffix: "or.jp", tz: "Asia/Tokyo", confidence: 0.95, source: "tld:or.jp" },
  { suffix: "ne.jp", tz: "Asia/Tokyo", confidence: 0.95, source: "tld:ne.jp" },
  { suffix: "go.jp", tz: "Asia/Tokyo", confidence: 0.95, source: "tld:go.jp" },
  { suffix: "jp", tz: "Asia/Tokyo", confidence: 0.95, source: "tld:jp" },

  // UK — politically one TZ even though there's a tiny Western Isles
  // exception nobody hits.
  { suffix: "ac.uk", tz: "Europe/London", confidence: 0.9, source: "tld:ac.uk" },
  { suffix: "co.uk", tz: "Europe/London", confidence: 0.9, source: "tld:co.uk" },
  { suffix: "gov.uk", tz: "Europe/London", confidence: 0.9, source: "tld:gov.uk" },
  { suffix: "uk", tz: "Europe/London", confidence: 0.9, source: "tld:uk" },

  // East Asia — single-TZ countries.
  { suffix: "cn", tz: "Asia/Shanghai", confidence: 0.9, source: "tld:cn" },
  { suffix: "kr", tz: "Asia/Seoul", confidence: 0.95, source: "tld:kr" },
  { suffix: "tw", tz: "Asia/Taipei", confidence: 0.9, source: "tld:tw" },
  { suffix: "hk", tz: "Asia/Hong_Kong", confidence: 0.9, source: "tld:hk" },
  { suffix: "sg", tz: "Asia/Singapore", confidence: 0.9, source: "tld:sg" },

  // Western Europe — single-TZ countries (CET/CEST band).
  { suffix: "de", tz: "Europe/Berlin", confidence: 0.85, source: "tld:de" },
  { suffix: "fr", tz: "Europe/Paris", confidence: 0.85, source: "tld:fr" },
  { suffix: "it", tz: "Europe/Rome", confidence: 0.85, source: "tld:it" },
  { suffix: "es", tz: "Europe/Madrid", confidence: 0.85, source: "tld:es" },
  { suffix: "nl", tz: "Europe/Amsterdam", confidence: 0.85, source: "tld:nl" },
  { suffix: "be", tz: "Europe/Brussels", confidence: 0.85, source: "tld:be" },
  { suffix: "ch", tz: "Europe/Zurich", confidence: 0.85, source: "tld:ch" },
  { suffix: "at", tz: "Europe/Vienna", confidence: 0.85, source: "tld:at" },
  { suffix: "se", tz: "Europe/Stockholm", confidence: 0.85, source: "tld:se" },
  { suffix: "no", tz: "Europe/Oslo", confidence: 0.85, source: "tld:no" },
  { suffix: "dk", tz: "Europe/Copenhagen", confidence: 0.85, source: "tld:dk" },
  { suffix: "fi", tz: "Europe/Helsinki", confidence: 0.85, source: "tld:fi" },
  { suffix: "ie", tz: "Europe/Dublin", confidence: 0.85, source: "tld:ie" },
  { suffix: "pl", tz: "Europe/Warsaw", confidence: 0.85, source: "tld:pl" },

  // Single-TZ Oceania + Asia outliers.
  { suffix: "nz", tz: "Pacific/Auckland", confidence: 0.85, source: "tld:nz" },
  { suffix: "in", tz: "Asia/Kolkata", confidence: 0.85, source: "tld:in" },
  { suffix: "il", tz: "Asia/Jerusalem", confidence: 0.85, source: "tld:il" },
  { suffix: "ae", tz: "Asia/Dubai", confidence: 0.85, source: "tld:ae" },

  // Brazil — politically one official TZ at the federal level (since
  // 2019 there's no DST and a few western states are -04). Most senders
  // are São Paulo / Rio though.
  { suffix: "br", tz: "America/Sao_Paulo", confidence: 0.8, source: "tld:br" },
];

// Countries that span more than one TZ — explicitly returned as null so
// callers know not to fall through to a generic guess. Documented so a
// reviewer doesn't add them to DOMAIN_RULES "to be helpful."
const MULTI_TZ_TLDS = new Set([
  "us",
  "ca",
  "gc.ca",
  "ab.ca",
  "bc.ca",
  "on.ca",
  "qc.ca",
  "au",
  "com.au",
  "edu.au",
  "gov.au",
  "ru",
  "mx",
  "ar",
  "id",
  "kz",
]);

export function inferSenderTzFromDomain(
  domain: string
): SenderTimezoneInference {
  const d = (domain ?? "").trim().toLowerCase();
  if (!d) return { tz: null, confidence: 0, source: null };

  // Strip a leading @ or full email — accept either "co.jp", "@co.jp",
  // or "user@example.co.jp".
  const cleanedDomain = d.includes("@") ? d.split("@").pop() ?? d : d;

  // Multi-TZ countries: explicit null. Match on suffix.
  for (const multi of MULTI_TZ_TLDS) {
    if (cleanedDomain === multi || cleanedDomain.endsWith(`.${multi}`)) {
      return { tz: null, confidence: 0, source: `multi-tz:${multi}` };
    }
  }

  for (const rule of DOMAIN_RULES) {
    if (
      cleanedDomain === rule.suffix ||
      cleanedDomain.endsWith(`.${rule.suffix}`)
    ) {
      return { tz: rule.tz, confidence: rule.confidence, source: rule.source };
    }
  }

  return { tz: null, confidence: 0, source: null };
}

import "server-only";
import type { gmail_v1 } from "googleapis";

// Pull a clean plain-text body out of a Gmail Schema$Message. Walks
// `payload.parts` (and the top-level payload itself for single-part
// messages), prefers text/plain, falls back to a sanitized text/html
// rendering. Returns "" for messages with no usable body — callers
// should fall back to the ingest-time snippet in that case.

type PartLike = gmail_v1.Schema$MessagePart;

export type ExtractedBody = {
  text: string;
  format: "text/plain" | "text/html_stripped" | "empty";
};

export function extractEmailBody(
  message: gmail_v1.Schema$Message
): ExtractedBody {
  const payload = message.payload;
  if (!payload) return { text: "", format: "empty" };

  const plain = findPart(payload, "text/plain");
  if (plain) {
    const decoded = decodeBase64Url(plain.body?.data ?? "");
    if (decoded) return { text: cleanWhitespace(decoded), format: "text/plain" };
  }

  const html = findPart(payload, "text/html");
  if (html) {
    const decoded = decodeBase64Url(html.body?.data ?? "");
    if (decoded) {
      return {
        text: cleanWhitespace(stripHtml(decoded)),
        format: "text/html_stripped",
      };
    }
  }

  return { text: "", format: "empty" };
}

// Recursive part-walker. Gmail multipart messages can nest arbitrarily
// (e.g. multipart/alternative inside multipart/mixed) so we DFS for the
// first part with the matching mimeType.
function findPart(part: PartLike, mimeType: string): PartLike | null {
  if (part.mimeType === mimeType) return part;
  if (part.parts) {
    for (const child of part.parts) {
      const hit = findPart(child, mimeType);
      if (hit) return hit;
    }
  }
  return null;
}

// Gmail bodies are base64url-encoded (RFC 4648) — `-` for `+`, `_` for
// `/`, no padding. Convert to standard base64 then decode as UTF-8.
function decodeBase64Url(s: string): string {
  if (!s) return "";
  const std = s.replace(/-/g, "+").replace(/_/g, "/");
  const padded = std + "=".repeat((4 - (std.length % 4)) % 4);
  try {
    return Buffer.from(padded, "base64").toString("utf-8");
  } catch {
    return "";
  }
}

// Strip HTML tags + decode common entities. We keep this simple
// (no DOMPurify / cheerio) because we never render the result as
// HTML — it goes straight into a `<pre>` or text node, so the
// only XSS risk is React's own escaping (which is automatic for
// strings). Cost: ~50 lines, no new deps.
function stripHtml(html: string): string {
  // Remove script / style blocks entirely (their content isn't
  // meaningful to a human reader).
  let s = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, "");

  // Convert common block-level tags to newlines for readable
  // line breaks. Done before the catch-all tag strip so we
  // preserve paragraph boundaries.
  s = s.replace(/<\/?(p|div|br|tr|h[1-6]|li|blockquote)[^>]*>/gi, "\n");

  // Strip every remaining tag.
  s = s.replace(/<[^>]+>/g, "");

  // Decode the handful of HTML entities that show up in the wild.
  s = decodeHtmlEntities(s);

  return s;
}

const ENTITY_MAP: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
  "&copy;": "©",
  "&reg;": "®",
  "&trade;": "™",
  "&hellip;": "…",
  "&mdash;": "—",
  "&ndash;": "–",
  "&lsquo;": "‘",
  "&rsquo;": "’",
  "&ldquo;": "“",
  "&rdquo;": "”",
};

function decodeHtmlEntities(s: string): string {
  let out = s;
  for (const [k, v] of Object.entries(ENTITY_MAP)) {
    out = out.split(k).join(v);
  }
  // Numeric entities — &#NNN; (decimal) and &#xHHHH; (hex)
  out = out.replace(/&#(\d+);/g, (_, n) => {
    const code = parseInt(n, 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : "";
  });
  out = out.replace(/&#x([0-9a-f]+);/gi, (_, h) => {
    const code = parseInt(h, 16);
    return Number.isFinite(code) ? String.fromCodePoint(code) : "";
  });
  return out;
}

function cleanWhitespace(s: string): string {
  // Normalize CRLF → LF, collapse triple+ blank lines to double,
  // trim each line's right edge, and trim the whole string.
  return s
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Autolink — finds `https?://...` URLs in plain text and returns a
// list of `{ kind: "text" | "link", value: string }` segments. The
// caller renders text segments as-is and link segments inside `<a>`.
// Kept here (not in the React component) so it's testable + reusable.
export type LinkifiedSegment =
  | { kind: "text"; value: string }
  | { kind: "link"; value: string };

const URL_RE =
  /https?:\/\/[^\s<>()\[\]"']+[^\s<>()\[\]"',.;:!?]/g;

export function linkifySegments(text: string): LinkifiedSegment[] {
  if (!text) return [];
  const out: LinkifiedSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    const start = match.index ?? 0;
    if (start > last) {
      out.push({ kind: "text", value: text.slice(last, start) });
    }
    out.push({ kind: "link", value: match[0] });
    last = start + match[0].length;
  }
  if (last < text.length) {
    out.push({ kind: "text", value: text.slice(last) });
  }
  return out;
}

import "server-only";
import { openai } from "@/lib/integrations/openai/client";
import { syllabusSchema, type Syllabus } from "./schema";
import { selectModel } from "@/lib/agent/models";
import { recordUsage } from "@/lib/agent/usage";
import { assertCreditsAvailable } from "@/lib/billing/credits";
import { routeSyllabusInput, type SyllabusInput } from "./router";
import { load as loadHtml } from "cheerio";
import { safeFetch } from "@/lib/utils/ssrf-guard";

const SYSTEM_PROMPT = `You extract structured syllabus data from a raw document.
Return strictly the fields in the provided JSON schema. Use null for any field
you can't find. Schedule entries should be chronological and terse.

Format every \`schedule[].date\` as ISO 8601 so downstream tooling can parse it
without ambiguity:
- If a time is given, use \`YYYY-MM-DDTHH:MM\` (e.g. \`2026-01-13T10:00\`).
- If only a date is given, use \`YYYY-MM-DD\` (e.g. \`2026-01-13\`); calendar
  import will default that to 9 AM local time.
- If only a week number is given (e.g. "Week 1"), infer the calendar date
  from the term's start date when it is stated in the syllabus.
- If the date is genuinely TBD or unknown, set \`date\` to null (the row
  will be skipped during calendar import).
- The year MUST appear in the ISO string. Infer it from the term ("Spring
  2026", "Sept 2026 - Dec 2026", etc.) when the schedule lists only month
  and day.

ALWAYS populate \`raw\` with a close-to-verbatim transcription of the source,
preserving section headings, tables, and the weekly schedule — the student
will re-read it later, so don't summarize.`;

const SYLLABUS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    courseName: { type: ["string", "null"] },
    courseCode: { type: ["string", "null"] },
    term: { type: ["string", "null"] },
    instructor: { type: ["string", "null"] },
    officeHours: { type: ["string", "null"] },
    grading: { type: ["string", "null"] },
    attendance: { type: ["string", "null"] },
    textbooks: { type: ["string", "null"] },
    schedule: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          date: { type: ["string", "null"] },
          topic: { type: ["string", "null"] },
        },
        required: ["date", "topic"],
      },
    },
    sourceUrl: { type: ["string", "null"] },
    raw: { type: ["string", "null"] },
  },
  required: [
    "courseName",
    "courseCode",
    "term",
    "instructor",
    "officeHours",
    "grading",
    "attendance",
    "textbooks",
    "schedule",
    "sourceUrl",
    "raw",
  ],
} as const;

export type ExtractionSource =
  | { kind: "image"; url: string; mimeType: string }
  | { kind: "pdf_text"; text: string }
  | { kind: "url"; url: string; html: string }
  | { kind: "raw_text"; text: string };

export async function extractSyllabus(args: {
  userId: string;
  source: ExtractionSource;
}): Promise<Syllabus> {
  // C6 resolution: metered features pause on credit exhaustion. Throws
  // BillingQuotaExceededError the route handler already knows how to render.
  await assertCreditsAvailable(args.userId);

  const model = selectModel("syllabus_extract");
  const userContent = buildUserContent(args.source);

  const resp = await openai().chat.completions.create({
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "syllabus",
        strict: true,
        schema: SYLLABUS_JSON_SCHEMA,
      },
    },
  });

  await recordUsage({
    userId: args.userId,
    model,
    taskType: "syllabus_extract",
    inputTokens: resp.usage?.prompt_tokens ?? 0,
    outputTokens: resp.usage?.completion_tokens ?? 0,
    cachedTokens:
      (resp.usage as { prompt_tokens_details?: { cached_tokens?: number } })
        ?.prompt_tokens_details?.cached_tokens ?? 0,
  });

  const raw = resp.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw);
  return syllabusSchema.parse(parsed);
}

function buildUserContent(
  source: ExtractionSource
): Array<
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
> {
  switch (source.kind) {
    case "image":
      return [
        { type: "text", text: "Extract the syllabus data from this image." },
        { type: "image_url", image_url: { url: source.url } },
      ];
    case "pdf_text":
      return [
        {
          type: "text",
          text: `Extract the syllabus data from the following text:\n\n${source.text.slice(
            0,
            60_000
          )}`,
        },
      ];
    case "url":
      return [
        {
          type: "text",
          text: `Extract the syllabus data from this web page (already fetched). Source URL: ${source.url}\n\nHTML:\n${cleanHtml(
            source.html
          ).slice(0, 60_000)}`,
        },
      ];
    case "raw_text":
      return [{ type: "text", text: source.text.slice(0, 60_000) }];
  }
}

export function cleanHtml(html: string): string {
  try {
    const $ = loadHtml(html);
    $("script, style, noscript").remove();
    return $("body").text().replace(/\s+/g, " ").trim();
  } catch {
    return html.slice(0, 60_000);
  }
}

export type FetchedUrl =
  | { kind: "html"; contentType: string; html: string }
  | { kind: "pdf"; contentType: string; bytes: Buffer; filename: string }
  | { kind: "image"; contentType: string; bytes: Buffer; filename: string };

export function classifyFetchedContentType(
  contentType: string
): "html" | "pdf" | "image" | null {
  const ct = contentType.toLowerCase();
  if (
    ct.includes("text/html") ||
    ct.includes("text/plain") ||
    ct.includes("application/xhtml")
  ) {
    return "html";
  }
  if (ct.includes("application/pdf")) return "pdf";
  if (ct.startsWith("image/")) return "image";
  return null;
}

export function filenameFromUrl(rawUrl: string, fallbackExt: string): string {
  try {
    const u = new URL(rawUrl);
    const base = u.pathname.split("/").filter(Boolean).pop() ?? "";
    if (base && /\.[a-z0-9]+$/i.test(base)) return base;
    const host = u.hostname.replace(/[^a-z0-9-]/gi, "-");
    return `${host || "syllabus"}.${fallbackExt}`;
  } catch {
    return `syllabus.${fallbackExt}`;
  }
}

export class UnsupportedSyllabusUrlTypeError extends Error {
  code = "UNSUPPORTED_URL_CONTENT_TYPE" as const;
  constructor(contentType: string) {
    super(
      `We can only read HTML, PDF, or image URLs right now. This one reported "${
        contentType || "(no content-type header)"
      }".`
    );
  }
}

export async function fetchSyllabusUrl(url: string): Promise<FetchedUrl> {
  const res = await safeFetch(url, {
    headers: { "User-Agent": "Steadii Syllabus Fetcher" },
    timeoutMs: 15_000,
    maxBytes: 10 * 1024 * 1024,
  });
  if (!res.ok) throw new Error(`URL fetch failed (${res.status})`);
  const contentType = res.contentType;
  const kind = classifyFetchedContentType(contentType);
  if (kind === "html") {
    return { kind: "html", contentType, html: res.bytes.toString("utf8") };
  }
  if (kind === "pdf") {
    return {
      kind: "pdf",
      contentType,
      bytes: res.bytes,
      filename: filenameFromUrl(url, "pdf"),
    };
  }
  if (kind === "image") {
    const ext = contentType.split("/")[1]?.split(";")[0]?.trim() || "png";
    return {
      kind: "image",
      contentType,
      bytes: res.bytes,
      filename: filenameFromUrl(url, ext),
    };
  }
  throw new UnsupportedSyllabusUrlTypeError(contentType);
}

// re-export for routing
export { routeSyllabusInput, type SyllabusInput };

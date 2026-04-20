import "server-only";
import { openai } from "@/lib/integrations/openai/client";
import { syllabusSchema, type Syllabus } from "./schema";
import { selectModel } from "@/lib/agent/models";
import { recordUsage } from "@/lib/agent/usage";
import { routeSyllabusInput, type SyllabusInput } from "./router";
import { load as loadHtml } from "cheerio";

const SYSTEM_PROMPT = `You extract structured syllabus data from a raw document.
Return strictly the fields in the provided JSON schema. Use null for any field
you can't find. Schedule entries should be chronological and terse.
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

export async function fetchSyllabusUrl(url: string): Promise<{ html: string }> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Steadii Syllabus Fetcher" },
  });
  if (!res.ok) throw new Error(`URL fetch failed (${res.status})`);
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
    throw new Error(`unsupported content-type: ${contentType}`);
  }
  const html = await res.text();
  return { html };
}

// re-export for routing
export { routeSyllabusInput, type SyllabusInput };

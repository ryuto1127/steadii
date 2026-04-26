import "server-only";
import { openai } from "@/lib/integrations/openai/client";
import { selectModel } from "@/lib/agent/models";
import { recordUsage } from "@/lib/agent/usage";
import { assertCreditsAvailable } from "@/lib/billing/credits";

// Verbatim transcription is canonical Steadii DNA (project_decisions.md):
// the OCR layer must NEVER summarize or interpret. Math is preserved as
// LaTeX so downstream chunking + KaTeX rendering both work; diagrams
// degrade to text descriptions because vision can't reliably reproduce
// them and a faithful textual sketch is more useful than a hallucinated
// re-drawing.
export const NOTES_OCR_SYSTEM_PROMPT = `You are an OCR transcriber for handwritten or scanned student notes.
Transcribe the visible content into clean markdown. Strict rules:

1. VERBATIM ONLY. Do not summarize, do not interpret, do not "fix" the
   student's work. Reproduce what is actually on the page, including any
   mistakes, crossings-out (note them in italics), and marginalia.
2. Math expressions: use LaTeX. Inline math = \`$...$\`, block math = \`$$...$$\`.
   Preserve the student's notation exactly even if non-standard.
3. Diagrams, sketches, tables drawn by hand: describe in a fenced code block
   labelled \`text\`, as concisely and structurally as possible. Do not
   invent details that aren't visibly present.
4. Multiple pages: separate with \`## Page N\` headings (1-indexed).
5. If a region is illegible, write \`[illegible]\` rather than guessing.
6. Output markdown only — no preamble, no explanation of what you did.`;

export type NotesExtractionSource =
  | { kind: "image"; url: string; mimeType: string }
  | { kind: "image_data_url"; dataUrl: string; mimeType: string };

export type NotesExtractionResult = {
  markdown: string;
  pagesProcessed: number;
};

export async function extractHandwrittenNote(args: {
  userId: string;
  source: NotesExtractionSource;
}): Promise<NotesExtractionResult> {
  await assertCreditsAvailable(args.userId);

  const model = selectModel("notes_extract");
  const userContent = buildNotesUserContent(args.source);

  const resp = await openai().chat.completions.create({
    model,
    messages: [
      { role: "system", content: NOTES_OCR_SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
  });

  await recordUsage({
    userId: args.userId,
    model,
    taskType: "notes_extract",
    inputTokens: resp.usage?.prompt_tokens ?? 0,
    outputTokens: resp.usage?.completion_tokens ?? 0,
    cachedTokens:
      (resp.usage as { prompt_tokens_details?: { cached_tokens?: number } })
        ?.prompt_tokens_details?.cached_tokens ?? 0,
  });

  const markdown = (resp.choices[0]?.message?.content ?? "").trim();
  return {
    markdown,
    pagesProcessed: countPagesInMarkdown(markdown),
  };
}

export function buildNotesUserContent(
  source: NotesExtractionSource
): Array<
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
> {
  const text =
    "Transcribe the handwritten / scanned content shown below into clean markdown.";
  if (source.kind === "image") {
    return [
      { type: "text", text },
      { type: "image_url", image_url: { url: source.url } },
    ];
  }
  return [
    { type: "text", text },
    { type: "image_url", image_url: { url: source.dataUrl } },
  ];
}

// Count `## Page N` headings as a best-effort signal for cost reporting.
// Single-image inputs without a Page heading count as one page.
export function countPagesInMarkdown(markdown: string): number {
  if (!markdown) return 0;
  const matches = markdown.match(/^##\s+Page\s+\d+/gim);
  if (matches && matches.length > 0) return matches.length;
  return 1;
}

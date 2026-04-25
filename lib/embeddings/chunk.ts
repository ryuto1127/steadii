import "server-only";

// Splits long-form text (mistake notes, syllabi) into chunks suitable for
// 1536-dim text-embedding-3-small. We cap by character count rather than
// token count because (a) the chunks are advisory retrieval input, not
// model-ceiling-bound, and (b) avoiding the tiktoken dep keeps the
// dependency surface flat. ~2000 characters ≈ ~500 tokens — well under
// the 8192-token embed window with headroom for non-ASCII.
const TARGET_CHARS = 2000;
const HARD_MAX_CHARS = 2400;

export type Chunk = { index: number; text: string };

// Chunk on paragraph boundaries first, then on sentence boundaries within
// runaway paragraphs. Verbatim preservation is core DNA: we DO NOT lowercase,
// trim aggressively, or normalize whitespace beyond the leading/trailing
// trim required to skip empty chunks.
export function chunkText(text: string): Chunk[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= HARD_MAX_CHARS) {
    return [{ index: 0, text: trimmed }];
  }

  const paragraphs = trimmed.split(/\n{2,}/);
  const chunks: string[] = [];
  let buf = "";

  const push = () => {
    const t = buf.trim();
    if (t) chunks.push(t);
    buf = "";
  };

  for (const para of paragraphs) {
    if (para.length > HARD_MAX_CHARS) {
      push();
      const sentences = para.split(/(?<=[.!?。！？])\s+/);
      for (const s of sentences) {
        if (s.length > HARD_MAX_CHARS) {
          for (let i = 0; i < s.length; i += TARGET_CHARS) {
            chunks.push(s.slice(i, i + TARGET_CHARS));
          }
        } else if (buf.length + s.length + 1 > TARGET_CHARS) {
          push();
          buf = s;
        } else {
          buf = buf ? `${buf} ${s}` : s;
        }
      }
      push();
      continue;
    }
    if (buf.length + para.length + 2 > TARGET_CHARS) {
      push();
    }
    buf = buf ? `${buf}\n\n${para}` : para;
  }
  push();

  return chunks.map((text, index) => ({ index, text }));
}

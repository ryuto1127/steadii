// Pure helpers for the voice cleanup user-context system message. Kept
// separate from `user-context.ts` so tests can exercise the formatter
// without dragging in the DB client (which reads env vars not present in
// the test environment).

export type VoiceUserContext = {
  classesBlock?: string;
  topicsBlock?: string;
};

export function formatClassesBlock(
  rows: Array<{ code: string | null; name: string; professor: string | null }>
): string | undefined {
  if (rows.length === 0) return undefined;
  const lines = rows.map((r) => {
    const code = r.code?.trim();
    const profPart = r.professor?.trim()
      ? ` (Prof. ${r.professor.trim()})`
      : "";
    if (code) return `- ${code} — ${r.name}${profPart}`;
    return `- ${r.name}${profPart}`;
  });
  return ["Classes:", ...lines].join("\n");
}

export function formatTopicsBlock(
  rows: Array<{ title: string | null }>
): string | undefined {
  const titles = rows
    .map((r) => r.title?.trim())
    .filter((t): t is string => !!t);
  if (titles.length === 0) return undefined;
  return `Recent chat topics: ${titles.join(", ")}`;
}

export function buildVoiceContextSystemMessage(
  ctx: VoiceUserContext
): string | null {
  const parts: string[] = [];
  if (ctx.classesBlock) parts.push(ctx.classesBlock);
  if (ctx.topicsBlock) parts.push(ctx.topicsBlock);
  if (parts.length === 0) return null;
  return `USER ACADEMIC CONTEXT (use to disambiguate proper nouns / topics):\n${parts.join("\n")}`;
}

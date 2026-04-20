export type UserContextPayload = {
  notion: {
    connected: boolean;
    parentPageId: string | null;
    classesDbId: string | null;
    mistakesDbId: string | null;
    assignmentsDbId: string | null;
    syllabiDbId: string | null;
  };
  registeredResources: Array<{
    kind: "page" | "database";
    notionId: string;
    title: string | null;
  }>;
};

export function serializeContextForPrompt(ctx: UserContextPayload): string {
  const lines: string[] = [];
  lines.push(`# User context (Steadii runtime state)`);
  lines.push(`Notion connected: ${ctx.notion.connected ? "yes" : "no"}`);
  if (ctx.notion.connected) {
    lines.push(`Steadii parent page: ${ctx.notion.parentPageId ?? "(not set up)"}`);
    lines.push(`Classes DB: ${ctx.notion.classesDbId ?? "(not set up)"}`);
    lines.push(`Mistake Notes DB: ${ctx.notion.mistakesDbId ?? "(not set up)"}`);
    lines.push(`Assignments DB: ${ctx.notion.assignmentsDbId ?? "(not set up)"}`);
    lines.push(`Syllabi DB: ${ctx.notion.syllabiDbId ?? "(not set up)"}`);
  }
  if (ctx.registeredResources.length) {
    lines.push(`Registered resources:`);
    for (const r of ctx.registeredResources) {
      lines.push(`  - [${r.kind}] ${r.title ?? "(untitled)"} → ${r.notionId}`);
    }
  }
  return lines.join("\n");
}

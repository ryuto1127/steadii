// 2026-05-19 — Phase 3 handoff seeded-message builder. Extracted from
// app/api/chat/from-task/route.ts so unit tests can import the pure
// logic without pulling next-auth / next/server through the module
// graph (which fails at test time).

export function buildSeededMessage(args: {
  intent: string;
  title: string;
  preview: unknown; // TaskIntentPreview | null — duck-typed for backward compat
}): string {
  const hint = buildPreviewHint(args.intent, args.preview);
  if (hint) {
    return `${args.title}\n\n${hint}`;
  }
  return args.title;
}

export function buildPreviewHint(
  intent: string,
  preview: unknown,
): string | null {
  if (!preview || typeof preview !== "object") return null;
  const p = preview as Record<string, unknown>;
  if (
    intent === "DRAFT_EMAIL_REPLY" &&
    p.kind === "draft_email_reply" &&
    typeof p.inboxItemId === "string"
  ) {
    const subject =
      typeof p.subject === "string" && p.subject.length > 0
        ? p.subject
        : "(no subject)";
    const received =
      typeof p.receivedAt === "string" ? p.receivedAt : "";
    // Hint block format: a parenthetical addressed to the agent, not
    // the user. The user sees it in the chat scroll but it's clearly
    // marked as Steadii context. The agent reads it as discovery shortcut.
    return [
      "(Steadii からのヒント / Steadii hint:",
      `対象メール / target email: inbox_item.id = ${p.inboxItemId}`,
      received ? `受信日時 / received: ${received}` : null,
      `件名 / subject: 「${subject}」`,
      "このメールに対する返信を作成してください。lookup_entity / email_search の探索は skip して、email_get_body を inboxItemId で直接呼んでください。)",
    ]
      .filter((s): s is string => !!s)
      .join("\n");
  }
  return null;
}

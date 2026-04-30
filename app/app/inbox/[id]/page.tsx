import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import Link from "next/link";
import { ArrowLeft, Mail, Pause } from "lucide-react";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import { isNull, asc } from "drizzle-orm";
import {
  agentDrafts,
  agentRules,
  chats,
  classes,
  inboxItems,
  messages as messagesTable,
  users,
} from "@/lib/db/schema";
import { ThinkingBar } from "@/components/agent/thinking-bar";
import { ReasoningPanel } from "@/components/agent/reasoning-panel";
import { DraftActions } from "@/components/agent/draft-actions";
import { InlineRolePicker } from "@/components/agent/inline-role-picker";
import { ContextualSuggestion } from "@/components/suggestions/contextual-suggestion";
import { EmailBody } from "@/components/agent/email-body";
import { NextActionBanner } from "@/components/agent/next-action-banner";
import { ClarificationReply } from "@/components/agent/clarification-reply";
import { getMessageFull } from "@/lib/integrations/google/gmail-fetch";
import {
  extractEmailBody,
  linkifySegments,
  type LinkifiedSegment,
} from "@/lib/agent/email/body-extract";

export const dynamic = "force-dynamic";

function riskTone(tier: "low" | "medium" | "high" | null): string {
  switch (tier) {
    case "high":
      return "text-[hsl(var(--destructive))] bg-[hsl(var(--destructive)/0.08)]";
    case "medium":
      return "text-[hsl(38_92%_40%)] bg-[hsl(38_92%_50%/0.12)]";
    case "low":
      return "text-[hsl(var(--muted-foreground))] bg-[hsl(var(--surface-raised))]";
    default:
      return "text-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.08)]";
  }
}

function riskLabel(tier: "low" | "medium" | "high" | null): string {
  if (tier === "high") return "High";
  if (tier === "medium") return "Medium";
  if (tier === "low") return "Low";
  return "Classifying";
}

// actionLabel was removed in polish-6. The same per-action signal is
// now carried by `NextActionBanner` (which combines title + body + icon
// per action) — keeping a separate redundant line just added density.

export default async function InboxItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: draftId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;

  const [row] = await db
    .select({
      draft: agentDrafts,
      inbox: inboxItems,
    })
    .from(agentDrafts)
    .innerJoin(inboxItems, eq(agentDrafts.inboxItemId, inboxItems.id))
    .where(and(eq(agentDrafts.id, draftId), eq(agentDrafts.userId, userId)))
    .limit(1);
  if (!row) notFound();

  const [userRow] = await db
    .select({ undoWindowSeconds: users.undoWindowSeconds })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const undoWindowSeconds = userRow?.undoWindowSeconds ?? 10;

  // Check if we should show the inline role picker (first-time sender
  // AND no rule yet AND inbox row hasn't already been classified). Once
  // a senderRole exists on the row OR an agent_rules entry covers the
  // sender's email, the picker stays hidden so the user isn't re-asked.
  let needsRolePick = false;
  if (row.inbox.firstTimeSender && !row.inbox.senderRole) {
    const existingRule = await db
      .select({ id: agentRules.id })
      .from(agentRules)
      .where(
        and(
          eq(agentRules.userId, userId),
          eq(agentRules.scope, "sender"),
          eq(
            agentRules.matchNormalized,
            row.inbox.senderEmail.toLowerCase()
          )
        )
      )
      .limit(1);
    needsRolePick = existingRule.length === 0;
  }

  // Class options for the inline picker's dropdown. Same shape the
  // syllabus auto-import uses — code + name when available.
  const classRows = needsRolePick
    ? await db
        .select({ id: classes.id, name: classes.name, code: classes.code })
        .from(classes)
        .where(and(eq(classes.userId, userId), isNull(classes.deletedAt)))
        .orderBy(asc(classes.name))
    : [];

  const { draft, inbox } = row;
  const paused = draft.status === "paused";
  const sent = draft.status === "sent";

  // polish-7 — Gmail-style "read" tracking. The detail page open is the
  // signal; we mirror it onto inbox_items.reviewed_at so the inbox list
  // can demote the row from unread (bold) to read (muted). Idempotent
  // — subsequent opens skip the write. We don't await this in a way
  // that blocks render: the user shouldn't wait on a UI metadata write.
  if (!inbox.reviewedAt) {
    const now = new Date();
    await db
      .update(inboxItems)
      .set({ reviewedAt: now, updatedAt: now })
      .where(eq(inboxItems.id, inbox.id));
    // Refresh the sidebar Inbox badge + the inbox list page. revalidatePath
    // can't be called directly from a server component's render path
    // (Next.js 15+ throws: cache invalidation is not allowed mid-render).
    // Defer to `after()` so the revalidation runs once the response is sent.
    after(() => {
      revalidatePath("/app", "layout");
      revalidatePath("/app/inbox");
    });
  }

  // Live-fetch the full Gmail body for the detail page. We don't store
  // bodies on `inbox_items` (only the snippet) — the L1/L2 pipeline
  // doesn't need the full text, and persisting it would balloon the
  // table. The detail page is the only surface that wants the verbatim
  // body, and one Gmail messages.get per page open is well within
  // quota at α scale. Errors fall back silently to the snippet.
  let bodySegments: LinkifiedSegment[] = [];
  try {
    if (inbox.sourceType === "gmail") {
      const msg = await getMessageFull(userId, inbox.externalId);
      const extracted = extractEmailBody(msg);
      bodySegments = linkifySegments(extracted.text);
    }
  } catch {
    // Network / scope / permissions error — render the snippet via
    // EmailBody's `fallbackSnippet` path. We don't surface the error
    // because the page is still useful with snippet alone.
  }

  // Inline reply server action — used by ClarificationReply when the
  // agent's proposed action is `ask_clarifying`. Creates a new chat
  // seeded with the email context + the user's clarification, then
  // redirects to /app/chat/[id]?stream=1 so Steadii picks up the
  // response and drafts the reply with the new info.
  async function submitClarificationAction(formData: FormData): Promise<void> {
    "use server";
    const session = await auth();
    if (!session?.user?.id) redirect("/login");
    const ctx = String(formData.get("context") ?? "").trim();
    if (!ctx) redirect(`/app/inbox/${draft.id}`);

    const seed = [
      `I'm replying to an email from ${
        inbox.senderName ?? inbox.senderEmail
      } about "${inbox.subject ?? "(no subject)"}".`,
      "",
      "Steadii's clarifying question:",
      draft.reasoning?.trim() ?? "(no reasoning recorded)",
      "",
      "My answer / context:",
      ctx,
      "",
      "Please draft the reply now.",
    ].join("\n");

    const [chatRow] = await db
      .insert(chats)
      .values({ userId: session.user.id })
      .returning({ id: chats.id });
    await db.insert(messagesTable).values({
      chatId: chatRow.id,
      role: "user",
      content: seed,
    });
    redirect(`/app/chat/${chatRow.id}?stream=1`);
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 py-2">
      <div>
        <Link
          href="/app/inbox"
          className="inline-flex h-8 items-center gap-1 text-small text-[hsl(var(--muted-foreground))] transition-hover hover:text-[hsl(var(--foreground))]"
        >
          <ArrowLeft size={14} strokeWidth={1.75} />
          Inbox
        </Link>
      </div>

      {needsRolePick ? (
        <InlineRolePicker
          inboxItemId={inbox.id}
          senderEmail={inbox.senderEmail}
          senderName={inbox.senderName}
          classes={classRows}
        />
      ) : null}

      <header className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${riskTone(
              draft.riskTier
            )}`}
          >
            {riskLabel(draft.riskTier)}
          </span>
          {inbox.firstTimeSender ? (
            <span className="text-[11px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
              New sender
            </span>
          ) : null}
          <span className="ml-auto text-[12px] tabular-nums text-[hsl(var(--muted-foreground))]">
            {formatReceivedAt(inbox.receivedAt)}
          </span>
        </div>
        <h1 className="mt-2 text-h2 text-[hsl(var(--foreground))] break-words">
          {inbox.subject ?? "(no subject)"}
        </h1>
        <div className="mt-1 flex items-start gap-2 text-small text-[hsl(var(--muted-foreground))]">
          <Mail size={14} strokeWidth={1.75} className="mt-0.5 shrink-0" />
          <span className="min-w-0 break-words">
            <span className="text-[hsl(var(--foreground))]">
              {inbox.senderName ?? inbox.senderEmail}
            </span>{" "}
            <span className="break-all">&lt;{inbox.senderEmail}&gt;</span>
          </span>
        </div>
        <div className="mt-3">
          <EmailBody
            segments={bodySegments}
            fallbackSnippet={inbox.snippet ?? null}
          />
        </div>
      </header>

      <ThinkingBar
        provenance={draft.retrievalProvenance}
        riskTier={draft.riskTier}
      />

      <ContextualSuggestion
        userId={userId}
        source="microsoft"
        surface="trigger_inbox_outlook"
        revalidatePath={`/app/inbox/${draft.id}`}
        variant="pill"
      />

      {paused ? (
        <div className="flex items-start gap-3 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] p-4 text-small">
          <Pause size={16} strokeWidth={1.75} className="mt-0.5 shrink-0 text-[hsl(var(--muted-foreground))]" />
          <div>
            <div className="font-medium text-[hsl(var(--foreground))]">
              Draft generation paused
            </div>
            <div className="mt-1 text-[hsl(var(--muted-foreground))]">
              You ran out of credits this cycle. Top up to resume draft
              generation — classification continues for free.
            </div>
            <Link
              href="/app/settings/billing"
              className="mt-2 inline-block text-[hsl(var(--primary))] hover:underline"
            >
              Manage billing →
            </Link>
          </div>
        </div>
      ) : sent ? null : (
        <NextActionBanner action={draft.action} />
      )}

      <ReasoningPanel reasoning={draft.reasoning} action={draft.action} />

      {draft.action === "ask_clarifying" && !paused ? (
        <ClarificationReply
          emailSubject={inbox.subject ?? "(no subject)"}
          emailSender={inbox.senderName ?? inbox.senderEmail}
          agentQuestion={draft.reasoning ?? null}
          submitAction={submitClarificationAction}
        />
      ) : null}

      {draft.action === "draft_reply" && !paused ? (
        <DraftActions
          draftId={draft.id}
          status={draft.status}
          action={draft.action}
          initialSubject={draft.draftSubject ?? ""}
          initialBody={draft.draftBody ?? ""}
          initialTo={draft.draftTo}
          initialCc={draft.draftCc}
          undoWindowSeconds={undoWindowSeconds}
          sentAt={draft.sentAt ?? null}
          autoSent={draft.autoSent ?? false}
        />
      ) : (draft.action === "ask_clarifying" || draft.action === "notify_only") &&
        !paused ? (
        <DraftActions
          draftId={draft.id}
          status={draft.status}
          action={draft.action}
          initialSubject=""
          initialBody=""
          initialTo={[]}
          initialCc={[]}
          undoWindowSeconds={undoWindowSeconds}
          sentAt={draft.sentAt ?? null}
          autoSent={draft.autoSent ?? false}
        />
      ) : null}

    </div>
  );
}

function formatReceivedAt(d: Date): string {
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

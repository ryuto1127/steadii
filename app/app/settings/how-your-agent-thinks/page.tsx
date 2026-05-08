import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  agentDrafts,
  agentRules,
  inboxItems,
  type RetrievalProvenance,
} from "@/lib/db/schema";
import { ThinkingBar } from "@/components/agent/thinking-bar";
import { ReasoningPanel } from "@/components/agent/reasoning-panel";
import { removeWritingStyleRuleAction } from "./actions";

// Phase 7 W1 — read-only retrospective view of the agent's last N
// decisions. Fulfils the Phase 6 W4 landing-page promise that the agent
// is glass-box "all the way down" — every classify + draft surface
// shows the fanout sources that grounded it.
//
// Intentionally read-only at v1: no edit affordances, no per-decision
// feedback. A future iteration can add "this binding was wrong → re-bind"
// and "this draft helped / hurt" buttons; for now the goal is observability.
const N_DECISIONS = 10;

export const dynamic = "force-dynamic";

export default async function HowYourAgentThinksPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;
  const t = await getTranslations("agent_thinks_page");
  const tInbox = await getTranslations("inbox_detail");

  const rows = await db
    .select({
      draftId: agentDrafts.id,
      createdAt: agentDrafts.createdAt,
      riskTier: agentDrafts.riskTier,
      action: agentDrafts.action,
      reasoning: agentDrafts.reasoning,
      retrievalProvenance: agentDrafts.retrievalProvenance,
      autoSent: agentDrafts.autoSent,
      status: agentDrafts.status,
      inboxItemId: agentDrafts.inboxItemId,
      subject: inboxItems.subject,
      senderEmail: inboxItems.senderEmail,
      senderName: inboxItems.senderName,
    })
    .from(agentDrafts)
    .innerJoin(inboxItems, eq(inboxItems.id, agentDrafts.inboxItemId))
    .where(eq(agentDrafts.userId, userId))
    .orderBy(desc(agentDrafts.createdAt))
    .limit(N_DECISIONS);

  // engineer-38 — writing-style rules. Read separately so the page
  // shows them even when the user has no recent decisions yet.
  const styleRules = await db
    .select({
      id: agentRules.id,
      reason: agentRules.reason,
      matchValue: agentRules.matchValue,
      createdAt: agentRules.createdAt,
    })
    .from(agentRules)
    .where(
      and(
        eq(agentRules.userId, userId),
        eq(agentRules.scope, "writing_style"),
        eq(agentRules.enabled, true),
        isNull(agentRules.deletedAt)
      )
    )
    .orderBy(asc(agentRules.createdAt));
  const tStyle = await getTranslations("agent_thinks_page.writing_style");

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-8">
      <div className="flex items-center gap-2 text-small text-[hsl(var(--muted-foreground))]">
        <Link
          href="/app/settings"
          className="inline-flex items-center gap-1 transition-hover hover:text-[hsl(var(--foreground))]"
        >
          <ChevronLeft size={14} strokeWidth={1.75} />
          {t("settings_back")}
        </Link>
      </div>
      <header>
        <h1 className="text-h2 font-semibold">{t("title")}</h1>
        <p className="mt-1 text-small text-[hsl(var(--muted-foreground))]">
          {t("description_prefix")} {N_DECISIONS} {t("description_suffix")}
        </p>
      </header>

      <section
        id="writing-style"
        className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4"
      >
        <h2 className="text-body font-medium">{tStyle("heading")}</h2>
        {styleRules.length === 0 ? (
          <p className="mt-2 text-small text-[hsl(var(--muted-foreground))]">
            {tStyle("empty")}
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {styleRules.map((r) => {
              const text =
                (r.reason ?? "").trim() || (r.matchValue ?? "").trim();
              return (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-3 text-small"
                >
                  <span className="min-w-0 flex-1">{text}</span>
                  <form action={removeWritingStyleRuleAction}>
                    <input type="hidden" name="id" value={r.id} />
                    <button
                      type="submit"
                      className="rounded border border-[hsl(var(--border))] px-3 py-1 text-[11px] transition-hover hover:bg-[hsl(var(--surface-raised))]"
                    >
                      {tStyle("remove")}
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-6 text-center text-small text-[hsl(var(--muted-foreground))]">
          {t("empty")}
        </div>
      ) : (
        <ul className="space-y-4">
          {rows.map((r) => {
            const provenance = r.retrievalProvenance as RetrievalProvenance | null;
            return (
              <li
                key={r.draftId}
                className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4"
              >
                <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                  <Link
                    href={`/app/inbox/${r.inboxItemId}`}
                    className="text-body font-medium text-[hsl(var(--foreground))] transition-hover hover:text-[hsl(var(--primary))]"
                  >
                    {r.subject ?? tInbox("no_subject")}
                  </Link>
                  <span className="text-[11px] text-[hsl(var(--muted-foreground))]">
                    {formatStamp(r.createdAt)}
                  </span>
                </div>
                <div className="mb-3 text-[12px] text-[hsl(var(--muted-foreground))]">
                  {t("from_label")} {r.senderName ?? r.senderEmail}
                  <span className="mx-1.5">·</span>
                  {r.action}
                  {r.autoSent ? (
                    <>
                      <span className="mx-1.5">·</span>
                      <span className="rounded bg-[hsl(var(--surface-raised))] px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
                        auto-sent
                      </span>
                    </>
                  ) : null}
                </div>
                <ThinkingBar
                  provenance={provenance}
                  riskTier={r.riskTier as "low" | "medium" | "high" | null}
                />
                {r.reasoning ? (
                  <div className="mt-3">
                    <ReasoningPanel reasoning={r.reasoning} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function formatStamp(d: Date): string {
  // Avoid Intl in the render tree — node/browser Intl divergence causes
  // hydration mismatches. Manual ISO chunking is fine here.
  const iso = d.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

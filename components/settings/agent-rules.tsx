import {
  Globe,
  Brain,
  MessageSquare,
  Settings2,
  Activity,
} from "lucide-react";
import { getTranslations } from "next-intl/server";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { agentRules, agentSenderFeedback } from "@/lib/db/schema";
import {
  AUTO_HIGH_KEYWORDS,
  AUTO_MEDIUM_KEYWORDS,
  AUTO_LOW_KEYWORDS,
  PROMO_DOMAIN_HINTS,
} from "@/lib/agent/email/rules-global";
import { clearSenderFeedbackAction } from "@/lib/agent/email/draft-actions";
import { DeleteRuleButton } from "./delete-rule-button";

// Memory: Settings → Agent Rules has 3 subsections (A / B / C). C is
// deferred post-α. We ship A (read-only globals), B (per-user learned
// + manual rules), and (polish-7) a fourth surface — recent feedback
// per sender — that exposes the L3 lite signal so users can see what
// the agent has learned and reset rows if needed.
export async function AgentRulesSection({ userId }: { userId: string }) {
  const t = await getTranslations("agent_rules_section");
  const userRules = await db
    .select()
    .from(agentRules)
    .where(
      and(eq(agentRules.userId, userId), isNull(agentRules.deletedAt))
    )
    .orderBy(agentRules.scope);

  // Aggregate feedback rows per sender within the same 30d window the L2
  // classifier reads. Group by (sender_email, proposed_action,
  // user_response) to mirror the prompt block's shape so the UI matches
  // what the model sees.
  const feedbackRows = await db
    .select({
      senderEmail: agentSenderFeedback.senderEmail,
      proposedAction: agentSenderFeedback.proposedAction,
      userResponse: agentSenderFeedback.userResponse,
      n: sql<number>`count(*)::int`,
      lastSeen: sql<Date>`max(${agentSenderFeedback.createdAt})`,
    })
    .from(agentSenderFeedback)
    .where(
      and(
        eq(agentSenderFeedback.userId, userId),
        gte(
          agentSenderFeedback.createdAt,
          sql`now() - interval '30 days'`
        )
      )
    )
    .groupBy(
      agentSenderFeedback.senderEmail,
      agentSenderFeedback.proposedAction,
      agentSenderFeedback.userResponse
    )
    .orderBy(desc(sql`max(${agentSenderFeedback.createdAt})`));

  type AggBucket = {
    senderEmail: string;
    rows: Array<{
      proposedAction: string;
      userResponse: string;
      n: number;
    }>;
    lastSeen: Date;
    total: number;
  };
  const grouped = new Map<string, AggBucket>();
  for (const r of feedbackRows) {
    const bucket = grouped.get(r.senderEmail) ?? {
      senderEmail: r.senderEmail,
      rows: [],
      lastSeen: r.lastSeen,
      total: 0,
    };
    bucket.rows.push({
      proposedAction: r.proposedAction,
      userResponse: r.userResponse,
      n: r.n,
    });
    bucket.total += r.n;
    if (r.lastSeen > bucket.lastSeen) bucket.lastSeen = r.lastSeen;
    grouped.set(r.senderEmail, bucket);
  }
  // Drizzle's `sql<Date>` template is a runtime lie — Postgres returns a
  // string for max(timestamp), not a JS Date. The `lastSeen > bucket.lastSeen`
  // comparison above already works lexicographically because both sides are
  // ISO strings, but `.getTime()` here would TypeError on a string. Coerce
  // through `new Date()` which accepts both string and Date inputs.
  const senderBuckets = Array.from(grouped.values()).sort(
    (a, b) =>
      new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime()
  );

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
          <Globe size={12} strokeWidth={1.75} />
          <span>{t("global_rules")}</span>
          <span className="text-[10px] font-normal normal-case tracking-normal">
            {t("global_rules_caption")}
          </span>
        </div>
        <div className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-3">
          <GlobalGroup
            label={t("global_high")}
            tone="high"
            entries={AUTO_HIGH_KEYWORDS.map((g) => ({
              id: g.ruleId,
              label: g.words.join(", "),
              why: g.why,
            }))}
          />
          <GlobalGroup
            label={t("global_medium")}
            tone="medium"
            entries={AUTO_MEDIUM_KEYWORDS.map((g) => ({
              id: g.ruleId,
              label: g.words.join(", "),
              why: g.why,
            }))}
          />
          <GlobalGroup
            label={t("global_low")}
            tone="low"
            entries={AUTO_LOW_KEYWORDS.map((g) => ({
              id: g.ruleId,
              label: g.words.join(", "),
              why: g.why,
            }))}
          />
          <GlobalGroup
            label={t("global_ignore")}
            tone="ignore"
            entries={[
              {
                id: "PROMO_DOMAIN_HINTS",
                label: PROMO_DOMAIN_HINTS.join(", "),
                why: t("global_ignore_why"),
              },
            ]}
          />
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
          <Brain size={12} strokeWidth={1.75} />
          <span>{t("learned_contacts")}</span>
          <span className="text-[10px] font-normal normal-case tracking-normal">
            {t("learned_contacts_caption")}
          </span>
        </div>
        {userRules.length === 0 ? (
          <div className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-4 text-small text-[hsl(var(--muted-foreground))]">
            {t("learned_empty")}
          </div>
        ) : (
          <ul className="divide-y divide-[hsl(var(--border))] overflow-hidden rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))]">
            {userRules.map((r) => (
              <li
                key={r.id}
                className="flex items-center gap-3 px-3 py-2 text-small"
              >
                <SourceIcon
                  source={r.source}
                  titles={{
                    learned: t("source_learned_title"),
                    manual: t("source_manual_title"),
                    chat: t("source_chat_title"),
                  }}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-[hsl(var(--foreground))]">
                    {r.matchValue}
                  </div>
                  <div className="truncate text-[12px] text-[hsl(var(--muted-foreground))]">
                    {r.scope}
                    {r.senderRole ? ` · ${r.senderRole}` : ""}
                    {r.riskTier ? ` · ${r.riskTier} risk` : ""}
                    {r.reason ? ` · ${r.reason}` : ""}
                  </div>
                </div>
                <DeleteRuleButton ruleId={r.id} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
          <Activity size={12} strokeWidth={1.75} />
          <span>{t("recent_feedback")}</span>
          <span className="text-[10px] font-normal normal-case tracking-normal">
            {t("recent_feedback_caption")}
          </span>
        </div>
        {senderBuckets.length === 0 ? (
          <div className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-4 text-small text-[hsl(var(--muted-foreground))]">
            {t("feedback_empty")}
          </div>
        ) : (
          <ul className="divide-y divide-[hsl(var(--border))] overflow-hidden rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))]">
            {senderBuckets.map((b) => (
              <li
                key={b.senderEmail}
                className="flex items-start gap-3 px-3 py-2 text-small"
              >
                <Activity
                  size={14}
                  strokeWidth={1.75}
                  className="mt-1 shrink-0 text-[hsl(var(--muted-foreground))]"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-[hsl(var(--foreground))]">
                    {b.senderEmail}
                  </div>
                  <ul className="mt-0.5 flex flex-col gap-0.5 text-[12px] text-[hsl(var(--muted-foreground))]">
                    {b.rows.map((r, i) => (
                      <li key={i}>
                        <span className="font-mono">{r.n}×</span>{" "}
                        {t("feedback_proposed")}{" "}
                        <span className="font-mono">{r.proposedAction}</span>{" "}
                        →{" "}
                        <span className="font-mono">{r.userResponse}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <form action={clearSenderFeedbackAction}>
                  <input type="hidden" name="sender_email" value={b.senderEmail} />
                  <button
                    type="submit"
                    className="text-[12px] text-[hsl(var(--muted-foreground))] transition-hover hover:text-[hsl(var(--destructive))]"
                  >
                    {t("reset")}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
          <MessageSquare size={12} strokeWidth={1.75} />
          <span>{t("custom_overrides")}</span>
          <span className="text-[10px] font-normal normal-case tracking-normal">
            {t("custom_overrides_caption")}
          </span>
        </div>
        <div className="rounded-md border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-4 text-small text-[hsl(var(--muted-foreground))]">
          {t("custom_overrides_empty")}
        </div>
      </div>
    </div>
  );
}

function GlobalGroup({
  label,
  tone,
  entries,
}: {
  label: string;
  tone: "high" | "medium" | "low" | "ignore";
  entries: Array<{ id: string; label: string; why: string }>;
}) {
  const toneClass =
    tone === "high"
      ? "text-[hsl(var(--destructive))]"
      : tone === "medium"
      ? "text-[hsl(38_92%_40%)]"
      : tone === "low"
      ? "text-[hsl(var(--muted-foreground))]"
      : "text-[hsl(var(--muted-foreground))]";
  return (
    <div className="mb-3 last:mb-0">
      <div className={`text-[11px] font-semibold uppercase tracking-wider ${toneClass}`}>
        {label}
      </div>
      <ul className="mt-1 flex flex-col gap-1.5">
        {entries.map((e) => (
          <li
            key={e.id}
            title={e.why}
            className="text-small text-[hsl(var(--foreground))]"
          >
            <span className="font-mono text-[11px] text-[hsl(var(--muted-foreground))]">
              {e.id}
            </span>
            <span className="ml-2">{e.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SourceIcon({
  source,
  titles,
}: {
  // engineer-38 added "edit_delta_learner". Render it with the same
  // brain icon as `learned` (it IS a learner, just edit-delta-driven)
  // until/unless we want a distinct icon for it.
  source: "learned" | "manual" | "chat" | "edit_delta_learner";
  titles: { learned: string; manual: string; chat: string };
}) {
  switch (source) {
    case "learned":
    case "edit_delta_learner":
      return (
        <span
          title={titles.learned}
          className="text-[hsl(var(--muted-foreground))]"
        >
          <Brain size={14} strokeWidth={1.75} />
        </span>
      );
    case "manual":
      return (
        <span
          title={titles.manual}
          className="text-[hsl(var(--muted-foreground))]"
        >
          <Settings2 size={14} strokeWidth={1.75} />
        </span>
      );
    case "chat":
      return (
        <span
          title={titles.chat}
          className="text-[hsl(var(--muted-foreground))]"
        >
          <MessageSquare size={14} strokeWidth={1.75} />
        </span>
      );
  }
}

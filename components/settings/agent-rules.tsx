import { Globe, Brain, MessageSquare, Settings2 } from "lucide-react";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { agentRules } from "@/lib/db/schema";
import {
  AUTO_HIGH_KEYWORDS,
  AUTO_MEDIUM_KEYWORDS,
  AUTO_LOW_KEYWORDS,
  PROMO_DOMAIN_HINTS,
} from "@/lib/agent/email/rules-global";
import { DeleteRuleButton } from "./delete-rule-button";

// Memory: Settings → Agent Rules has 3 subsections (A / B / C). C is
// deferred post-α. We ship A (read-only globals) and B (per-user learned
// + manual rules) here.
export async function AgentRulesSection({ userId }: { userId: string }) {
  const userRules = await db
    .select()
    .from(agentRules)
    .where(
      and(eq(agentRules.userId, userId), isNull(agentRules.deletedAt))
    )
    .orderBy(agentRules.scope);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
          <Globe size={12} strokeWidth={1.75} />
          <span>Global rules</span>
          <span className="text-[10px] font-normal normal-case tracking-normal">
            — operator-maintained, read-only
          </span>
        </div>
        <div className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-3">
          <GlobalGroup
            label="AUTO-HIGH keywords"
            tone="high"
            entries={AUTO_HIGH_KEYWORDS.map((g) => ({
              id: g.ruleId,
              label: g.words.join(", "),
              why: g.why,
            }))}
          />
          <GlobalGroup
            label="AUTO-MEDIUM keywords"
            tone="medium"
            entries={AUTO_MEDIUM_KEYWORDS.map((g) => ({
              id: g.ruleId,
              label: g.words.join(", "),
              why: g.why,
            }))}
          />
          <GlobalGroup
            label="AUTO-LOW keywords"
            tone="low"
            entries={AUTO_LOW_KEYWORDS.map((g) => ({
              id: g.ruleId,
              label: g.words.join(", "),
              why: g.why,
            }))}
          />
          <GlobalGroup
            label="IGNORE — promo sender hints"
            tone="ignore"
            entries={[
              {
                id: "PROMO_DOMAIN_HINTS",
                label: PROMO_DOMAIN_HINTS.join(", "),
                why: "List-Unsubscribe header + promo-domain substring = ignore bucket.",
              },
            ]}
          />
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
          <Brain size={12} strokeWidth={1.75} />
          <span>Learned contacts</span>
          <span className="text-[10px] font-normal normal-case tracking-normal">
            — grows from the role picker + future chat feedback
          </span>
        </div>
        {userRules.length === 0 ? (
          <div className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-4 text-small text-[hsl(var(--muted-foreground))]">
            No learned rules yet. The agent will add rows here as you
            confirm first-time senders and correct its triage.
          </div>
        ) : (
          <ul className="divide-y divide-[hsl(var(--border))] overflow-hidden rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))]">
            {userRules.map((r) => (
              <li
                key={r.id}
                className="flex items-center gap-3 px-3 py-2 text-small"
              >
                <SourceIcon source={r.source} />
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
          <MessageSquare size={12} strokeWidth={1.75} />
          <span>Custom overrides</span>
          <span className="text-[10px] font-normal normal-case tracking-normal">
            — coming after α
          </span>
        </div>
        <div className="rounded-md border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-4 text-small text-[hsl(var(--muted-foreground))]">
          Natural-language rules ("Only ask me for explicit confirm on
          professor emails about grading") land in a later update — they
          route through the agent and save as a structured rule here.
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

function SourceIcon({ source }: { source: "learned" | "manual" | "chat" }) {
  switch (source) {
    case "learned":
      return (
        <span
          title="Learned from prior interactions"
          className="text-[hsl(var(--muted-foreground))]"
        >
          <Brain size={14} strokeWidth={1.75} />
        </span>
      );
    case "manual":
      return (
        <span
          title="Manually set via role picker"
          className="text-[hsl(var(--muted-foreground))]"
        >
          <Settings2 size={14} strokeWidth={1.75} />
        </span>
      );
    case "chat":
      return (
        <span
          title="Set via chat"
          className="text-[hsl(var(--muted-foreground))]"
        >
          <MessageSquare size={14} strokeWidth={1.75} />
        </span>
      );
  }
}

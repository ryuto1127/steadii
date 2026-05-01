"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import type { ActionOption } from "@/lib/db/schema";

// Shared button row for proposed actions. Used by:
// - Inbox proposal detail page (PR 3)
// - Chat agent responses (PR 4) — the chat surfaces the same shape
//   so the click handler funnels through the same resolve endpoint.
export function ProposedActions({
  proposalId,
  options,
  disabled,
}: {
  proposalId: string;
  options: ActionOption[];
  disabled?: boolean;
}) {
  const router = useRouter();
  const t = useTranslations("agent.proposed_actions");
  const [pending, startTransition] = useTransition();
  const [activeKey, setActiveKey] = useState<string | null>(null);

  function pickAction(option: ActionOption) {
    if (disabled || pending) return;
    setActiveKey(option.key);
    startTransition(async () => {
      try {
        const endpoint =
          option.tool === "dismiss"
            ? `/api/agent/proposal/${proposalId}/dismiss`
            : `/api/agent/proposal/${proposalId}/resolve`;
        const resp = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            actionKey: option.key,
          }),
        });
        if (!resp.ok) {
          const text = await resp.text();
          toast.error(t("toast_action_failed", { text }));
          return;
        }
        if (option.tool === "dismiss") {
          toast.success(t("toast_dismissed"));
        } else if (option.tool === "chat_followup") {
          // The resolve endpoint returns a chat URL when the action
          // creates a chat seeded with the issue context. Navigate.
          const data = await resp.json();
          if (data.redirectTo) {
            router.push(data.redirectTo);
            return;
          }
        } else {
          toast.success(t("toast_done", { label: option.label }));
        }
        router.refresh();
      } finally {
        setActiveKey(null);
      }
    });
  }

  if (options.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const isActive = activeKey === opt.key && pending;
        const isDestructive =
          opt.tool === "delete_event" || opt.tool === "dismiss";
        const baseClass =
          "inline-flex items-center gap-2 rounded-md border px-3 py-2 text-[13px] font-medium transition-hover";
        const tone = isDestructive
          ? "border-[hsl(var(--border))] bg-transparent text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--surface-raised))]"
          : "border-[hsl(var(--primary)/0.4)] bg-[hsl(var(--primary)/0.06)] text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary)/0.12)]";
        return (
          <button
            key={opt.key}
            type="button"
            disabled={disabled || pending}
            onClick={() => pickAction(opt)}
            className={`${baseClass} ${tone} ${
              disabled || pending ? "opacity-60" : ""
            }`}
            title={opt.description}
          >
            <span>{isActive ? "…" : opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

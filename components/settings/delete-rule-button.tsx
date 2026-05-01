"use client";

import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { deleteAgentRuleAction } from "@/lib/agent/email/draft-actions";

export function DeleteRuleButton({ ruleId }: { ruleId: string }) {
  const router = useRouter();
  const t = useTranslations("delete_rule_button");
  const [isPending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          try {
            await deleteAgentRuleAction(ruleId);
            toast.success(t("toast_removed"));
            router.refresh();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : t("toast_failed"));
          }
        })
      }
      className="flex h-9 w-9 items-center justify-center rounded-md text-[hsl(var(--muted-foreground))] transition-hover hover:bg-[hsl(var(--surface-raised))] hover:text-[hsl(var(--destructive))] disabled:opacity-50"
      aria-label={t("aria")}
    >
      <Trash2 size={14} strokeWidth={1.75} />
    </button>
  );
}

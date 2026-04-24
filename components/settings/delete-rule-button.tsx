"use client";

import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { deleteAgentRuleAction } from "@/lib/agent/email/draft-actions";

export function DeleteRuleButton({ ruleId }: { ruleId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          try {
            await deleteAgentRuleAction(ruleId);
            toast.success("Rule removed");
            router.refresh();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Delete failed");
          }
        })
      }
      className="rounded-md p-1 text-[hsl(var(--muted-foreground))] transition-hover hover:bg-[hsl(var(--surface-raised))] hover:text-[hsl(var(--destructive))] disabled:opacity-50"
      aria-label="Remove rule"
    >
      <Trash2 size={14} strokeWidth={1.75} />
    </button>
  );
}

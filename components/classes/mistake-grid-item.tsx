"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { NotebookPen } from "lucide-react";
import { KebabMenu } from "@/components/ui/kebab-menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export function MistakeGridItem({
  id,
  title,
  unit,
  difficulty,
  createdAt,
}: {
  id: string;
  title: string;
  unit: string | null;
  difficulty: "easy" | "medium" | "hard" | null;
  createdAt: Date;
}) {
  const tActions = useTranslations("classes.actions");
  const tGrid = useTranslations("classes.mistakes_grid");
  const router = useRouter();

  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    try {
      const res = await fetch(`/api/mistakes/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      toast.success(tGrid("deleted_toast"));
      setConfirming(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tGrid("delete_failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="group relative flex flex-col gap-2 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4 transition-hover hover:bg-[hsl(var(--surface-raised))]">
      <Link
        href={`/app/mistakes/${id}`}
        className="flex flex-1 flex-col gap-2"
      >
        <div className="flex items-start gap-2">
          <NotebookPen
            size={14}
            strokeWidth={1.5}
            className="mt-0.5 shrink-0 text-[hsl(var(--muted-foreground))]"
          />
          <span className="line-clamp-2 text-body font-medium">{title}</span>
        </div>
        <div className="flex flex-wrap gap-1 text-small text-[hsl(var(--muted-foreground))]">
          {[difficulty, unit, createdAt.toISOString().slice(0, 10)]
            .filter(Boolean)
            .map((s, i) => (
              <span key={i}>{s}</span>
            ))}
        </div>
      </Link>
      <div className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <KebabMenu
          ariaLabel={tActions("menu_label")}
          items={[
            {
              label: tActions("delete"),
              destructive: true,
              onSelect: () => setConfirming(true),
            },
          ]}
        />
      </div>
      <ConfirmDialog
        open={confirming}
        title={tGrid("delete_confirm_title")}
        body={tGrid("delete_confirm_body")}
        confirmLabel={tActions("delete")}
        cancelLabel={tActions("cancel")}
        busy={busy}
        onCancel={() => setConfirming(false)}
        onConfirm={remove}
      />
    </div>
  );
}

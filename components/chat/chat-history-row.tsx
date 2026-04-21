"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { deleteChatFromListAction } from "@/lib/agent/chat-actions";
import { cn } from "@/lib/utils/cn";

export function ChatHistoryRow({
  id,
  title,
  updatedAt,
}: {
  id: string;
  title: string;
  updatedAt: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [removed, setRemoved] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
  }, []);

  if (removed) return null;

  const handleDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirming) {
      setConfirming(true);
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setConfirming(false), 3000);
      return;
    }
    if (resetTimer.current) clearTimeout(resetTimer.current);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", id);
      await deleteChatFromListAction(fd);
      setRemoved(true);
    });
  };

  return (
    <div
      data-dense-row
      className={cn(
        "group/row flex items-center gap-1 rounded-md border border-transparent pr-1 transition-hover",
        "hover:border-[hsl(var(--border))] hover:bg-[hsl(var(--surface-raised))]",
        "focus-within:border-[hsl(var(--border))] focus-within:bg-[hsl(var(--surface-raised))]",
        isPending && "pointer-events-none opacity-50"
      )}
    >
      <Link
        href={`/app/chat/${id}`}
        tabIndex={0}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-md px-3 py-2.5 focus:outline-none"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="truncate text-body text-[hsl(var(--foreground))]">{title}</span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-small text-[hsl(var(--muted-foreground))]">
            <span className="tabular-nums">{updatedAt}</span>
          </div>
        </div>
      </Link>
      <button
        type="button"
        onClick={handleDelete}
        disabled={isPending}
        aria-label={confirming ? `Confirm delete "${title}"` : `Delete chat "${title}"`}
        className={cn(
          "flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md px-2 text-[hsl(var(--muted-foreground))]",
          "transition-hover focus-visible:opacity-100",
          confirming
            ? "bg-[hsl(var(--destructive)/0.12)] text-[hsl(var(--destructive))] opacity-100"
            : "w-8 px-0 opacity-0 hover:bg-[hsl(var(--surface))] hover:text-[hsl(var(--foreground))] group-hover/row:opacity-100"
        )}
      >
        <Trash2 size={14} strokeWidth={1.5} />
        {confirming && <span className="text-small">Confirm</span>}
      </button>
    </div>
  );
}

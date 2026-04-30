"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { setSenderRoleAction } from "@/lib/agent/email/draft-actions";
import type { SenderRole } from "@/lib/db/schema";
import { cn } from "@/lib/utils/cn";

// 7-category taxonomy (broadened 2026-04-29). Order matches the row in
// the inline section: academic-roles first, then career, then personal,
// then catch-all. Each entry's hint is a short subtitle the user sees
// inline; the value is what gets persisted to inbox_items.sender_role.
type RoleOption = {
  value: SenderRole;
  label: string;
  hint: string;
};

const ROLE_OPTIONS: RoleOption[] = [
  { value: "professor", label: "Professor", hint: "Course instructor" },
  { value: "ta", label: "TA", hint: "Teaching assistant / tutor" },
  { value: "classmate", label: "Classmate", hint: "Fellow student" },
  { value: "admin", label: "Admin", hint: "Registrar, advising, IT" },
  { value: "career", label: "Career", hint: "Recruiter, interviewer" },
  { value: "personal", label: "Personal", hint: "Family, friends, club" },
  { value: "other", label: "Other", hint: "Skip-able catch-all" },
];

type ClassOption = { id: string; name: string; code: string | null };

export function InlineRolePicker({
  inboxItemId,
  senderEmail,
  senderName,
  classes,
}: {
  inboxItemId: string;
  senderEmail: string;
  senderName: string | null;
  classes: ClassOption[];
}) {
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [classId, setClassId] = useState<string>("");
  const [newClassName, setNewClassName] = useState("");
  const [showNewClassInput, setShowNewClassInput] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (collapsed) return null;

  const commit = (role: SenderRole) => {
    startTransition(async () => {
      try {
        await setSenderRoleAction({
          senderEmail,
          role,
          inboxItemId,
          classId: classId || null,
          newClassName: showNewClassInput ? newClassName.trim() || null : null,
        });
        toast.success(`Saved: ${senderName ?? senderEmail} → ${role}`);
        setCollapsed(true);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    });
  };

  const skip = () => {
    // Skip persists nothing — the next email from this sender will surface
    // the picker again so the user can classify later. Verified the picker
    // doesn't double-fire mid-session by tracking `collapsed` locally.
    setCollapsed(true);
  };

  return (
    <section
      aria-label="Classify sender"
      className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-small font-medium text-[hsl(var(--foreground))]">
            New sender — help Steadii classify (optional)
          </h3>
          <p className="mt-0.5 truncate text-[12px] text-[hsl(var(--muted-foreground))]">
            <strong className="text-[hsl(var(--foreground))]">
              {senderName ?? senderEmail}
            </strong>
          </p>
        </div>
        <button
          type="button"
          onClick={skip}
          disabled={isPending}
          className="shrink-0 text-small text-[hsl(var(--muted-foreground))] transition-hover hover:text-[hsl(var(--foreground))] disabled:opacity-50"
        >
          Skip
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {ROLE_OPTIONS.map((r) => (
          <button
            key={r.value}
            type="button"
            disabled={isPending}
            onClick={() => commit(r.value)}
            title={r.hint}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-small font-medium transition-hover disabled:cursor-not-allowed disabled:opacity-50",
              "border-[hsl(var(--border)/0.6)] bg-transparent text-[hsl(var(--foreground))] hover:bg-[hsl(var(--surface-raised))]"
            )}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="text-[12px] text-[hsl(var(--muted-foreground))]">
          Class (optional):
        </label>
        {!showNewClassInput ? (
          <>
            <select
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
              disabled={isPending}
              className="h-8 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-2 text-small text-[hsl(var(--foreground))] focus:border-[hsl(var(--ring))] focus:outline-none disabled:opacity-50"
            >
              <option value="">— none —</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code ? `${c.code} · ${c.name}` : c.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => {
                setShowNewClassInput(true);
                setClassId("");
              }}
              disabled={isPending}
              className="text-[12px] text-[hsl(var(--primary))] transition-hover hover:underline disabled:opacity-50"
            >
              + Type new class name
            </button>
          </>
        ) : (
          <>
            <input
              type="text"
              value={newClassName}
              onChange={(e) => setNewClassName(e.target.value)}
              placeholder="e.g. MAT235"
              disabled={isPending}
              autoFocus
              className="h-8 w-44 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-2 text-small text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] focus:border-[hsl(var(--ring))] focus:outline-none disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => {
                setShowNewClassInput(false);
                setNewClassName("");
              }}
              disabled={isPending}
              className="text-[12px] text-[hsl(var(--muted-foreground))] transition-hover hover:text-[hsl(var(--foreground))] disabled:opacity-50"
            >
              Cancel
            </button>
          </>
        )}
      </div>
    </section>
  );
}

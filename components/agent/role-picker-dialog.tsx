"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { setSenderRoleAction } from "@/lib/agent/email/draft-actions";
import type { SenderRole } from "@/lib/db/schema";

// Order matters — most-common contact first. Supervisor maps to AUTO_HIGH
// in L1 rules (W2 addition). "Other" catches everything else without
// forcing a wrong label.
const ROLES: Array<{ value: SenderRole; label: string; hint: string }> = [
  { value: "professor", label: "Professor", hint: "Course instructor" },
  { value: "ta", label: "TA", hint: "Teaching assistant" },
  { value: "classmate", label: "Classmate", hint: "Fellow student" },
  { value: "admin", label: "Admin", hint: "Registrar, advising, facilities" },
  { value: "supervisor", label: "Supervisor", hint: "PI, lab director, mentor" },
  { value: "other", label: "Other", hint: "Keep open; reclassify later" },
];

export function RolePickerDialog({
  inboxItemId,
  senderEmail,
  senderName,
}: {
  inboxItemId: string;
  senderEmail: string;
  senderName: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const [isPending, startTransition] = useTransition();

  if (!open) return null;

  const pick = (role: SenderRole) => {
    startTransition(async () => {
      try {
        await setSenderRoleAction({
          senderEmail,
          role,
          inboxItemId,
        });
        toast.success(`Saved: ${senderName ?? senderEmail} → ${role}`);
        setOpen(false);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    });
  };

  return (
    <div
      aria-modal="true"
      role="dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="w-full max-w-md rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-5 shadow-xl">
        <h2 className="text-h3 text-[hsl(var(--foreground))]">Who is this sender?</h2>
        <p className="mt-1 text-small text-[hsl(var(--muted-foreground))]">
          First email from <strong className="text-[hsl(var(--foreground))]">{senderName ?? senderEmail}</strong>. Tell the agent who they are so it can triage future mail from this address correctly.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          {ROLES.map((r) => (
            <button
              key={r.value}
              type="button"
              disabled={isPending}
              onClick={() => pick(r.value)}
              className="flex flex-col items-start gap-0.5 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-2 text-left transition-hover hover:bg-[hsl(var(--surface-raised))] disabled:opacity-50"
            >
              <span className="text-small font-medium text-[hsl(var(--foreground))]">
                {r.label}
              </span>
              <span className="text-[11px] text-[hsl(var(--muted-foreground))]">
                {r.hint}
              </span>
            </button>
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-small text-[hsl(var(--muted-foreground))] transition-hover hover:text-[hsl(var(--foreground))]"
          >
            Decide later
          </button>
        </div>
      </div>
    </div>
  );
}

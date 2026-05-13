"use client";

import { useRef } from "react";
import { SubmitButton } from "@/components/ui/submit-button";

// engineer-49 — destructive Reset-all form. Wraps the server action
// with a confirm() dialog so a stray click can't wipe the learner.
// Client component because window.confirm() is browser-side.
export function ResetAllForm({
  action,
  buttonLabel,
  pendingLabel,
  confirmText,
}: {
  action: () => Promise<void>;
  buttonLabel: string;
  pendingLabel: string;
  confirmText: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={formRef}
      action={action}
      onSubmit={(e) => {
        if (!confirm(confirmText)) {
          e.preventDefault();
        }
      }}
    >
      <SubmitButton
        pendingLabel={pendingLabel}
        className="inline-flex h-9 items-center rounded-md border border-[hsl(var(--destructive)/0.4)] bg-[hsl(var(--surface))] px-3 text-small font-medium text-[hsl(var(--destructive))] transition-hover hover:bg-[hsl(var(--destructive)/0.06)]"
      >
        {buttonLabel}
      </SubmitButton>
    </form>
  );
}

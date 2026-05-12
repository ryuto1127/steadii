"use client";

import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

// 2026-05-12 — slow server-action buttons in /app/settings (regenerate
// drafts, reclassify inbox, refresh Gmail, regenerate voice profile,
// import Notion, refresh resources, add iCal subscription) take many
// seconds to complete. Without an in-flight indicator the user can't
// tell whether the click registered, and double-clicking re-fires the
// action. SubmitButton plugs into the enclosing <form action={...}>
// via React 19's useFormStatus() and renders a spinner + disables the
// button while the server action is in flight.

type SubmitButtonProps = {
  children: ReactNode;
  className?: string;
  title?: string;
  pendingLabel?: ReactNode;
};

export function SubmitButton({
  children,
  className,
  title,
  pendingLabel,
}: SubmitButtonProps) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending || undefined}
      title={title}
      className={cn(
        className,
        "disabled:cursor-not-allowed disabled:opacity-60"
      )}
    >
      <span className="inline-flex items-center gap-2">
        {pending && <Spinner />}
        <span>{pending && pendingLabel ? pendingLabel : children}</span>
      </span>
    </button>
  );
}

function Spinner() {
  return (
    <svg
      className="h-3.5 w-3.5 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
        className="opacity-25"
      />
      <path
        d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z"
        fill="currentColor"
        className="opacity-75"
      />
    </svg>
  );
}

"use client";

import { useTransition } from "react";
import { Sparkles } from "lucide-react";

// 2026-05-19 — Phase 3 of the proactive-task UX.
//
// Renders the smart-action button next to a task row when the classifier
// (lib/agent/intent-classifier.ts) returned a non-OTHER intent. Clicking
// the button POSTs to /api/chat/from-task which creates a chat + seeded
// message + redirects to /app/chat/<id>?stream=1 so the agent starts
// drafting / scheduling / studying immediately.
//
// Glass-box hover (the "why is this here?" tooltip) ships in Phase 3b.

export type TaskSmartActionProps = {
  source: "google_tasks" | "microsoft_todo" | "steadii";
  externalId: string;
  intent:
    | "DRAFT_EMAIL_REPLY"
    | "CALENDAR_EVENT"
    | "STUDY_SESSION"
    | "ASSIGNMENT_WORK";
  // Localized button label — passed in from the server component so
  // the client doesn't need next-intl wiring.
  label: string;
};

export function TaskSmartAction({
  source,
  externalId,
  intent,
  label,
}: TaskSmartActionProps) {
  const [pending, startTransition] = useTransition();

  return (
    <form
      action="/api/chat/from-task"
      method="POST"
      onSubmit={(e) => {
        // Browsers submit the form directly via the action URL —
        // we just optimistically grey out the button. The redirect
        // is handled server-side and React's startTransition keeps
        // the UI in a `pending` style until the navigation lands.
        startTransition(() => {});
        // Let the native form post proceed.
        void e;
      }}
      className="inline-block"
    >
      <input type="hidden" name="source" value={source} />
      <input type="hidden" name="externalId" value={externalId} />
      <input type="hidden" name="intent" value={intent} />
      <button
        type="submit"
        disabled={pending}
        title={label}
        className="inline-flex h-7 items-center gap-1 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-2 text-[11px] font-medium text-[hsl(var(--foreground))] transition-hover hover:border-[hsl(var(--ring))] hover:text-[hsl(var(--primary))] disabled:opacity-50"
      >
        <Sparkles size={12} strokeWidth={1.75} />
        {label}
      </button>
    </form>
  );
}

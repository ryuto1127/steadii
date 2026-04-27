"use client";

import { useTransition } from "react";
import { Send } from "lucide-react";

export function ClarificationReply({
  emailSubject,
  emailSender,
  agentQuestion,
  submitAction,
}: {
  emailSubject: string;
  emailSender: string;
  agentQuestion: string | null;
  // Server action — accepts FormData with `context` field, creates a
  // chat seeded with the email context + user's reply, redirects to
  // /app/chat/[id]. Defined inline in the page route.
  submitAction: (formData: FormData) => Promise<void>;
}) {
  const [isPending, startTransition] = useTransition();

  void emailSubject;
  void emailSender;
  void agentQuestion;

  return (
    <section className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4">
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
        Provide context
      </h2>
      <p className="mt-1.5 text-small text-[hsl(var(--muted-foreground))]">
        Steadii will pick this up in a chat thread, draft a reply with
        the new info, and bring it back to you.
      </p>

      <form
        action={(formData) =>
          startTransition(async () => {
            await submitAction(formData);
          })
        }
        className="mt-3 flex flex-col gap-2"
      >
        <textarea
          name="context"
          required
          rows={4}
          placeholder="e.g. The Legal Status form is here: https://… ; the deadline they meant is May 15."
          className="w-full resize-y rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-3 py-2 text-small text-[hsl(var(--foreground))] focus:border-[hsl(var(--primary))] focus:outline-none"
          disabled={isPending}
        />
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={isPending}
            className="inline-flex items-center gap-1.5 rounded-md bg-[hsl(var(--primary))] px-3 py-1.5 text-small font-medium text-[hsl(var(--primary-foreground))] transition-hover hover:opacity-90 disabled:opacity-50"
          >
            <Send size={14} strokeWidth={2} />
            {isPending ? "Sending…" : "Send to Steadii"}
          </button>
        </div>
      </form>
    </section>
  );
}

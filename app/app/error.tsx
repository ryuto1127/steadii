"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-2xl px-6 py-20">
      <p className="font-mono text-xs uppercase tracking-widest text-[hsl(var(--destructive))]">
        Something went wrong
      </p>
      <h1 className="mt-6 font-serif text-3xl">
        Steadii stumbled on this page.
      </h1>
      <p className="mt-4 text-sm text-[hsl(var(--muted-foreground))]">
        The error has been reported. If it keeps happening, mention this ID
        when you email us: <span className="font-mono">{error.digest ?? "n/a"}</span>.
      </p>
      <div className="mt-8 flex gap-3">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-lg bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))]"
        >
          Try again
        </button>
        <a
          href="/app/chat"
          className="rounded-lg border border-[hsl(var(--border))] px-4 py-2 text-sm"
        >
          Back to Chat
        </a>
      </div>
    </div>
  );
}

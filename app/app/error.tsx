"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { Button, LinkButton } from "@/components/ui/button";

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
    <div className="mx-auto max-w-2xl px-6 py-16">
      <p className="font-mono text-[11px] uppercase tracking-widest text-[hsl(var(--destructive))]">
        Something went wrong
      </p>
      <h1 className="mt-4 text-h1 text-[hsl(var(--foreground))]">
        Steadii stumbled on this page.
      </h1>
      <p className="mt-3 text-small text-[hsl(var(--muted-foreground))]">
        The error has been reported. If it keeps happening, mention this ID
        when you email us:{" "}
        <span className="font-mono">{error.digest ?? "n/a"}</span>.
      </p>
      <div className="mt-6 flex gap-2">
        <Button onClick={() => reset()}>Try again</Button>
        <LinkButton href="/app" variant="secondary">
          Back to Home
        </LinkButton>
      </div>
    </div>
  );
}

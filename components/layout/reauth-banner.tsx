"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const DISMISS_KEY = "steadii:reauth-banner:dismissed";

// Dismissible one-line banner nudging pre-Gmail users to sign out / in
// again. Client-only because the dismissal is stored in localStorage —
// α-scale concession per W1 handoff (no need for a server-side
// dismissal table).
export function ReauthBanner() {
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      setDismissed(false);
    }
  }, []);

  if (dismissed) return null;

  const onDismiss = () => {
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // localStorage unavailable — hide in-memory only.
    }
    setDismissed(true);
  };

  return (
    <div className="mx-auto mb-5 max-w-4xl rounded-lg bg-[hsl(var(--surface-raised))] px-4 py-2.5 text-small text-[hsl(var(--foreground))]">
      <div className="flex items-center justify-between gap-4">
        <span>
          Gmail triage is new. Sign out and back in to grant the Gmail scope —
          the agent can&apos;t read or draft until you do.
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <Link
            href="/api/auth/signout"
            className="rounded-md px-3 py-1 text-small transition-hover hover:bg-[hsl(var(--surface))]"
          >
            Reconnect
          </Link>
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-md px-2 py-1 text-small text-[hsl(var(--muted-foreground))] transition-hover hover:bg-[hsl(var(--surface))] hover:text-[hsl(var(--foreground))]"
            aria-label="Dismiss"
          >
            Dismiss
          </button>
        </span>
      </div>
    </div>
  );
}

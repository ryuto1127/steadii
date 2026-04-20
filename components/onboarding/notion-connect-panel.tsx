"use client";

import { useState } from "react";
import { cn } from "@/lib/utils/cn";

export function NotionConnectPanel({ connected }: { connected: boolean }) {
  const [ackd, setAckd] = useState(false);

  if (connected) {
    return (
      <p className="text-small text-[hsl(var(--muted-foreground))]">Connected.</p>
    );
  }

  if (!ackd) {
    return (
      <div className="space-y-3 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] p-4 text-left">
        <h3 className="text-h3 text-[hsl(var(--foreground))]">
          One thing to know first
        </h3>
        <p className="text-small text-[hsl(var(--muted-foreground))]">
          On Notion&apos;s permission screen, select{" "}
          <span className="font-semibold text-[hsl(var(--foreground))]">
            &ldquo;All pages&rdquo;
          </span>
          . Steadii creates its own workspace for you — you don&apos;t need to
          pre-create a page.
        </p>
        <ul className="ml-5 list-disc space-y-1 text-small text-[hsl(var(--muted-foreground))]">
          <li>Steadii only touches pages under the Steadii parent it creates.</li>
          <li>
            Picking a single page here is the main reason onboarding gets stuck.
          </li>
        </ul>
        <button
          type="button"
          onClick={() => setAckd(true)}
          className={cn(
            "inline-flex items-center rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-1.5 text-small font-medium text-[hsl(var(--foreground))] transition-hover hover:bg-[hsl(var(--surface-raised))]"
          )}
        >
          Got it — show me Connect
        </button>
      </div>
    );
  }

  return (
    <a
      href="/api/integrations/notion/connect"
      className="inline-flex items-center justify-center rounded-md bg-[hsl(var(--primary))] px-3.5 py-2 text-body font-medium text-[hsl(var(--primary-foreground))] transition-hover hover:opacity-90"
    >
      Connect Notion
    </a>
  );
}

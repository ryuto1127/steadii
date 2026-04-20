"use client";

import { useState } from "react";

export function NotionConnectPanel({ connected }: { connected: boolean }) {
  const [ackd, setAckd] = useState(false);

  if (connected) {
    return <p className="text-[hsl(var(--muted-foreground))]">Connected.</p>;
  }

  if (!ackd) {
    return (
      <div className="space-y-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] p-4">
        <h3 className="text-sm font-medium text-[hsl(var(--foreground))]">
          One thing to know before you click Connect
        </h3>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          On Notion&apos;s permission screen, select{" "}
          <span className="font-semibold text-[hsl(var(--foreground))]">
            &ldquo;All pages&rdquo;
          </span>
          . Steadii creates its own workspace for you automatically — you
          don&apos;t need to pre-create a page or pick a specific one.
        </p>
        <ul className="ml-5 list-disc space-y-1 text-xs text-[hsl(var(--muted-foreground))]">
          <li>
            New to Notion? There&apos;s nothing to pick — just grant &ldquo;All
            pages&rdquo;.
          </li>
          <li>
            Existing user? &ldquo;All pages&rdquo; is safest; Steadii only
            touches pages under the &ldquo;Steadii&rdquo; parent it creates.
          </li>
          <li>
            Picking a single page here is the main reason onboarding gets
            stuck.
          </li>
        </ul>
        <button
          type="button"
          onClick={() => setAckd(true)}
          className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-4 py-2 text-sm font-medium text-[hsl(var(--foreground))] transition hover:bg-[hsl(var(--surface-raised))]"
        >
          I understand — show me the Connect button
        </button>
      </div>
    );
  }

  return (
    <a
      href="/api/integrations/notion/connect"
      className="inline-flex rounded-lg bg-[hsl(var(--primary))] px-4 py-2 font-medium text-[hsl(var(--primary-foreground))] shadow-sm transition hover:opacity-90"
    >
      Connect Notion
    </a>
  );
}

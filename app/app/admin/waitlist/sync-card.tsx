"use client";

import { useState } from "react";

// "Google Cloud Sync" helper. Lists approved-but-not-yet-synced emails;
// the "Copy emails" button writes them comma-space-joined to the
// clipboard, exactly the format Google Cloud Console's "Add users" input
// expects when pasting test users in bulk. The "完了 mark" action lives
// in the table component below — once Ryuto has pasted into GCC, he ticks
// the rows and clicks 完了.

export function SyncCard({ emails }: { emails: string[] }) {
  const [copied, setCopied] = useState(false);

  if (emails.length === 0) {
    return (
      <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4">
        <h2 className="text-lg font-medium">Google Cloud Sync</h2>
        <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
          Nothing to sync — all approved users have been added to the OAuth
          consent screen test user list.
        </p>
      </div>
    );
  }

  async function copy() {
    const joined = emails.join(", ");
    try {
      await navigator.clipboard.writeText(joined);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // navigator.clipboard fails over plain http (i.e. some preview envs).
      // Fall back to a hidden textarea + execCommand("copy").
      const ta = document.createElement("textarea");
      ta.value = joined;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } finally {
        document.body.removeChild(ta);
      }
    }
  }

  return (
    <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-medium">Google Cloud Sync</h2>
        <span className="font-mono text-[11px] text-[hsl(var(--muted-foreground))]">
          {emails.length} pending
        </span>
      </div>
      <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">
        Approved users still need to be added to the OAuth consent screen test
        user list before they can sign in. Copy the list, paste into Google
        Cloud Console → APIs &amp; Services → OAuth consent screen → Test
        users, then click 完了 mark in the &quot;Approved (not synced)&quot; tab
        below.
      </p>

      <div className="mt-3 max-h-32 overflow-y-auto rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] p-2 font-mono text-[11px]">
        {emails.join(", ")}
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={copy}
          className="inline-flex h-8 items-center rounded-md bg-[hsl(var(--primary))] px-3 text-xs font-medium text-[hsl(var(--primary-foreground))] transition-hover hover:opacity-90"
        >
          {copied ? "Copied ✓" : "Copy emails for paste"}
        </button>
        <a
          href="https://console.cloud.google.com/apis/credentials/consent"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-[hsl(var(--primary))] hover:underline"
        >
          Open OAuth consent screen →
        </a>
      </div>
    </div>
  );
}

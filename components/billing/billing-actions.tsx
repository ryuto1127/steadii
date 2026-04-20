"use client";

import { useState } from "react";

export function BillingActions({
  effectivePlan,
}: {
  effectivePlan: "free" | "pro" | "admin";
}) {
  const [busy, setBusy] = useState<"checkout" | "portal" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function go(path: string, which: "checkout" | "portal") {
    setBusy(which);
    setError(null);
    try {
      const res = await fetch(path, { method: "POST" });
      if (!res.ok) {
        let msg = `Request failed (${res.status})`;
        try {
          const body = await res.json();
          if (typeof body?.error === "string") msg = body.error;
        } catch {}
        setError(msg);
        return;
      }
      const { url } = (await res.json()) as { url: string };
      window.location.href = url;
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      {effectivePlan === "admin" && (
        <p className="mb-2 text-small text-[hsl(var(--muted-foreground))]">
          You&apos;re on an admin redemption — no Stripe subscription needed.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {effectivePlan !== "pro" && effectivePlan !== "admin" && (
          <button
            type="button"
            onClick={() => go("/api/stripe/checkout", "checkout")}
            disabled={busy !== null}
            className="inline-flex items-center rounded-md bg-[hsl(var(--primary))] px-3 py-1.5 text-small font-medium text-[hsl(var(--primary-foreground))] transition-hover hover:opacity-90 disabled:opacity-40"
          >
            {busy === "checkout" ? "Opening…" : "Upgrade to Pro"}
          </button>
        )}
        <button
          type="button"
          onClick={() => go("/api/stripe/portal", "portal")}
          disabled={busy !== null}
          className="inline-flex items-center rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-1.5 text-small font-medium transition-hover hover:bg-[hsl(var(--surface-raised))] disabled:opacity-40"
        >
          {busy === "portal" ? "Opening…" : "Manage subscription"}
        </button>
      </div>
      {error && (
        <p className="mt-2 text-small text-[hsl(var(--destructive))]">{error}</p>
      )}
    </div>
  );
}

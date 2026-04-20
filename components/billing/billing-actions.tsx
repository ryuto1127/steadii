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
    <section className="mt-6 rounded-xl bg-[hsl(var(--surface))] p-6 shadow-sm">
      <h2 className="text-lg font-medium">Stripe</h2>
      {effectivePlan === "admin" && (
        <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
          You&apos;re on an admin redemption — no Stripe subscription needed.
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-3">
        {effectivePlan !== "pro" && effectivePlan !== "admin" && (
          <button
            type="button"
            onClick={() => go("/api/stripe/checkout", "checkout")}
            disabled={busy !== null}
            className="rounded-lg bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] disabled:opacity-40"
          >
            {busy === "checkout" ? "Opening…" : "Upgrade to Pro"}
          </button>
        )}
        <button
          type="button"
          onClick={() => go("/api/stripe/portal", "portal")}
          disabled={busy !== null}
          className="rounded-lg border border-[hsl(var(--border))] px-4 py-2 text-sm disabled:opacity-40"
        >
          {busy === "portal" ? "Opening…" : "Manage subscription"}
        </button>
      </div>
      {error && (
        <p className="mt-3 text-xs text-[hsl(var(--destructive))]">{error}</p>
      )}
    </section>
  );
}

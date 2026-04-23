"use client";

import { useState } from "react";

export function AcceptInviteButton({ code }: { code: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan_tier: "pro",
          plan_interval: "monthly",
          promo_code: code,
        }),
      });
      if (!res.ok) {
        let msg = `Failed to open Checkout (${res.status})`;
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
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={accept}
        disabled={busy}
        className="mt-6 inline-flex items-center rounded-md bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] transition-hover hover:opacity-90 disabled:opacity-40"
      >
        {busy ? "Opening Checkout…" : "Accept invite"}
      </button>
      {error && (
        <p className="mt-3 text-sm text-[hsl(var(--destructive))]">{error}</p>
      )}
    </>
  );
}

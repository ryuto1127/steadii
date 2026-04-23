"use client";

import { useState } from "react";

type BusyKey =
  | "checkout"
  | "portal"
  | "topup_500"
  | "topup_2000"
  | "data_retention";

export function BillingActions({
  effectivePlan,
}: {
  effectivePlan: "free" | "student" | "pro" | "admin";
}) {
  const [busy, setBusy] = useState<BusyKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function go(
    path: string,
    which: BusyKey,
    body?: Record<string, unknown>
  ) {
    setBusy(which);
    setError(null);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        let msg = `Request failed (${res.status})`;
        try {
          const b = await res.json();
          if (typeof b?.error === "string") msg = b.error;
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
          You&apos;re on an admin bypass — no Stripe subscription needed.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {effectivePlan === "free" && (
          <>
            <button
              type="button"
              onClick={() =>
                go("/api/stripe/checkout", "checkout", {
                  plan_tier: "pro",
                  plan_interval: "monthly",
                })
              }
              disabled={busy !== null}
              className="inline-flex items-center rounded-md bg-[hsl(var(--primary))] px-3 py-1.5 text-small font-medium text-[hsl(var(--primary-foreground))] transition-hover hover:opacity-90 disabled:opacity-40"
            >
              {busy === "checkout" ? "Opening…" : "Upgrade to Pro · $20/mo"}
            </button>
            <button
              type="button"
              onClick={() =>
                go("/api/stripe/checkout", "checkout", {
                  plan_tier: "student",
                  plan_interval: "four_month",
                })
              }
              disabled={busy !== null}
              className="inline-flex items-center rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-1.5 text-small font-medium transition-hover hover:bg-[hsl(var(--surface-raised))] disabled:opacity-40"
            >
              {busy === "checkout"
                ? "Opening…"
                : "Student · $40 / 4 months (.edu required)"}
            </button>
          </>
        )}
        {/*
          Manage-subscription button only for paid tiers with an actual Stripe
          customer on file. Admins don't have one (the "no customer" red-text
          error used to leak here — suppressed now).
        */}
        {(effectivePlan === "pro" || effectivePlan === "student") && (
          <button
            type="button"
            onClick={() => go("/api/stripe/portal", "portal")}
            disabled={busy !== null}
            className="inline-flex items-center rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-1.5 text-small font-medium transition-hover hover:bg-[hsl(var(--surface-raised))] disabled:opacity-40"
          >
            {busy === "portal" ? "Opening…" : "Manage subscription"}
          </button>
        )}
      </div>

      {/*
        One-time purchases — top-up credit packs (only meaningful for paid
        tiers; Free users should Upgrade first, per project_decisions.md)
        and the Data Retention Extension (useful for anyone who plans to
        step away longer than the 120-day default grace window).
      */}
      {(effectivePlan === "pro" || effectivePlan === "student") && (
        <div className="mt-4">
          <p className="mb-2 text-small text-[hsl(var(--muted-foreground))]">
            Add credits
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() =>
                go("/api/stripe/topup", "topup_500", { pack: "topup_500" })
              }
              disabled={busy !== null}
              className="inline-flex items-center rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-1.5 text-small font-medium transition-hover hover:bg-[hsl(var(--surface-raised))] disabled:opacity-40"
            >
              {busy === "topup_500" ? "Opening…" : "+500 credits · $10"}
            </button>
            <button
              type="button"
              onClick={() =>
                go("/api/stripe/topup", "topup_2000", { pack: "topup_2000" })
              }
              disabled={busy !== null}
              className="inline-flex items-center rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-1.5 text-small font-medium transition-hover hover:bg-[hsl(var(--surface-raised))] disabled:opacity-40"
            >
              {busy === "topup_2000"
                ? "Opening…"
                : "+2000 credits · $30 (save 25%)"}
            </button>
          </div>
          <p className="mt-2 text-[11px] text-[hsl(var(--muted-foreground))]">
            Top-up credits expire 90 days after purchase.
          </p>
        </div>
      )}

      <div className="mt-4">
        <p className="mb-2 text-small text-[hsl(var(--muted-foreground))]">
          Stepping away?
        </p>
        <button
          type="button"
          onClick={() =>
            go("/api/stripe/topup", "data_retention", {
              pack: "data_retention",
            })
          }
          disabled={busy !== null}
          className="inline-flex items-center rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-1.5 text-small font-medium transition-hover hover:bg-[hsl(var(--surface-raised))] disabled:opacity-40"
        >
          {busy === "data_retention"
            ? "Opening…"
            : "Extend data retention · $10 (12 months)"}
        </button>
        <p className="mt-2 text-[11px] text-[hsl(var(--muted-foreground))]">
          Default: 120-day grace after cancel. This extends to 12 months.
        </p>
      </div>

      {error && (
        <p className="mt-2 text-small text-[hsl(var(--destructive))]">{error}</p>
      )}
    </div>
  );
}

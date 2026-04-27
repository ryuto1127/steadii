"use client";

import { useState } from "react";
import { type SupportedCurrency } from "@/lib/billing/format-price";

type BusyKey =
  | "checkout"
  | "portal"
  | "topup_500"
  | "topup_2000"
  | "data_retention";

// All price-templated copy strings come in pre-formatted from the
// server (RSC). Server-side knows the user's locale + currency and
// resolves `{price}` template placeholders before passing strings
// across the client boundary. We can't accept functions here — Next
// 16 RSC strict mode rejects function props that aren't `"use server"`
// actions.
export function BillingActions({
  effectivePlan,
  currency,
  copy,
}: {
  effectivePlan: "free" | "student" | "pro" | "admin";
  currency: SupportedCurrency;
  copy: {
    adminBypass: string;
    upgradePro: string;
    upgradeStudent: string;
    opening: string;
    manageSub: string;
    addCredits: string;
    topup500: string;
    topup2000: string;
    topupExpiry: string;
    steppingAway: string;
    extendRetention: string;
    extendRetentionHelp: string;
  };
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
          {copy.adminBypass}
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
                  currency,
                })
              }
              disabled={busy !== null}
              className="inline-flex items-center rounded-md bg-[hsl(var(--primary))] px-3 py-1.5 text-small font-medium text-[hsl(var(--primary-foreground))] transition-hover hover:opacity-90 disabled:opacity-40"
            >
              {busy === "checkout"
                ? copy.opening
                : copy.upgradePro}
            </button>
            <button
              type="button"
              onClick={() =>
                go("/api/stripe/checkout", "checkout", {
                  plan_tier: "student",
                  plan_interval: "four_month",
                  currency,
                })
              }
              disabled={busy !== null}
              className="inline-flex items-center rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-1.5 text-small font-medium transition-hover hover:bg-[hsl(var(--surface-raised))] disabled:opacity-40"
            >
              {busy === "checkout"
                ? copy.opening
                : copy.upgradeStudent}
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
            {busy === "portal" ? copy.opening : copy.manageSub}
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
            {copy.addCredits}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() =>
                go("/api/stripe/topup", "topup_500", {
                  pack: "topup_500",
                  currency,
                })
              }
              disabled={busy !== null}
              className="inline-flex items-center rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-1.5 text-small font-medium transition-hover hover:bg-[hsl(var(--surface-raised))] disabled:opacity-40"
            >
              {busy === "topup_500"
                ? copy.opening
                : copy.topup500}
            </button>
            <button
              type="button"
              onClick={() =>
                go("/api/stripe/topup", "topup_2000", {
                  pack: "topup_2000",
                  currency,
                })
              }
              disabled={busy !== null}
              className="inline-flex items-center rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-1.5 text-small font-medium transition-hover hover:bg-[hsl(var(--surface-raised))] disabled:opacity-40"
            >
              {busy === "topup_2000"
                ? copy.opening
                : copy.topup2000}
            </button>
          </div>
          <p className="mt-2 text-[11px] text-[hsl(var(--muted-foreground))]">
            {copy.topupExpiry}
          </p>
        </div>
      )}

      <div className="mt-4">
        <p className="mb-2 text-small text-[hsl(var(--muted-foreground))]">
          {copy.steppingAway}
        </p>
        <button
          type="button"
          onClick={() =>
            go("/api/stripe/topup", "data_retention", {
              pack: "data_retention",
              currency,
            })
          }
          disabled={busy !== null}
          className="inline-flex items-center rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-1.5 text-small font-medium transition-hover hover:bg-[hsl(var(--surface-raised))] disabled:opacity-40"
        >
          {busy === "data_retention"
            ? copy.opening
            : copy.extendRetention}
        </button>
        <p className="mt-2 text-[11px] text-[hsl(var(--muted-foreground))]">
          {copy.extendRetentionHelp}
        </p>
      </div>

      {error && (
        <p className="mt-2 text-small text-[hsl(var(--destructive))]">{error}</p>
      )}
    </div>
  );
}

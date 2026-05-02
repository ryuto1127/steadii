"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

type Reason =
  | "too_expensive"
  | "not_enough"
  | "switching"
  | "privacy"
  | "graduating"
  | "other"
  | "skipped";

const REASONS: Array<{ value: Reason; label: string }> = [
  { value: "too_expensive", label: "Too expensive" },
  { value: "not_enough", label: "Not using it enough" },
  { value: "switching", label: "Switching to another tool" },
  { value: "privacy", label: "Privacy / data concerns" },
  { value: "graduating", label: "Graduating / left university" },
  { value: "other", label: "Other" },
];

export function CancelForm({
  currentPeriodEnd,
}: {
  currentPeriodEnd: string | null;
}) {
  const router = useRouter();
  const tCancel = useTranslations("cancel_form");
  const t = useTranslations("cancel_form_page");
  const [step, setStep] = useState<"reason" | "confirm" | "done">("reason");
  const [reason, setReason] = useState<Reason>("skipped");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason, note: note || undefined }),
      });
      if (!res.ok) {
        let msg = `Cancel failed (${res.status})`;
        try {
          const body = await res.json();
          if (typeof body?.error === "string") msg = body.error;
        } catch {}
        setError(msg);
        return;
      }
      setStep("done");
      // Refresh billing page when user navigates back.
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (step === "done") {
    return (
      <div className="mt-6 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4 text-sm">
        <p className="font-medium">{t("scheduled_toast")}</p>
        <p className="mt-2 text-[hsl(var(--muted-foreground))]">
          {currentPeriodEnd
            ? `You'll keep full access until ${new Date(
                currentPeriodEnd
              ).toLocaleDateString()}. After that, your account downgrades to Free and your data is preserved for 120 days.`
            : "Access continues to the end of the current billing period."}
        </p>
        <Link
          href="/app/settings/billing"
          className="mt-4 inline-flex items-center rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-1.5 text-small font-medium transition-hover hover:bg-[hsl(var(--surface-raised))]"
        >
          {t("back_to_billing")}
        </Link>
      </div>
    );
  }

  if (step === "reason") {
    return (
      <div className="mt-6 space-y-3">
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4">
          <fieldset className="space-y-2 text-sm">
            <legend className="mb-2 font-medium">
              {t("why_label")} <span className="font-normal text-[hsl(var(--muted-foreground))]">{t("optional_indicator")}</span>
            </legend>
            {REASONS.map((r) => (
              <label
                key={r.value}
                className="flex cursor-pointer items-center gap-2"
              >
                <input
                  type="radio"
                  name="reason"
                  value={r.value}
                  checked={reason === r.value}
                  onChange={() => setReason(r.value)}
                />
                <span>{r.label}</span>
              </label>
            ))}
          </fieldset>
          {(reason === "other" || reason === "switching") && (
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={
                reason === "switching"
                  ? "Which tool? (optional)"
                  : "Anything more to add? (optional)"
              }
              maxLength={500}
              className="mt-3 w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[hsl(var(--primary))]"
              rows={2}
            />
          )}
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setStep("confirm")}
            className="inline-flex items-center rounded-md bg-[hsl(var(--foreground))] px-3 py-1.5 text-small font-medium text-[hsl(var(--background))] transition-hover hover:opacity-90"
          >
            {t("continue")}
          </button>
          <button
            type="button"
            onClick={() => {
              setReason("skipped");
              setStep("confirm");
            }}
            className="inline-flex items-center rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-1.5 text-small font-medium transition-hover hover:bg-[hsl(var(--surface-raised))]"
          >
            {t("skip")}
          </button>
          <Link
            href="/app/settings/billing"
            className="inline-flex items-center rounded-md px-3 py-1.5 text-small text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
          >
            {t("back")}
          </Link>
        </div>
      </div>
    );
  }

  // step === "confirm"
  return (
    <div className="mt-6 space-y-4">
      <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4 text-sm">
        <p className="font-medium">{t("summary_heading")}</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[hsl(var(--muted-foreground))]">
          <li>
            {t("keep_access_until")}{" "}
            {currentPeriodEnd
              ? new Date(currentPeriodEnd).toLocaleDateString()
              : "the end of the current billing period"}
            .
          </li>
          <li>{tCancel("bullet_downgrade")}</li>
          <li>{tCancel("bullet_data_preserved")}</li>
        </ul>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="inline-flex items-center rounded-md bg-[hsl(var(--destructive))] px-3 py-1.5 text-small font-medium text-white transition-hover hover:opacity-90 disabled:opacity-40"
        >
          {busy ? "Canceling…" : "Confirm cancel"}
        </button>
        <button
          type="button"
          onClick={() => setStep("reason")}
          disabled={busy}
          className="inline-flex items-center rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-1.5 text-small font-medium transition-hover hover:bg-[hsl(var(--surface-raised))] disabled:opacity-40"
        >
          {t("back")}
        </button>
      </div>
      {error && (
        <p className="text-sm text-[hsl(var(--destructive))]">{error}</p>
      )}
    </div>
  );
}

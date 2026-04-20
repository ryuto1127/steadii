import Link from "next/link";
import { auth } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getUserConfirmationMode } from "@/lib/agent/preferences";
import { setConfirmationModeAction } from "./actions";
import { getCreditBalance } from "@/lib/billing/credits";
import { getStorageTotals } from "@/lib/billing/storage";
import { prettyBytes } from "@/lib/billing/plan";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;
  const t = await getTranslations("nav");
  const mode = await getUserConfirmationMode(userId);
  const balance = await getCreditBalance(userId);
  const storage = await getStorageTotals(userId);

  return (
    <div className="max-w-xl">
      <h1 className="font-serif text-3xl">{t("settings")}</h1>

      <section className="mt-8 rounded-xl bg-[hsl(var(--surface))] p-6 shadow-sm">
        <h2 className="text-lg font-medium">Plan &amp; usage</h2>
        <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
          Current plan:{" "}
          <span className="font-medium text-[hsl(var(--foreground))]">
            {balance.plan === "pro" ? "Pro" : "Free"}
          </span>
        </p>

        <div className="mt-5">
          <div className="flex items-baseline justify-between text-sm">
            <span>Credits this month</span>
            <span className="font-mono text-xs">
              {balance.used} / {balance.limit}
            </span>
          </div>
          <Bar
            percent={Math.min(100, (balance.used / balance.limit) * 100)}
            tone={balance.exceeded ? "destructive" : balance.nearLimit ? "accent" : "primary"}
          />
          {balance.exceeded && (
            <p className="mt-1 text-xs text-[hsl(var(--destructive))]">
              Out of credits. Chat is paused until next cycle or upgrade.
            </p>
          )}
        </div>

        <div className="mt-5">
          <div className="flex items-baseline justify-between text-sm">
            <span>Storage</span>
            <span className="font-mono text-xs">
              {prettyBytes(storage.usedBytes)} / {prettyBytes(storage.maxTotalBytes)}
            </span>
          </div>
          <Bar
            percent={Math.min(100, (storage.usedBytes / storage.maxTotalBytes) * 100)}
            tone={
              storage.usedBytes >= storage.maxTotalBytes
                ? "destructive"
                : storage.usedBytes >= storage.maxTotalBytes * 0.8
                ? "accent"
                : "primary"
            }
          />
          <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
            Per-file cap: {prettyBytes(storage.maxFileBytes)}
          </p>
        </div>

        {balance.plan === "free" && (
          <div className="mt-6 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] p-4">
            <p className="text-sm font-medium">Upgrade to Pro</p>
            <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
              1,000 credits/month · 50 MB per file · 2 GB total storage.
              Billing UI ships in Phase 5.
            </p>
          </div>
        )}
      </section>

      <ul className="mt-6 divide-y divide-[hsl(var(--border))] rounded-xl bg-[hsl(var(--surface))]">
        <li>
          <Link
            href="/app/settings/connections"
            className="flex items-center justify-between px-6 py-4 text-sm transition hover:bg-[hsl(var(--surface-raised))]"
          >
            <span>Connections</span>
            <span className="text-[hsl(var(--muted-foreground))]">→</span>
          </Link>
        </li>
        <li>
          <Link
            href="/app/resources"
            className="flex items-center justify-between px-6 py-4 text-sm transition hover:bg-[hsl(var(--surface-raised))]"
          >
            <span>Registered Resources</span>
            <span className="text-[hsl(var(--muted-foreground))]">→</span>
          </Link>
        </li>
      </ul>

      <section className="mt-8 rounded-xl bg-[hsl(var(--surface))] p-6 shadow-sm">
        <h2 className="text-lg font-medium">Agent confirmation</h2>
        <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
          Choose when Steadii should pause and ask before acting on your Notion
          pages or calendar.
        </p>
        <form action={setConfirmationModeAction} className="mt-4 space-y-3">
          <Option
            value="destructive_only"
            checked={mode === "destructive_only"}
            label="Only confirm destructive actions (recommended)"
            hint="Creating or updating is automatic; deletions pause for approval."
          />
          <Option
            value="all"
            checked={mode === "all"}
            label="Confirm every write"
            hint="Any change — create, update, delete — pauses for approval."
          />
          <Option
            value="none"
            checked={mode === "none"}
            label="Never ask"
            hint="Steadii acts immediately. Use with care."
          />
          <button
            type="submit"
            className="mt-2 rounded-lg bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))]"
          >
            Save
          </button>
        </form>
      </section>
    </div>
  );
}

function Bar({
  percent,
  tone,
}: {
  percent: number;
  tone: "primary" | "accent" | "destructive";
}) {
  const color =
    tone === "destructive"
      ? "hsl(var(--destructive))"
      : tone === "accent"
      ? "hsl(var(--accent))"
      : "hsl(var(--primary))";
  return (
    <div className="mt-2 h-2 overflow-hidden rounded-full bg-[hsl(var(--surface-raised))]">
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${Math.max(0, Math.min(100, percent))}%`, backgroundColor: color }}
      />
    </div>
  );
}

function Option({
  value,
  checked,
  label,
  hint,
}: {
  value: string;
  checked: boolean;
  label: string;
  hint: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2 transition hover:bg-[hsl(var(--surface-raised))]">
      <input
        type="radio"
        name="mode"
        value={value}
        defaultChecked={checked}
        className="mt-1"
      />
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-[hsl(var(--muted-foreground))]">{hint}</p>
      </div>
    </label>
  );
}

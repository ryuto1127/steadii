import Link from "next/link";
import { auth, signOut } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import { ExternalLink, RefreshCw } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { db } from "@/lib/db/client";
import {
  notionConnections,
  accounts,
  registeredResources,
  users,
} from "@/lib/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { AgentRulesSection } from "@/components/settings/agent-rules";
import { NotificationSettings } from "@/components/settings/notifications";
import { getUserConfirmationMode, getUserTimezone } from "@/lib/agent/preferences";
import { setConfirmationModeAction, refreshGmailInboxAction } from "./actions";
import { getCreditBalance } from "@/lib/billing/credits";
import { getStorageTotals } from "@/lib/billing/storage";
import { prettyBytes } from "@/lib/billing/plan";
import { getEffectivePlan } from "@/lib/billing/effective-plan";
import {
  addResourceAction,
  removeResourceAction,
  refreshResourcesAction,
  disconnectNotionAction,
} from "@/app/(auth)/onboarding/actions";
import { BillingActions } from "@/components/billing/billing-actions";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { LanguageToggle } from "@/components/settings/language-toggle";
import { TimezoneInput } from "@/components/settings/timezone-input";
import { getUserThemePreference } from "@/lib/theme/get-preference";
import { isLocale } from "@/lib/i18n/config";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;
  const t = await getTranslations("settings");
  const currentLocaleRaw = await getLocale();
  const currentLocale = isLocale(currentLocaleRaw) ? currentLocaleRaw : "en";

  const [
    mode,
    balance,
    storage,
    effective,
    notionConn,
    googleAcct,
    resources,
    theme,
    timezone,
    userPrefs,
  ] = await Promise.all([
    getUserConfirmationMode(userId),
    getCreditBalance(userId),
    getStorageTotals(userId),
    getEffectivePlan(userId),
    db
      .select()
      .from(notionConnections)
      .where(eq(notionConnections.userId, userId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db
      .select()
      .from(accounts)
      .where(and(eq(accounts.userId, userId), eq(accounts.provider, "google")))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db
      .select()
      .from(registeredResources)
      .where(
        and(
          eq(registeredResources.userId, userId),
          isNull(registeredResources.archivedAt)
        )
      ),
    getUserThemePreference(userId),
    getUserTimezone(userId),
    db
      .select({
        digestEnabled: users.digestEnabled,
        digestHourLocal: users.digestHourLocal,
        undoWindowSeconds: users.undoWindowSeconds,
        highRiskNotifyImmediate: users.highRiskNotifyImmediate,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ]);

  const calendarConnected = googleAcct?.scope?.includes("calendar") ?? false;
  const gmailConnected = googleAcct?.scope?.includes("gmail") ?? false;

  async function signOutAction() {
    "use server";
    await signOut({ redirectTo: "/" });
  }

  return (
    <div className="mx-auto max-w-2xl py-6">
      <h1 className="text-h1 text-[hsl(var(--foreground))]">{t("title")}</h1>

      <Section title={t("sections.profile")}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-body">{session.user.name ?? "(no name)"}</p>
            <p className="text-small text-[hsl(var(--muted-foreground))]">
              {session.user.email}
            </p>
          </div>
          <form action={signOutAction}>
            <button
              type="submit"
              className="text-small text-[hsl(var(--muted-foreground))] transition-hover hover:text-[hsl(var(--foreground))]"
            >
              {t("sign_out")}
            </button>
          </form>
        </div>
      </Section>

      <Section title={t("sections.connections")}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-body">Notion</p>
            <p className="text-small text-[hsl(var(--muted-foreground))]">
              {notionConn
                ? `Connected to ${notionConn.workspaceName ?? "workspace"}${
                    notionConn.setupCompletedAt ? " · setup complete" : " · setup pending"
                  }`
                : "Not connected"}
            </p>
          </div>
          {notionConn ? (
            <form action={disconnectNotionAction}>
              <button
                type="submit"
                className="text-small text-[hsl(var(--muted-foreground))] transition-hover hover:text-[hsl(var(--destructive))]"
              >
                Disconnect
              </button>
            </form>
          ) : (
            <Link
              href="/api/integrations/notion/connect"
              className="inline-flex items-center rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-1.5 text-small font-medium transition-hover hover:bg-[hsl(var(--surface-raised))]"
            >
              Connect
            </Link>
          )}
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-[hsl(var(--border))] pt-3">
          <div>
            <p className="text-body">Google Calendar</p>
            <p className="text-small text-[hsl(var(--muted-foreground))]">
              {calendarConnected ? "Calendar scope granted." : "Calendar scope missing."}
            </p>
          </div>
          {!calendarConnected ? (
            <form action={signOutAction}>
              <button
                type="submit"
                className="text-small text-[hsl(var(--muted-foreground))] transition-hover hover:text-[hsl(var(--foreground))]"
              >
                Sign out to re-auth
              </button>
            </form>
          ) : null}
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-[hsl(var(--border))] pt-3">
          <div>
            <p className="text-body">Gmail</p>
            <p className="text-small text-[hsl(var(--muted-foreground))]">
              {gmailConnected
                ? "Gmail scope granted. The agent can triage and draft replies."
                : "Gmail scope missing — sign out and sign back in to grant it."}
            </p>
          </div>
          {gmailConnected ? (
            <form action={refreshGmailInboxAction}>
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-1.5 text-small font-medium transition-hover hover:bg-[hsl(var(--surface-raised))]"
                title="Re-ingest the last 24 hours of Gmail"
              >
                <RefreshCw size={14} strokeWidth={1.75} />
                Refresh inbox
              </button>
            </form>
          ) : (
            <form action={signOutAction}>
              <button
                type="submit"
                className="text-small text-[hsl(var(--muted-foreground))] transition-hover hover:text-[hsl(var(--foreground))]"
              >
                Sign out to re-auth
              </button>
            </form>
          )}
        </div>
      </Section>

      <Section title={t("sections.resources")}>
        <p className="mb-3 text-small text-[hsl(var(--muted-foreground))]">
          Notion pages the agent can read. Pages under the Steadii parent
          auto-register. Add extra pages with a URL.
        </p>
        <form action={addResourceAction} className="mb-3 flex gap-2">
          <input
            name="notion_url"
            placeholder="https://notion.so/..."
            className="flex-1 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-1.5 text-small focus:outline-none focus:border-[hsl(var(--ring))]"
          />
          <button
            type="submit"
            className="inline-flex items-center rounded-md bg-[hsl(var(--primary))] px-3 py-1.5 text-small font-medium text-[hsl(var(--primary-foreground))] transition-hover hover:opacity-90"
          >
            Add
          </button>
        </form>
        {resources.length === 0 ? (
          <p className="text-small text-[hsl(var(--muted-foreground))]">
            No manual resources yet.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-[hsl(var(--border))]">
            {resources.map((r) => (
              <li key={r.id} className="flex items-center justify-between py-2 text-small">
                <div className="min-w-0">
                  <p className="truncate text-body">{r.title ?? r.notionId}</p>
                  <p className="truncate text-[hsl(var(--muted-foreground))]">
                    {r.autoRegistered ? "auto-registered" : "manual"} · {r.resourceType}
                  </p>
                </div>
                <form action={removeResourceAction}>
                  <input type="hidden" name="id" value={r.id} />
                  <button
                    type="submit"
                    className="text-[hsl(var(--muted-foreground))] transition-hover hover:text-[hsl(var(--destructive))]"
                  >
                    Remove
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <form action={refreshResourcesAction} className="mt-3">
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-1.5 text-small font-medium transition-hover hover:bg-[hsl(var(--surface-raised))]"
          >
            <RefreshCw size={12} strokeWidth={1.5} />
            Refresh from Notion
          </button>
        </form>
      </Section>

      <Section title="Agent Rules">
        <p className="mb-3 text-small text-[hsl(var(--muted-foreground))]">
          Transparency is the promise. Every rule the agent uses to triage
          your inbox — global keyword lists, learned contacts, manual
          overrides — is listed below.
        </p>
        <AgentRulesSection userId={userId} />
      </Section>

      <Section title="Notifications">
        <NotificationSettings
          initial={{
            digestEnabled: userPrefs?.digestEnabled ?? true,
            digestHourLocal: userPrefs?.digestHourLocal ?? 7,
            undoWindowSeconds: userPrefs?.undoWindowSeconds ?? 20,
            highRiskNotifyImmediate:
              userPrefs?.highRiskNotifyImmediate ?? true,
          }}
        />
      </Section>

      <Section title={t("sections.agent")}>
        <form action={setConfirmationModeAction} className="space-y-2">
          <Option
            value="destructive_only"
            name="mode"
            checked={mode === "destructive_only"}
            label="Only confirm destructive actions (recommended)"
            hint="Creating or updating is automatic; deletions pause for approval."
          />
          <Option
            value="all"
            name="mode"
            checked={mode === "all"}
            label="Confirm every write"
            hint="Any change — create, update, delete — pauses for approval."
          />
          <Option
            value="none"
            name="mode"
            checked={mode === "none"}
            label="Never ask"
            hint="Steadii acts immediately. Use with care."
          />
          <button
            type="submit"
            className="mt-2 inline-flex items-center rounded-md bg-[hsl(var(--primary))] px-3 py-1.5 text-small font-medium text-[hsl(var(--primary-foreground))] transition-hover hover:opacity-90"
          >
            Save
          </button>
        </form>
      </Section>

      <Section title={t("sections.usage")}>
        <p className="mb-3 text-small text-[hsl(var(--muted-foreground))]">
          {effective.plan === "admin"
            ? "Admin (flag) · unlimited"
            : effective.plan === "student"
            ? `Student${
                effective.until
                  ? ` · renews ${effective.until.toLocaleDateString()}`
                  : ""
              }`
            : effective.plan === "pro" && effective.source === "trial"
            ? `Pro (14-day trial) · ends ${effective.until.toLocaleDateString()}`
            : effective.plan === "pro"
            ? `Pro${
                effective.until
                  ? ` · renews ${effective.until.toLocaleDateString()}`
                  : ""
              }`
            : "Free"}
        </p>
        <MeterRow
          label="Credits this month"
          used={balance.used}
          limit={balance.limit}
          unit=""
          exceeded={balance.exceeded}
          nearLimit={balance.nearLimit}
        />
        <div className="mt-3">
          <MeterRow
            label="Storage"
            used={storage.usedBytes}
            limit={storage.maxTotalBytes}
            unit="bytes"
            exceeded={storage.usedBytes >= storage.maxTotalBytes}
            nearLimit={storage.usedBytes >= storage.maxTotalBytes * 0.8}
            prettyUsed={prettyBytes(storage.usedBytes)}
            prettyLimit={prettyBytes(storage.maxTotalBytes)}
          />
        </div>
        <div className="mt-4">
          <BillingActions effectivePlan={effective.plan} />
        </div>
      </Section>

      <Section title={t("sections.appearance")}>
        <div className="flex items-center justify-between">
          <p className="text-small text-[hsl(var(--muted-foreground))]">
            {t("appearance_theme_label")}
          </p>
          <ThemeToggle initial={theme} />
        </div>
      </Section>

      <Section title={t("sections.language")}>
        <div className="flex items-center justify-between gap-4">
          <p className="text-small text-[hsl(var(--muted-foreground))]">
            {t("language_description")}
          </p>
          <LanguageToggle
            initial={currentLocale}
            labels={{
              en: t("language_option_en"),
              ja: t("language_option_ja"),
            }}
          />
        </div>
      </Section>

      <Section title={t("sections.timezone")}>
        <p className="mb-3 text-small text-[hsl(var(--muted-foreground))]">
          {t("timezone_description")}
        </p>
        <TimezoneInput
          initial={timezone}
          labels={{
            placeholder: t("timezone_placeholder"),
            save: t("timezone_save"),
            detected: t("timezone_detected"),
            saved: t("timezone_saved"),
            invalid: t("timezone_invalid"),
          }}
        />
      </Section>

      <Section title={t("sections.danger")} tone="warn">
        <div className="flex items-center justify-between">
          <p className="text-small text-[hsl(var(--muted-foreground))]">
            Delete account and all associated data. (Coming after α.)
          </p>
          <button
            type="button"
            disabled
            className="text-small text-[hsl(var(--muted-foreground))] opacity-60"
          >
            Delete account
          </button>
        </div>
      </Section>
    </div>
  );
}

function Section({
  title,
  tone = "neutral",
  children,
}: {
  title: string;
  tone?: "neutral" | "warn";
  children: React.ReactNode;
}) {
  return (
    <section
      className={
        tone === "warn"
          ? "mt-5 rounded-md border border-[hsl(var(--destructive)/0.25)] bg-[hsl(var(--destructive)/0.03)] p-4"
          : "mt-5 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4"
      }
    >
      <h2 className="mb-2.5 text-h3 text-[hsl(var(--foreground))]">{title}</h2>
      {children}
    </section>
  );
}

function MeterRow({
  label,
  used,
  limit,
  exceeded,
  nearLimit,
  prettyUsed,
  prettyLimit,
  unit,
}: {
  label: string;
  used: number;
  limit: number;
  exceeded: boolean;
  nearLimit: boolean;
  prettyUsed?: string;
  prettyLimit?: string;
  unit?: string;
}) {
  void unit;
  const pct = Math.min(100, Math.max(0, (used / limit) * 100));
  const fill = exceeded
    ? "hsl(var(--destructive))"
    : nearLimit
    ? "hsl(var(--primary))"
    : "hsl(var(--primary))";
  return (
    <div>
      <div className="flex items-baseline justify-between text-small">
        <span>{label}</span>
        <span className="font-mono text-[12px] tabular-nums text-[hsl(var(--muted-foreground))]">
          {prettyUsed ?? used} / {prettyLimit ?? limit}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[hsl(var(--surface-raised))]">
        <div
          className="h-full transition-default"
          style={{
            width: `${pct}%`,
            backgroundColor: fill,
            opacity: exceeded ? 1 : nearLimit ? 0.9 : 0.8,
          }}
        />
      </div>
    </div>
  );
}

function Option({
  name,
  value,
  checked,
  label,
  hint,
}: {
  name: string;
  value: string;
  checked: boolean;
  label: string;
  hint: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-1.5 transition-hover hover:bg-[hsl(var(--surface-raised))]">
      <input
        type="radio"
        name={name}
        value={value}
        defaultChecked={checked}
        className="mt-1"
      />
      <div>
        <p className="text-body font-medium">{label}</p>
        <p className="text-small text-[hsl(var(--muted-foreground))]">{hint}</p>
      </div>
    </label>
  );
}

void ExternalLink;

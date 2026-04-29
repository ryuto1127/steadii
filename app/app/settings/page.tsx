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
import {
  setConfirmationModeAction,
  refreshGmailInboxAction,
  setAutonomySendEnabledAction,
} from "./actions";
import { getCreditBalance } from "@/lib/billing/credits";
import { getStorageTotals } from "@/lib/billing/storage";
import { prettyBytes } from "@/lib/format/bytes";
import { getEffectivePlan } from "@/lib/billing/effective-plan";
import {
  addResourceAction,
  removeResourceAction,
  refreshResourcesAction,
  disconnectNotionAction,
} from "@/app/(auth)/onboarding/actions";
import { BillingActions } from "@/components/billing/billing-actions";
import { priceLabelsFor } from "@/lib/billing/format-price";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { LanguageToggle } from "@/components/settings/language-toggle";
import { TimezoneInput } from "@/components/settings/timezone-input";
import { WipeDataSection } from "@/components/settings/wipe-data-section";
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
        autonomySendEnabled: users.autonomySendEnabled,
        preferredCurrency: users.preferredCurrency,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ]);
  const tBilling = await getTranslations("billing");
  const tConn = await getTranslations("settings.connections");
  const tRes = await getTranslations("settings.resources");
  const tThinks = await getTranslations("settings.agent_thinks");
  const tRules = await getTranslations("settings.agent_rules");
  const tStaged = await getTranslations("settings.staged_autonomy");
  const tModes = await getTranslations("settings.agent_modes");
  const tUsage = await getTranslations("settings.usage");
  const dateLocale = currentLocale === "ja" ? "ja-JP" : "en-US";
  const fmt = (template: string, vars: Record<string, string | number>) =>
    template.replace(/\{(\w+)\}/g, (_, k) =>
      k in vars ? String(vars[k]) : `{${k}}`
    );

  const calendarConnected = googleAcct?.scope?.includes("calendar") ?? false;
  const gmailConnected = googleAcct?.scope?.includes("gmail") ?? false;

  async function signOutAction() {
    "use server";
    await signOut({ redirectTo: "/" });
  }

  return (
    <div className="mx-auto max-w-2xl py-2 md:py-6">
      <h1 className="text-h1 text-[hsl(var(--foreground))]">{t("title")}</h1>

      <Section title={t("sections.profile")}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-body break-words">{session.user.name ?? t("no_name")}</p>
            <p className="text-small text-[hsl(var(--muted-foreground))] break-all">
              {session.user.email}
            </p>
          </div>
          <form action={signOutAction} className="shrink-0">
            <button
              type="submit"
              className="inline-flex h-9 items-center rounded-md text-small text-[hsl(var(--muted-foreground))] transition-hover hover:text-[hsl(var(--foreground))]"
            >
              {t("sign_out")}
            </button>
          </form>
        </div>
      </Section>

      <Section title={t("sections.connections")}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-body">Notion</p>
            <p className="text-small text-[hsl(var(--muted-foreground))] break-words">
              {notionConn
                ? `${fmt(tConn("connected_to"), {
                    workspaceName:
                      notionConn.workspaceName ?? tConn("workspace_fallback"),
                  })} · ${
                    notionConn.setupCompletedAt
                      ? tConn("setup_complete")
                      : tConn("setup_pending")
                  }`
                : tConn("not_connected")}
            </p>
          </div>
          {notionConn ? (
            <form action={disconnectNotionAction} className="shrink-0">
              <button
                type="submit"
                className="inline-flex h-9 items-center rounded-md text-small text-[hsl(var(--muted-foreground))] transition-hover hover:text-[hsl(var(--destructive))]"
              >
                {tConn("disconnect")}
              </button>
            </form>
          ) : (
            <Link
              href="/api/integrations/notion/connect"
              className="inline-flex h-9 shrink-0 items-center rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 text-small font-medium transition-hover hover:bg-[hsl(var(--surface-raised))]"
            >
              {tConn("connect")}
            </Link>
          )}
        </div>
        <div className="mt-3 flex flex-col gap-3 border-t border-[hsl(var(--border))] pt-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-body">{tConn("calendar_label")}</p>
            <p className="text-small text-[hsl(var(--muted-foreground))]">
              {calendarConnected
                ? tConn("calendar_granted")
                : tConn("calendar_missing")}
            </p>
          </div>
          {!calendarConnected ? (
            <form action={signOutAction} className="shrink-0">
              <button
                type="submit"
                className="inline-flex h-9 items-center rounded-md text-small text-[hsl(var(--muted-foreground))] transition-hover hover:text-[hsl(var(--foreground))]"
              >
                {tConn("sign_out_to_reauth")}
              </button>
            </form>
          ) : null}
        </div>
        <div className="mt-3 flex flex-col gap-3 border-t border-[hsl(var(--border))] pt-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-body">{tConn("gmail_label")}</p>
            <p className="text-small text-[hsl(var(--muted-foreground))]">
              {gmailConnected
                ? tConn("gmail_granted")
                : tConn("gmail_missing")}
            </p>
          </div>
          {gmailConnected ? (
            <form action={refreshGmailInboxAction} className="shrink-0">
              <button
                type="submit"
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 text-small font-medium transition-hover hover:bg-[hsl(var(--surface-raised))]"
                title={tConn("refresh_inbox_title")}
              >
                <RefreshCw size={14} strokeWidth={1.75} />
                {tConn("refresh_inbox")}
              </button>
            </form>
          ) : (
            <form action={signOutAction} className="shrink-0">
              <button
                type="submit"
                className="inline-flex h-9 items-center rounded-md text-small text-[hsl(var(--muted-foreground))] transition-hover hover:text-[hsl(var(--foreground))]"
              >
                {tConn("sign_out_to_reauth")}
              </button>
            </form>
          )}
        </div>
      </Section>

      <Section title={t("sections.resources")}>
        <p className="mb-3 text-small text-[hsl(var(--muted-foreground))]">
          {tRes("description")}
        </p>
        {!notionConn ? (
          <p className="mb-3 text-small text-[hsl(var(--muted-foreground))]">
            {tRes("not_connected_hint")}
          </p>
        ) : null}
        <form action={addResourceAction} className="mb-3 flex flex-col gap-2 sm:flex-row">
          <input
            name="notion_url"
            placeholder={tRes("add_placeholder")}
            className="h-9 flex-1 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 text-small focus:border-[hsl(var(--ring))] focus:outline-none"
          />
          <button
            type="submit"
            className="inline-flex h-9 shrink-0 items-center justify-center rounded-md bg-[hsl(var(--primary))] px-4 text-small font-medium text-[hsl(var(--primary-foreground))] transition-hover hover:opacity-90"
          >
            {tRes("add_button")}
          </button>
        </form>
        {resources.length === 0 ? (
          <p className="text-small text-[hsl(var(--muted-foreground))]">
            {tRes("empty")}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-[hsl(var(--border))]">
            {resources.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-small">
                <div className="min-w-0">
                  <p className="truncate text-body">{r.title ?? r.notionId}</p>
                  <p className="truncate text-[hsl(var(--muted-foreground))]">
                    {r.autoRegistered
                      ? tRes("auto_registered")
                      : tRes("manual")}{" "}
                    · {r.resourceType}
                  </p>
                </div>
                <form action={removeResourceAction} className="shrink-0">
                  <input type="hidden" name="id" value={r.id} />
                  <button
                    type="submit"
                    className="inline-flex h-9 items-center text-[hsl(var(--muted-foreground))] transition-hover hover:text-[hsl(var(--destructive))]"
                  >
                    {tRes("remove")}
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
            {tRes("refresh_from_notion")}
          </button>
        </form>
      </Section>

      <Section title={tThinks("section_title")}>
        <p className="mb-3 text-small text-[hsl(var(--muted-foreground))]">
          {tThinks("description")}
        </p>
        <Link
          href="/app/settings/how-your-agent-thinks"
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 text-small font-medium transition-hover hover:bg-[hsl(var(--surface-raised))]"
        >
          {tThinks("open")}
          <ExternalLink size={12} strokeWidth={1.5} />
        </Link>
      </Section>

      <Section title={tRules("section_title")}>
        <p className="mb-3 text-small text-[hsl(var(--muted-foreground))]">
          {tRules("description")}
        </p>
        <AgentRulesSection userId={userId} />
      </Section>

      <Section title={t("notifications_section")}>
        <NotificationSettings
          initial={{
            digestEnabled: userPrefs?.digestEnabled ?? true,
            digestHourLocal: userPrefs?.digestHourLocal ?? 7,
            undoWindowSeconds: userPrefs?.undoWindowSeconds ?? 10,
            highRiskNotifyImmediate:
              userPrefs?.highRiskNotifyImmediate ?? true,
          }}
        />
      </Section>

      <Section title={tStaged("section_title")}>
        <p className="mb-3 text-small text-[hsl(var(--muted-foreground))]">
          {tStaged("description_prefix")}
          <em>{tStaged("description_em")}</em>
          {tStaged("description_suffix")}
        </p>
        <form
          action={setAutonomySendEnabledAction}
          className="flex items-center justify-between gap-3 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-2.5"
        >
          <span className="text-body">{tStaged("toggle_label")}</span>
          <input
            type="hidden"
            name="enabled"
            value={
              userPrefs?.autonomySendEnabled ? "false" : "true"
            }
          />
          <button
            type="submit"
            className={`inline-flex h-9 shrink-0 items-center rounded-md px-4 text-small font-medium transition-hover ${
              userPrefs?.autonomySendEnabled
                ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:opacity-90"
                : "border border-[hsl(var(--border))] hover:bg-[hsl(var(--surface-raised))]"
            }`}
          >
            {userPrefs?.autonomySendEnabled ? tStaged("on") : tStaged("off")}
          </button>
        </form>
      </Section>

      <Section title={t("sections.agent")}>
        <form action={setConfirmationModeAction} className="space-y-2">
          <Option
            value="destructive_only"
            name="mode"
            checked={mode === "destructive_only"}
            label={tModes("destructive_only_label")}
            hint={tModes("destructive_only_hint")}
          />
          <Option
            value="all"
            name="mode"
            checked={mode === "all"}
            label={tModes("all_label")}
            hint={tModes("all_hint")}
          />
          <Option
            value="none"
            name="mode"
            checked={mode === "none"}
            label={tModes("none_label")}
            hint={tModes("none_hint")}
          />
          <button
            type="submit"
            className="mt-2 inline-flex h-9 items-center rounded-md bg-[hsl(var(--primary))] px-4 text-small font-medium text-[hsl(var(--primary-foreground))] transition-hover hover:opacity-90"
          >
            {tModes("save")}
          </button>
        </form>
      </Section>

      <Section title={t("sections.usage")}>
        <p className="mb-3 text-small text-[hsl(var(--muted-foreground))]">
          {effective.plan === "admin"
            ? tBilling("plan_admin")
            : effective.plan === "student"
            ? effective.until
              ? fmt(tBilling("plan_student_renews"), {
                  date: effective.until.toLocaleDateString(dateLocale),
                })
              : tBilling("plan_student")
            : effective.plan === "pro" && effective.source === "trial"
            ? fmt(tBilling("plan_pro_trial"), {
                date: effective.until.toLocaleDateString(dateLocale),
              })
            : effective.plan === "pro"
            ? effective.until
              ? fmt(tBilling("plan_pro_renews"), {
                  date: effective.until.toLocaleDateString(dateLocale),
                })
              : tBilling("plan_pro")
            : tBilling("plan_free")}
        </p>
        <MeterRow
          label={tUsage("credits_this_month")}
          used={balance.used}
          limit={balance.limit}
          unit=""
          exceeded={balance.exceeded}
          nearLimit={balance.nearLimit}
        />
        <div className="mt-3">
          <MeterRow
            label={tUsage("storage_label")}
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
          {(() => {
            const currency = userPrefs?.preferredCurrency ?? "usd";
            const labels = priceLabelsFor(currency);
            return (
              <BillingActions
                effectivePlan={effective.plan}
                currency={currency}
                copy={{
                  adminBypass: tBilling("actions.admin_bypass"),
                  upgradePro: fmt(tBilling("actions.upgrade_pro"), {
                    price: labels.pro_monthly,
                  }),
                  upgradeStudent: fmt(tBilling("actions.upgrade_student"), {
                    price: labels.student_4mo,
                  }),
                  opening: tBilling("actions.opening"),
                  manageSub: tBilling("actions.manage_sub"),
                  addCredits: tBilling("actions.add_credits"),
                  topup500: fmt(tBilling("actions.topup_500"), {
                    price: labels.topup_500,
                  }),
                  topup2000: fmt(tBilling("actions.topup_2000"), {
                    price: labels.topup_2000,
                  }),
                  topupExpiry: tBilling("actions.topup_expiry"),
                  steppingAway: tBilling("actions.stepping_away"),
                  extendRetention: fmt(tBilling("actions.extend_retention"), {
                    price: labels.data_retention,
                  }),
                  extendRetentionHelp: tBilling("actions.extend_retention_help"),
                }}
              />
            );
          })()}
        </div>
      </Section>

      <Section title={t("sections.appearance")}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-small text-[hsl(var(--muted-foreground))]">
            {t("appearance_theme_label")}
          </p>
          <ThemeToggle initial={theme} />
        </div>
      </Section>

      <Section title={t("sections.language")}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
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
        <WipeDataSection />
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

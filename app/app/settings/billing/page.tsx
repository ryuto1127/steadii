import { auth } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import { getCreditBalance } from "@/lib/billing/credits";
import { getStorageTotals } from "@/lib/billing/storage";
import { prettyBytes } from "@/lib/format/bytes";
import { getEffectivePlan } from "@/lib/billing/effective-plan";
import { BillingActions } from "@/components/billing/billing-actions";
import { priceLabelsFor } from "@/lib/billing/format-price";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getTranslations, getLocale } from "next-intl/server";

export const dynamic = "force-dynamic";

function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) =>
    k in vars ? String(vars[k]) : `{${k}}`
  );
}

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string; canceled?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;
  const { session_id, canceled } = await searchParams;

  const balance = await getCreditBalance(userId);
  const storage = await getStorageTotals(userId);
  const effective = await getEffectivePlan(userId);
  const [flagsRow] = await db
    .select({
      foundingMember: users.foundingMember,
      grandfatherPriceLockedUntil: users.grandfatherPriceLockedUntil,
      preferredCurrency: users.preferredCurrency,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const t = await getTranslations("billing");
  const locale = await getLocale();
  const dateLocale = locale === "ja" ? "ja-JP" : undefined;
  const currency = flagsRow?.preferredCurrency ?? "usd";

  const planLabel = (() => {
    if (effective.plan === "admin") return t("plan_admin");
    if (effective.plan === "student") {
      return effective.until
        ? fmt(t("plan_student_renews"), {
            date: effective.until.toLocaleDateString(dateLocale),
          })
        : t("plan_student");
    }
    if (effective.plan === "pro" && effective.source === "trial") {
      return fmt(t("plan_pro_trial"), {
        date: effective.until.toLocaleDateString(dateLocale),
      });
    }
    if (effective.plan === "pro") {
      return effective.until
        ? fmt(t("plan_pro_renews"), {
            date: effective.until.toLocaleDateString(dateLocale),
          })
        : t("plan_pro");
    }
    return t("plan_free");
  })();

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-h1">{t("page_title")}</h1>
      <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
        {t("page_subtitle")}
      </p>

      {session_id && (
        <div className="mt-6 rounded-lg bg-[hsl(var(--primary)/0.1)] px-4 py-3 text-sm">
          {t("checkout_completed")}
        </div>
      )}
      {canceled && (
        <div className="mt-6 rounded-lg bg-[hsl(var(--surface-raised))] px-4 py-3 text-sm text-[hsl(var(--muted-foreground))]">
          {t("checkout_canceled")}
        </div>
      )}

      {flagsRow?.foundingMember && (
        <div className="mt-6 flex items-center gap-2 rounded-lg border border-[hsl(var(--primary)/0.3)] bg-[hsl(var(--primary)/0.06)] px-4 py-2.5 text-sm">
          <span aria-hidden>✦</span>
          <span>
            <span className="font-medium text-[hsl(var(--primary))]">
              {t("founding_member_label")}
            </span>{" "}
            {t("founding_member_body")}
          </span>
        </div>
      )}
      {!flagsRow?.foundingMember && flagsRow?.grandfatherPriceLockedUntil && (
        <p className="mt-6 text-xs text-[hsl(var(--muted-foreground))]">
          {fmt(t("price_locked_until"), {
            date: flagsRow.grandfatherPriceLockedUntil.toLocaleDateString(
              dateLocale
            ),
          })}
        </p>
      )}

      {(effective.source === "stripe" || balance.topupRemaining > 0) && (
        <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">
          {fmt(t("currency_locked"), { currency: currency.toUpperCase() })}
        </p>
      )}

      <section className="mt-8 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4">
        <h2 className="text-lg font-medium">{t("current_plan")}</h2>
        <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
          {planLabel}
        </p>

        <div className="mt-5">
          <div className="flex items-baseline justify-between text-sm">
            <span>{t("credits_this_cycle")}</span>
            <span className="font-mono text-xs">
              {balance.used.toLocaleString(dateLocale)} /{" "}
              {balance.limit.toLocaleString(dateLocale)}
              {effective.plan === "admin" && (
                <span className="ml-1 text-[hsl(var(--muted-foreground))]">
                  {t("credits_unlimited")}
                </span>
              )}
            </span>
          </div>
          <Bar
            percent={Math.min(100, (balance.used / balance.limit) * 100)}
            tone={
              effective.plan === "admin"
                ? "primary"
                : balance.exceeded
                ? "destructive"
                : balance.nearLimit
                ? "accent"
                : "primary"
            }
          />
          <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">
            {effective.plan === "admin"
              ? t("admin_quota_unenforced")
              : fmt(t("credits_remaining"), {
                  remaining: balance.remaining.toLocaleString(dateLocale),
                  date: balance.windowEnd.toLocaleDateString(dateLocale, {
                    month: "short",
                    day: "numeric",
                  }),
                })}
          </p>
          {balance.topupRemaining > 0 && (
            <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
              {fmt(t("topup_remaining"), {
                remaining: balance.topupRemaining.toLocaleString(dateLocale),
              })}
            </p>
          )}
        </div>

        <div className="mt-5">
          <div className="flex items-baseline justify-between text-sm">
            <span>{t("storage")}</span>
            <span className="font-mono text-xs">
              {prettyBytes(storage.usedBytes)} /{" "}
              {prettyBytes(storage.maxTotalBytes)}
            </span>
          </div>
          <Bar
            percent={Math.min(
              100,
              (storage.usedBytes / storage.maxTotalBytes) * 100
            )}
            tone={
              storage.usedBytes >= storage.maxTotalBytes
                ? "destructive"
                : storage.usedBytes >= storage.maxTotalBytes * 0.8
                ? "accent"
                : "primary"
            }
          />
        </div>
      </section>

      {(() => {
        const labels = priceLabelsFor(currency);
        return (
          <BillingActions
            effectivePlan={effective.plan}
            currency={currency}
            copy={{
              adminBypass: t("actions.admin_bypass"),
              upgradePro: fmt(t("actions.upgrade_pro"), {
                price: labels.pro_monthly,
              }),
              upgradeStudent: fmt(t("actions.upgrade_student"), {
                price: labels.student_4mo,
              }),
              opening: t("actions.opening"),
              manageSub: t("actions.manage_sub"),
              addCredits: t("actions.add_credits"),
              topup500: fmt(t("actions.topup_500"), {
                price: labels.topup_500,
              }),
              topup2000: fmt(t("actions.topup_2000"), {
                price: labels.topup_2000,
              }),
              topupExpiry: t("actions.topup_expiry"),
              steppingAway: t("actions.stepping_away"),
              extendRetention: fmt(t("actions.extend_retention"), {
                price: labels.data_retention,
              }),
              extendRetentionHelp: t("actions.extend_retention_help"),
            }}
          />
        );
      })()}

      {(effective.plan === "pro" || effective.plan === "student") && (
        <section className="mt-10 border-t border-[hsl(var(--border))] pt-6">
          <a
            href="/app/settings/billing/cancel"
            className="text-xs text-[hsl(var(--muted-foreground))] underline-offset-2 hover:text-[hsl(var(--foreground))] hover:underline"
          >
            {t("cancel_subscription")}
          </a>
        </section>
      )}
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
      ? "hsl(var(--primary))"
      : "hsl(var(--primary))";
  return (
    <div className="mt-2 h-2 overflow-hidden rounded-full bg-[hsl(var(--surface-raised))]">
      <div
        className="h-full rounded-full transition-all"
        style={{
          width: `${Math.max(0, Math.min(100, percent))}%`,
          backgroundColor: color,
        }}
      />
    </div>
  );
}

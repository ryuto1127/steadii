import "server-only";
import { env } from "@/lib/env";
import type { NextRequest } from "next/server";
import { detectLocaleFromAcceptLanguage } from "@/lib/i18n/config";

export type SupportedCurrency = "usd" | "jpy";

// Locale → currency default. Only `ja` maps to JPY; everything else falls
// through to USD. Any user can override at checkout-time via the explicit
// `currency` body param, and the choice is then pinned via `users.
// preferred_currency` so subsequent top-ups stay in the same currency
// (Stripe Subscriptions are mono-currency — switching mid-flow would create
// an orphan customer object in the wrong currency).
export function currencyForLocale(locale: string | null | undefined): SupportedCurrency {
  return locale === "ja" ? "jpy" : "usd";
}

type ResolveArgs = {
  explicit: SupportedCurrency | undefined;
  persisted: SupportedCurrency | null;
  request: NextRequest;
};

export async function resolveCheckoutCurrency({
  explicit,
  persisted,
  request,
}: ResolveArgs): Promise<SupportedCurrency> {
  if (explicit === "usd" || explicit === "jpy") return explicit;
  if (persisted === "usd" || persisted === "jpy") return persisted;
  // First-checkout path: derive from the user's locale cookie (set by the
  // app shell when they switch language) or fall back to Accept-Language.
  const cookieLocale = request.cookies.get("steadii-locale")?.value;
  if (cookieLocale === "ja" || cookieLocale === "en") {
    return currencyForLocale(cookieLocale);
  }
  const acceptLang = request.headers.get("accept-language");
  return currencyForLocale(detectLocaleFromAcceptLanguage(acceptLang));
}

type PriceArgs = {
  tier: "pro" | "student";
  interval: "monthly" | "yearly" | "four_month";
  currency: SupportedCurrency;
};

// Stripe price-ID lookup keyed by (tier, interval, currency). Returns a
// reason for the route to surface when the matching env var hasn't been
// populated yet (catalog not synced for that currency).
export function priceIdForPlan({
  tier,
  interval,
  currency,
}: PriceArgs): { priceId: string | null; reason?: string } {
  const e = env();
  if (tier === "student") {
    if (interval !== "four_month") {
      return {
        priceId: null,
        reason: "Student plan only supports four_month interval",
      };
    }
    const id =
      currency === "jpy" ? e.STRIPE_PRICE_STUDENT_4MO_JPY : e.STRIPE_PRICE_STUDENT_4MO;
    if (!id) {
      return {
        priceId: null,
        reason:
          currency === "jpy"
            ? "STRIPE_PRICE_STUDENT_4MO_JPY not configured"
            : "STRIPE_PRICE_STUDENT_4MO not configured",
      };
    }
    return { priceId: id };
  }
  // Pro tier
  if (interval === "monthly") {
    if (currency === "jpy") {
      if (!e.STRIPE_PRICE_PRO_MONTHLY_JPY) {
        return {
          priceId: null,
          reason: "STRIPE_PRICE_PRO_MONTHLY_JPY not configured",
        };
      }
      return { priceId: e.STRIPE_PRICE_PRO_MONTHLY_JPY };
    }
    // USD: prefer the new env, fall back to legacy STRIPE_PRICE_ID_PRO so
    // existing setups don't break before stripe-setup.ts has been run.
    const id = e.STRIPE_PRICE_PRO_MONTHLY || e.STRIPE_PRICE_ID_PRO;
    if (!id) return { priceId: null, reason: "No Pro Monthly price configured" };
    return { priceId: id };
  }
  if (interval === "yearly") {
    const id =
      currency === "jpy" ? e.STRIPE_PRICE_PRO_YEARLY_JPY : e.STRIPE_PRICE_PRO_YEARLY;
    if (!id) {
      return {
        priceId: null,
        reason:
          currency === "jpy"
            ? "STRIPE_PRICE_PRO_YEARLY_JPY not configured"
            : "STRIPE_PRICE_PRO_YEARLY not configured",
      };
    }
    return { priceId: id };
  }
  return {
    priceId: null,
    reason: `Pro tier does not support ${interval} interval`,
  };
}

type PackArgs = {
  pack: "topup_500" | "topup_2000" | "data_retention";
  currency: SupportedCurrency;
};

export function priceIdForPack({
  pack,
  currency,
}: PackArgs): { priceId: string | null; reason?: string } {
  const e = env();
  switch (pack) {
    case "topup_500": {
      const id =
        currency === "jpy" ? e.STRIPE_PRICE_TOPUP_500_JPY : e.STRIPE_PRICE_TOPUP_500;
      if (!id) {
        return {
          priceId: null,
          reason:
            currency === "jpy"
              ? "STRIPE_PRICE_TOPUP_500_JPY not configured"
              : "STRIPE_PRICE_TOPUP_500 not configured",
        };
      }
      return { priceId: id };
    }
    case "topup_2000": {
      const id =
        currency === "jpy" ? e.STRIPE_PRICE_TOPUP_2000_JPY : e.STRIPE_PRICE_TOPUP_2000;
      if (!id) {
        return {
          priceId: null,
          reason:
            currency === "jpy"
              ? "STRIPE_PRICE_TOPUP_2000_JPY not configured"
              : "STRIPE_PRICE_TOPUP_2000 not configured",
        };
      }
      return { priceId: id };
    }
    case "data_retention": {
      const id =
        currency === "jpy"
          ? e.STRIPE_PRICE_DATA_RETENTION_JPY
          : e.STRIPE_PRICE_DATA_RETENTION;
      if (!id) {
        return {
          priceId: null,
          reason:
            currency === "jpy"
              ? "STRIPE_PRICE_DATA_RETENTION_JPY not configured"
              : "STRIPE_PRICE_DATA_RETENTION not configured",
        };
      }
      return { priceId: id };
    }
  }
}

// Reverse map a price_id to the currency it represents. Used by the webhook
// to pin `users.preferred_currency` from whatever Subscription Stripe tells
// us is now active. Falls back to "usd" for unknown price IDs (legacy
// STRIPE_PRICE_ID_PRO + manual promo prices) so we never silently flip a
// USD-paying user to JPY.
export function currencyFromStripePriceId(
  priceId: string | null
): SupportedCurrency {
  if (!priceId) return "usd";
  const e = env();
  const jpyPrices = new Set(
    [
      e.STRIPE_PRICE_PRO_MONTHLY_JPY,
      e.STRIPE_PRICE_PRO_YEARLY_JPY,
      e.STRIPE_PRICE_STUDENT_4MO_JPY,
      e.STRIPE_PRICE_TOPUP_500_JPY,
      e.STRIPE_PRICE_TOPUP_2000_JPY,
      e.STRIPE_PRICE_DATA_RETENTION_JPY,
    ].filter(Boolean)
  );
  return jpyPrices.has(priceId) ? "jpy" : "usd";
}

// Display formatters for the locale-currency pair. Only the JPY case differs
// meaningfully from a generic Intl.NumberFormat call: yen is zero-decimal
// and our internal copy reads "¥3,000" not "JP¥3,000". Keep the strings
// hard-coded against the locked anchors in memory/project_decisions.md so
// marketing copy stays in lockstep with the env vars.

export type SupportedCurrency = "usd" | "jpy";

export type PriceLabels = {
  pro_monthly: string;
  pro_yearly: string;
  student_4mo: string;
  topup_500: string;
  topup_2000: string;
  data_retention: string;
};

const USD: PriceLabels = {
  pro_monthly: "$20/mo",
  pro_yearly: "$192/yr",
  student_4mo: "$40 / 4 months",
  topup_500: "$10",
  topup_2000: "$30",
  data_retention: "$10",
};

const JPY: PriceLabels = {
  pro_monthly: "¥3,000/月",
  pro_yearly: "¥28,800/年",
  student_4mo: "¥6,000 / 4ヶ月",
  topup_500: "¥1,500",
  topup_2000: "¥4,500",
  data_retention: "¥1,500",
};

export function priceLabelsFor(currency: SupportedCurrency): PriceLabels {
  return currency === "jpy" ? JPY : USD;
}

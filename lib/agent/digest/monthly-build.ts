import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { env } from "@/lib/env";
import {
  buildMonthlyAggregate,
  type MonthlyAggregate,
} from "./monthly-aggregation";
import {
  synthesizeMonthlyDigest,
  type MonthlySynthesis,
} from "./monthly-synthesis";
import {
  buildMonthlyDigestEmail,
  type MonthlyDigestEmailPayload,
} from "@/lib/email/monthly-digest-template";
import {
  loadPriorMonthSynthesis,
  priorMonthStartInTimezone,
} from "./monthly-picker";

// engineer-50 — Compose the full digest payload for a (user, month).
// Returns null when the user has been soft-deleted or has no email.
//
// The cron consumes this and (a) inserts the row, (b) sends the email,
// (c) creates the Type C card. Tests + the dogfood backdate path also
// invoke this directly for a specific (userId, now) pair.

export type MonthlyDigestBuildResult = {
  userEmail: string;
  aggregate: MonthlyAggregate;
  synthesis: MonthlySynthesis;
  email: MonthlyDigestEmailPayload;
  locale: "en" | "ja";
};

export type BuildArgs = {
  userId: string;
  monthStart: Date;
  monthEnd: Date;
  monthLabel: string;
  timezone: string;
  now: Date;
};

export async function buildMonthlyDigest(
  args: BuildArgs
): Promise<MonthlyDigestBuildResult | null> {
  const [user] = await db
    .select({
      email: users.email,
      preferences: users.preferences,
    })
    .from(users)
    .where(eq(users.id, args.userId))
    .limit(1);
  if (!user || !user.email) return null;
  const locale: "en" | "ja" =
    user.preferences?.locale === "ja" ? "ja" : "en";

  const aggregate = await buildMonthlyAggregate({
    userId: args.userId,
    monthStart: args.monthStart,
    monthEnd: args.monthEnd,
  });

  const priorMonthStart = priorMonthStartInTimezone(args.now, args.timezone);
  const priorRaw = await loadPriorMonthSynthesis(args.userId, priorMonthStart);
  const priorSynthesis =
    priorRaw && typeof priorRaw === "object"
      ? (priorRaw as MonthlySynthesis)
      : null;

  const { synthesis } = await synthesizeMonthlyDigest({
    userId: args.userId,
    locale,
    monthLabel: formatMonthLabel(args.monthLabel, locale),
    aggregate,
    priorSynthesis,
  });

  const appUrl = env().APP_URL;
  const email = buildMonthlyDigestEmail({
    locale,
    monthLabel: formatMonthLabel(args.monthLabel, locale),
    synthesis,
    appUrl,
    // The digest row id isn't known yet — the cron inserts the row and
    // re-renders the in-app link once it has the id. For the email
    // payload, we use a stable index URL that lists prior digests.
    digestIndexUrl: `${appUrl}/app/digests/monthly`,
  });

  return {
    userEmail: user.email,
    aggregate,
    synthesis,
    email,
    locale,
  };
}

// Render a 2026-04 ISO month key in the user's locale. "April 2026" for
// en, "2026年4月" for ja. The aggregator passes the raw ISO month key,
// the synthesis prompt + email template render it.
export function formatMonthLabel(
  isoMonthKey: string,
  locale: "en" | "ja"
): string {
  const m = /^(\d{4})-(\d{2})$/.exec(isoMonthKey);
  if (!m) return isoMonthKey;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (locale === "ja") return `${year}年${month}月`;
  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  return `${monthNames[month - 1]} ${year}`;
}

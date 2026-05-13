import {
  index,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "@/lib/db/schema";

// engineer-50 — Self-contained pgTable definition for `monthly_digests`.
//
// Lives outside `lib/db/schema.ts` so the engineer-50 deliverable is
// merge-isolated from engineer-49's in-flight schema additions. Sparring
// will fold this into `lib/db/schema.ts` post-merge if/when collapsing
// the two PRs into a single source-of-truth file is desired; until
// then, Drizzle treats `pgTable()` calls as additive regardless of file
// location, and the migration SQL (`0041_monthly_digests.sql`) creates
// the table directly so the runtime contract holds.
//
// `aggregate` and `synthesis` are jsonb columns. Their TypeScript shapes
// live in lib/agent/digest/monthly-aggregation.ts (MonthlyAggregate)
// and monthly-synthesis.ts (MonthlySynthesis). Defensive parsing
// happens at the synthesis layer (parseSynthesisResponse) so reads from
// the page can trust the shape without casting.

export const monthlyDigests = pgTable(
  "monthly_digests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    monthStart: timestamp("month_start", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    aggregate: jsonb("aggregate").notNull(),
    synthesis: jsonb("synthesis").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true, mode: "date" }),
    readAt: timestamp("read_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userMonthIdx: uniqueIndex("monthly_digests_user_month_idx").on(
      t.userId,
      t.monthStart
    ),
    // engineer-50 — index marker kept for future queries by recency.
    // Currently the index page orders by month_start desc with limit 24,
    // which the userMonthIdx (user_id, month_start) covers for filtered
    // scans. Drop this when the table grows past 50K rows / user.
    userCreatedIdx: index("monthly_digests_user_created_idx").on(
      t.userId,
      t.createdAt
    ),
  })
);

export type MonthlyDigestRow = typeof monthlyDigests.$inferSelect;
export type NewMonthlyDigestRow = typeof monthlyDigests.$inferInsert;

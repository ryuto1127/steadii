-- engineer-50 — CoS-mode monthly strategic digest persistence.
--
-- One row per (user, month) holding both the raw aggregate (typed JSON
-- pulled from email / calendar / assignments / chats / proactive
-- proposals / drift signals) and the LLM synthesis (themes /
-- recommendations / drift callouts) that's rendered into the email +
-- in-app page.
--
-- The cron computes month boundaries in the user's local timezone, so
-- month_start is stored as a `date`-mode timestamptz at 00:00 local —
-- the unique index on (user_id, month_start) keeps re-runs idempotent.
--
-- Manual migration after merge per memory feedback_prod_migration_manual.md.

CREATE TABLE IF NOT EXISTS "monthly_digests" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "month_start" timestamp with time zone NOT NULL,
        "aggregate" jsonb NOT NULL,
        "synthesis" jsonb NOT NULL,
        "sent_at" timestamp with time zone,
        "read_at" timestamp with time zone,
        "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "monthly_digests_user_month_idx" ON "monthly_digests" USING btree ("user_id", "month_start");

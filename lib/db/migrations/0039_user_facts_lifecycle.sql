-- engineer-48 — user_facts lifecycle metadata.
--
-- Mem0 best-practice: facts have different lifecycles. A location is
-- multi-year stable; a semester schedule expires in ~4 months; a
-- communication_style fact slow-decays from disuse. Without lifecycle
-- columns, engineer-47's flat list pollutes the prompt forever (stale
-- facts crowd out useful ones) and never re-confirms aging beliefs.
--
-- Columns:
--   expires_at           hard cutoff; NULL = no expiry. getActiveUserFacts
--                        excludes any row with expires_at < now().
--   next_review_at       when the daily user-fact-review cron should
--                        surface a Type F card asking the user to
--                        confirm / edit / delete. NULL = never auto-review.
--   reviewed_at          last time the user explicitly confirmed the
--                        fact (cron Confirm action, settings re-save, or
--                        save_user_fact re-call). Recomputes next_review_at.
--   decay_half_life_days for communication_style etc. — soft signal
--                        loaders can use to weight stale facts lower
--                        without dropping them. NULL = no decay.
--
-- Defaults filled at save_user_fact / settings upsert time per category
-- matrix (see lib/agent/user-facts-lifecycle.ts). Existing rows get
-- NULLs (no-expiry, no-review, no-decay) which is the safe behavior —
-- they continue to inject indefinitely until the user re-saves them.
--
-- Manual migration after merge per memory feedback_prod_migration_manual.md.

ALTER TABLE "user_facts" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_facts" ADD COLUMN "next_review_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_facts" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_facts" ADD COLUMN "decay_half_life_days" integer;--> statement-breakpoint
CREATE INDEX "user_facts_next_review_idx" ON "user_facts" USING btree ("next_review_at") WHERE "deleted_at" IS NULL AND "next_review_at" IS NOT NULL;

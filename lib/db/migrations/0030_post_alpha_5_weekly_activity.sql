-- Post-α #5 — Weekly retrospective digest + Activity page
-- Adds:
--   users.weekly_digest_enabled         — Settings toggle. Defaults true (retention hook ON for α).
--   users.weekly_digest_dow_local       — 0=Sun..6=Sat. Default 0 (Sunday).
--   users.weekly_digest_hour_local      — 0..23. Default 17 (5pm local).
--   users.last_weekly_digest_sent_at    — picker uses this + 6-day gap to dedupe ticks.

ALTER TABLE "users" ADD COLUMN "weekly_digest_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "weekly_digest_dow_local" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "weekly_digest_hour_local" smallint DEFAULT 17 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_weekly_digest_sent_at" timestamp with time zone;

-- Wave 5 — auto-archive low-risk + launch prep
-- Adds:
--   inbox_items.triage_confidence       — classifier confidence in [0..1]
--   inbox_items.auto_archived           — true when this row was archived by Tier-1 rule, not user
--   inbox_items.user_restored_at        — set when user manually restores a previously auto-archived item
--   users.auto_archive_enabled          — Settings toggle. Defaults via env AUTO_ARCHIVE_DEFAULT_ENABLED for new signups.
--   users.gmail_token_revoked_at        — set when refresh fails with invalid_grant; clears on re-auth
--   users.onboarding_skip_recovery_dismissed_at — user dismissed the post-skip integrations re-prompt banner
--   cron_heartbeats                     — one row per cron name; each cron updates last_tick_at to detect missed ticks

ALTER TABLE "inbox_items" ADD COLUMN "triage_confidence" real;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD COLUMN "auto_archived" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD COLUMN "user_restored_at" timestamp with time zone;--> statement-breakpoint

ALTER TABLE "users" ADD COLUMN "auto_archive_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "gmail_token_revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "onboarding_skip_recovery_dismissed_at" timestamp with time zone;--> statement-breakpoint

CREATE INDEX "inbox_items_user_auto_archived_idx" ON "inbox_items" USING btree ("user_id","auto_archived","received_at") WHERE "deleted_at" IS NULL AND "auto_archived" = true;--> statement-breakpoint

CREATE TABLE "cron_heartbeats" (
	"name" text PRIMARY KEY NOT NULL,
	"last_tick_at" timestamp with time zone NOT NULL,
	"last_status" text DEFAULT 'ok' NOT NULL,
	"last_duration_ms" integer,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

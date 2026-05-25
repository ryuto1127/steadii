-- 2026-05-21 — Phase 5 of α-auto-cal. Adds a `kind` discriminator so
-- the auto_created_calendar_events table holds both:
--   - 'mutual_agreement' (Phase 1-4) — scheduling negotiation closed
--   - 'deadline' (Phase 5) — single-mention deadline in an inbound mail
--
-- Both share the same lifecycle (provisional → confirmed/cancelled),
-- the same Type G UI surface, and the same Phase 4 grace cron — only
-- the detection trigger + calendar event shape differ.
--
-- The unique index is updated to include `kind` so a single inbox_item
-- can produce one of each kind (e.g., a recruiter mail that BOTH
-- confirms a slot AND mentions a separate "資料は 5/30 までに提出ください"
-- deadline).
--
-- Manual application post-merge per memory feedback_prod_migration_manual.md.

ALTER TABLE "auto_created_calendar_events"
  ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'mutual_agreement';
--> statement-breakpoint

-- Drop the old (user_id, inbox_item_id) unique index and recreate with
-- `kind` included. The `IF EXISTS` keeps this re-runnable.
DROP INDEX IF EXISTS "auto_created_calendar_events_active_unique_idx";
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "auto_created_calendar_events_active_unique_idx"
  ON "auto_created_calendar_events"("user_id", "inbox_item_id", "kind")
  WHERE "status" != 'cancelled';

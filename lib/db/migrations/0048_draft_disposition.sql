-- 2026-05-24 (PR 3) — 3-way disposition on Type B Draft queue cards.
--
-- Adds two columns to agent_drafts:
--   disposition  text  ('active' | 'resolved' | 'skipped' | 'ignored')
--   skipped_at   timestamptz  (set only when transitioning to 'skipped')
--
-- This is an ORTHOGONAL lifecycle dimension layered on top of the
-- existing `status` column. `status` still records WHAT happened to
-- the draft (sent / dismissed / superseded_by_user_send / etc.).
-- `disposition` records the USER'S INTENT on the queue card so the
-- new 3-button row (対応済み / スキップ / 無視中) can write a single
-- canonical signal without coupling to status' broader semantics.
--
-- Backfill rules:
--   - rows whose status indicates "user already dealt with this"
--     (sent / sent_pending / dismissed / superseded_by_user_send /
--     approved) → disposition='resolved'
--   - inbox_items.auto_archived (Wave 5 Tier-1 archive) on the parent
--     inbox row → disposition='resolved' for any draft hanging off it
--   - everything else (pending / edited / paused / expired) →
--     disposition='active' (the column default)
--
-- Legacy columns are NOT dropped. Cleanup belongs in a future PR
-- after prod validates the disposition reads.
--
-- Indexes:
--   agent_drafts_user_disposition_idx — partial on disposition='active',
--     supports the queue read query path.
--   agent_drafts_skipped_at_idx — partial on disposition='skipped' AND
--     skipped_at IS NOT NULL, supports the master-sweep 24h re-surface.
--
-- Manual application post-merge per memory feedback_prod_migration_manual.md.

ALTER TABLE "agent_drafts"
  ADD COLUMN IF NOT EXISTS "disposition" text NOT NULL DEFAULT 'active';
--> statement-breakpoint

ALTER TABLE "agent_drafts"
  ADD COLUMN IF NOT EXISTS "skipped_at" timestamp with time zone;
--> statement-breakpoint

-- Backfill 1: drafts that were already in a terminal "user dealt with it"
-- status. The set covers explicit sends (sent / sent_pending / approved),
-- explicit dismisses (dismissed), and Gmail-direct auto-resolve
-- (superseded_by_user_send). Idempotent — re-running flips nothing.
UPDATE "agent_drafts"
  SET "disposition" = 'resolved'
  WHERE "disposition" = 'active'
    AND "status" IN ('sent', 'sent_pending', 'approved', 'dismissed', 'superseded_by_user_send');
--> statement-breakpoint

-- Backfill 2: any draft whose parent inbox row was auto-archived by
-- the Wave 5 Tier-1 sweep. Those rows were never going to surface in
-- the queue again anyway; marking them resolved keeps the disposition
-- model coherent for analytics.
UPDATE "agent_drafts" AS d
  SET "disposition" = 'resolved'
  WHERE "disposition" = 'active'
    AND EXISTS (
      SELECT 1 FROM "inbox_items" AS i
      WHERE i."id" = d."inbox_item_id"
        AND i."auto_archived" = true
    );
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "agent_drafts_user_disposition_idx"
  ON "agent_drafts" ("user_id", "disposition", "created_at")
  WHERE "disposition" = 'active';
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "agent_drafts_skipped_at_idx"
  ON "agent_drafts" ("skipped_at")
  WHERE "disposition" = 'skipped' AND "skipped_at" IS NOT NULL;

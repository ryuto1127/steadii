-- 2026-05-24 — Round 4 of post-α consent-first conversion. Converts
-- the Wave 5 Tier-1 auto-archive flow from act-first (silently flip
-- status='archived' + auto_archived=true) to propose-confirm: the
-- detector now stamps proposed_archive_at, a Type-H queue card asks
-- the user to confirm, and only the user's explicit click flips the
-- row to archived. Per project_consent_first_principle.md lock.
--
-- Pre-PR flow (legacy):
--   detector → eligibility gates → silent UPDATE inbox_items SET
--   status='archived', auto_archived=true → audit_log 'auto_archive'.
--   The user never saw the message; it just vanished.
--
-- Post-PR flow:
--   detector → eligibility gates → UPDATE inbox_items SET
--   proposed_archive_at=now(), proposed_archive_reason='...' →
--   audit_log 'auto_archive_proposed'. Row stays visible in inbox
--   with a "proposed for archive" indicator. A Type-H queue card
--   batches all currently-proposed items per user. User confirms →
--   THEN the status='archived', auto_archived=true flip + audit_log
--   'auto_archive' row. User dismisses → proposed_archive_at
--   cleared, item stays visible. 7-day expiry sweep also clears
--   stale proposals without archiving.
--
-- Schema impact:
--   - inbox_items.proposed_archive_at  timestamptz nullable
--   - inbox_items.proposed_archive_reason  text nullable
--   - inbox_user_proposed_archive_idx  partial index on
--     (user_id, proposed_archive_at) WHERE proposed_archive_at IS NOT NULL.
--     Drives the queue-card batch query + 7-day expiry sweep.
--
-- Per failure-mode `MIGRATION_JOURNAL_DRIFT`: journal entry
-- registered with when > 1779600000000 (idx 49's value); statement
-- breakpoints separate every top-level statement; this comment
-- block does NOT contain the literal breakpoint marker (per
-- `MIGRATION_BREAKPOINT_IN_COMMENT`).
--
-- Manual application post-merge per memory feedback_prod_migration_manual.md.

ALTER TABLE "inbox_items"
  ADD COLUMN IF NOT EXISTS "proposed_archive_at" timestamp with time zone;
--> statement-breakpoint

ALTER TABLE "inbox_items"
  ADD COLUMN IF NOT EXISTS "proposed_archive_reason" text;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "inbox_user_proposed_archive_idx"
  ON "inbox_items" ("user_id", "proposed_archive_at")
  WHERE "proposed_archive_at" IS NOT NULL;

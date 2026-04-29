ALTER TABLE "users" ALTER COLUMN "undo_window_seconds" SET DEFAULT 10;--> statement-breakpoint
-- Backfill existing rows that still hold the old default (20). Users who
-- have customized via Settings → Notifications (10-60 slider) keep their
-- value; only rows still on the historical default get migrated to the
-- new default.
UPDATE "users" SET "undo_window_seconds" = 10 WHERE "undo_window_seconds" = 20;
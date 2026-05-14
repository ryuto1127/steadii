-- engineer-58 — tab-close resilience for chat agent runs.
--
-- Adds a `status` column to messages so the UI can tell whether an
-- assistant row is still being written (the agent is mid-loop), has
-- completed normally, or errored out. The orchestrator sets
-- 'processing' on insert, 'done' on normal completion, 'error' on
-- throw. Existing rows default to 'done' since any pre-engineer-58
-- run that landed in the DB is by definition complete.
--
-- Status vocabulary (subset enforced by the orchestrator):
--   'pending'    — reserved for future queued-but-not-started runs.
--   'processing' — agent loop is currently writing to this row.
--   'done'       — terminal: agent loop completed (incl. pause-for-
--                  confirmation, since the assistant turn is fully
--                  written when the agent pauses for user input).
--   'error'      — terminal: orchestrator threw.
--   'cancelled'  — reserved; not currently emitted but available for
--                  future explicit-cancel UX.
--
-- Additive migration — no backfill needed beyond the default. Manual
-- application post-merge per memory feedback_prod_migration_manual.md.

ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'done';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_status_processing_idx" ON "messages" ("status") WHERE "status" = 'processing';

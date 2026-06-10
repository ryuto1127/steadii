-- Stripe webhook idempotency — processing/done state.
--
-- WHY: the old flow INSERTed the event id into processed_stripe_events
-- BEFORE running routeEvent. If routeEvent threw, Stripe's retry hit the
-- existing row, got acked as a duplicate, and the side effects (top-up
-- fulfillment, subscription upsert, founding-member grant) never ran —
-- permanently. A paid top-up could silently vanish.
--
-- New flow: INSERT (id, 'processing') ON CONFLICT DO NOTHING, then UPDATE
-- to 'done' only after side effects succeed. On a retry that finds a
-- 'processing' row, we re-run; a 'done' row is acked as a true duplicate.
--
-- This column defaults to 'done' so every EXISTING row backfills to the
-- terminal state — those events were already fully processed under the
-- INSERT-first flow, so they must not be re-run.
--
-- Per failure-mode MIGRATION_JOURNAL_DRIFT: the meta snapshot chain is
-- incomplete, so this is hand-written and idempotent (IF NOT EXISTS) to
-- apply cleanly on a prod DB that already holds the table.
--
-- Manual application post-merge per memory feedback_prod_migration_manual.md.

ALTER TABLE "processed_stripe_events"
  ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'done';

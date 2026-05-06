-- engineer-33 — OTP / verification-code time-decay.
--
-- Adds:
--   inbox_items.urgency_expires_at — stamped by the L1 classifier when an
--   OTP / verification-code keyword matches. The urgency-decay sweep job
--   (extension of /api/cron/ingest-sweep) auto-archives the row once
--   now() passes this timestamp.
--
-- The column is additive. Existing rows leave it null and are unaffected.

ALTER TABLE "inbox_items" ADD COLUMN "urgency_expires_at" timestamp with time zone;--> statement-breakpoint

-- Partial index — the sweep query filters on "still pending decay AND not
-- already archived", so the index covers exactly the candidate set. Stays
-- tiny relative to the inbox (only OTP rows stamp this column).
CREATE INDEX "inbox_urgency_decay_idx" ON "inbox_items" USING btree ("urgency_expires_at") WHERE "urgency_expires_at" IS NOT NULL AND "auto_archived" = false;

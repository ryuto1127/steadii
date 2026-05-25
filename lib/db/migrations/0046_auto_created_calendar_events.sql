-- 2026-05-21 — Phase 2 of α-auto-cal.
--
-- Persists the agent's auto-created calendar events so:
--   1. Phase 3 cancel UI can find the event(s) to delete on user request
--   2. Phase 4 grace-cron can promote `[Steadii]`-prefixed events to
--      normal after the 24h grace window
--   3. The evaluator can detect "already created for this inbox_item"
--      and skip (idempotency)
--
-- One row per (user, inbox_item) — the partial unique index below
-- enforces this for non-cancelled rows. Cancelled rows are kept for
-- audit / future learning signal.
--
-- Manual application post-merge per memory feedback_prod_migration_manual.md.

CREATE TYPE auto_created_event_status AS ENUM (
  'provisional', -- created, in 24h grace window
  'confirmed',   -- grace expired, [Steadii] prefix dropped, now a normal event
  'cancelled'    -- user cancelled within grace; calendar event deleted
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "auto_created_calendar_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  -- Originating inbox_item that triggered the auto-create.
  "inbox_item_id" uuid NOT NULL REFERENCES "inbox_items"("id") ON DELETE CASCADE,
  -- Calendar event references — one entry per provider written to.
  -- Shape: [{ provider: 'google_calendar' | 'microsoft_graph', eventId: string, htmlLink: string | null }]
  "event_refs" jsonb NOT NULL DEFAULT '[]',
  "status" auto_created_event_status NOT NULL DEFAULT 'provisional',
  -- Agreed slot the detector identified.
  -- Shape: { date: 'YYYY-MM-DD', startTime: 'HH:MM', timezone: 'IANA', durationMin: number }
  "agreed_slot" jsonb NOT NULL,
  -- Confidence score at create time (auditing).
  "confidence" real NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  -- 24h grace expiry. When now() > grace_expires_at, the cron promotes
  -- status to 'confirmed' and drops the [Steadii] prefix from the
  -- calendar event title.
  "grace_expires_at" timestamp with time zone NOT NULL,
  "cancelled_at" timestamp with time zone
);
--> statement-breakpoint

-- Idempotency: at most one non-cancelled auto-create per inbox_item.
-- Cancelled rows are allowed to coexist (audit trail of past attempts).
CREATE UNIQUE INDEX IF NOT EXISTS "auto_created_calendar_events_active_unique_idx"
  ON "auto_created_calendar_events"("user_id", "inbox_item_id")
  WHERE "status" != 'cancelled';
--> statement-breakpoint

-- For the Phase 4 grace cron: cheap lookup of provisional rows past their
-- grace window.
CREATE INDEX IF NOT EXISTS "auto_created_calendar_events_grace_idx"
  ON "auto_created_calendar_events"("status", "grace_expires_at")
  WHERE "status" = 'provisional';

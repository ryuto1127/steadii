-- engineer-43 — Queue UX wave (pre-brief reach + Type C summary + Gmail Push).
--
-- Adds:
--   users.gmail_watch — jsonb { historyId, expiresAt, setupAt } persisted
--     by lib/integrations/google/gmail-watch.ts after a successful
--     gmail.users.watch() call. Refreshed by the daily
--     /api/cron/gmail-watch-refresh cron because Gmail enforces a 7-day
--     TTL on every watch. Nullable: users without Gmail-scope or those
--     who haven't been onboarded onto Push yet leave it null.
--   inbox_items.gmail_read_at — timestamptz mirroring the UNREAD label
--     state from Gmail. Set to now() when a Pub/Sub push reports
--     labelRemoved 'UNREAD' (user read), cleared to null when
--     labelAdded 'UNREAD' (user marked-unread). Drives the queue Type
--     C read-state filter (lib/agent/queue/build.ts).
--   agent_drafts.short_summary — text, 1–2 sentence content summary the
--     deep pass writes for action='notify_only'. Surfaces in the queue
--     Type C card body in place of the generic "Important from
--     {sender}" copy. Null on other actions and on legacy rows.
--
-- Manual migration after merge per memory feedback_prod_migration_manual.md.
-- Journal entry 36 added alongside per engineer-39 incident.

ALTER TABLE "users" ADD COLUMN "gmail_watch" jsonb;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD COLUMN "gmail_read_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_drafts" ADD COLUMN "short_summary" text;

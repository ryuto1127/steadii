-- 2026-05-24 — Round 5 of post-α consent-first conversion. Converts
-- the Wave 5 / PR #304 draft auto-resolve flow (Gmail-direct reply
-- detector → silent flip to status='superseded_by_user_send' +
-- disposition='resolved') from silent state-flip to notify-with-undo.
--
-- WHY a new generic table rather than ad-hoc columns:
--   The notify-with-undo pattern is conceptually different from the
--   propose-confirm flows shipped in Rounds 3 + 4. The state change is
--   reactive cleanup of a user action that ALREADY happened (the
--   Gmail-direct send) — pre-confirming "can I clean up?" is
--   heavyweight. Instead we record an in-app notification with a
--   24-hour reversibility window, surface it in the activity feed
--   (and optionally a one-shot toast), and let the user click [元に
--   戻す] to revert if our detection was wrong.
--
--   The table is intentionally generic — `kind` text + (subject_table,
--   subject_id) foreign-key shape — so future auto-actions or system
--   messages can hang off the same surface without re-litigating the
--   schema. This PR only wires the `auto_resolved_draft` kind.
--
-- Schema:
--   agent_notifications
--     id              uuid pk
--     user_id         uuid FK users(id) ON DELETE CASCADE
--     kind            text NOT NULL  ('auto_resolved_draft' for this PR)
--     subject_table   text NOT NULL  ('agent_drafts')
--     subject_id      uuid NOT NULL  (logical FK; not enforced because
--                                     the table varies by kind)
--     summary         text NOT NULL  (short human-readable description
--                                     for activity feed)
--     created_at      timestamptz NOT NULL DEFAULT now()
--     undoable_until  timestamptz nullable  (NULL → undo unavailable:
--                                            user clicked Undo, action
--                                            irreversible, or cron
--                                            expired the window)
--     dismissed_at    timestamptz nullable  (set when user explicitly
--                                            dismisses OR after Undo)
--
-- Indexes:
--   agent_notifications_user_undoable_idx — partial on the read path
--     for the activity feed undo-button check + the one-shot toast
--     probe. Filters `undoable_until IS NOT NULL` so the candidate
--     set is small.
--   agent_notifications_user_created_idx — supports the chronological
--     fetch on /app/activity (full timeline, undo-button column may
--     be hidden but the row still renders).
--   agent_notifications_expiry_idx — drives the notification-expiry
--     sub-sweep predicate (`undoable_until < now()`). Tight partial
--     index over the same NOT NULL set.
--
-- Per failure-mode `MIGRATION_JOURNAL_DRIFT`: journal entry registered
-- with when > 1779700000000 (idx 50's value); statement breakpoints
-- separate every top-level statement; this comment block does NOT
-- contain the literal breakpoint marker (per
-- `MIGRATION_BREAKPOINT_IN_COMMENT`).
--
-- Manual application post-merge per memory feedback_prod_migration_manual.md.

CREATE TABLE IF NOT EXISTS "agent_notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "subject_table" text NOT NULL,
  "subject_id" uuid NOT NULL,
  "summary" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "undoable_until" timestamp with time zone,
  "dismissed_at" timestamp with time zone
);
--> statement-breakpoint

ALTER TABLE "agent_notifications"
  ADD CONSTRAINT "agent_notifications_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "agent_notifications_user_undoable_idx"
  ON "agent_notifications" ("user_id", "created_at")
  WHERE "undoable_until" IS NOT NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "agent_notifications_user_created_idx"
  ON "agent_notifications" ("user_id", "created_at");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "agent_notifications_expiry_idx"
  ON "agent_notifications" ("undoable_until")
  WHERE "undoable_until" IS NOT NULL;

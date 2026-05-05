-- Post-α #6 — Send-queue refactor (delayed-message pattern).
--
-- Replaces the polling cron at /api/cron/send-queue with a per-draft
-- QStash delayed publish whose `delay = users.undo_window_seconds`.
-- The cron is deleted; the send_queue table is KEPT for historical
-- audit until a separate deprecation cycle (≥2 weeks of stable runs).
--
-- agent_drafts gains two columns the new path needs to read:
--   * qstash_message_id — id returned by `qstash().publishJSON(...)`,
--     used by the cancel path to call `messages.delete(messageId)`.
--   * gmail_draft_id — moved off send_queue so the new execute route
--     can resolve the Gmail draft directly from the agent_drafts row
--     it gates on (`status = 'sent_pending'`).
--
-- Both columns nullable: legacy rows that pre-date this migration
-- never had a qstash message; the column reads null and the cancel
-- path skips the QStash call.

ALTER TABLE "agent_drafts" ADD COLUMN "qstash_message_id" text;--> statement-breakpoint
ALTER TABLE "agent_drafts" ADD COLUMN "gmail_draft_id" text;--> statement-breakpoint

-- Backfill the existing in-flight rows so the cancel + execute paths
-- can read gmail_draft_id off agent_drafts directly. Only `pending` /
-- `processing` rows still matter; `sent` / `cancelled` / `failed` are
-- terminal and don't need the column. The qstash_message_id stays
-- null for these — they'll drain via the legacy cron one last time
-- before the cron route is removed in this same PR. (Deploy when the
-- queue is naturally empty; any in-flight rows after deploy never
-- promote to sent.)
UPDATE "agent_drafts" d
SET "gmail_draft_id" = q."gmail_draft_id"
FROM "send_queue" q
WHERE q."agent_draft_id" = d."id"
  AND q."status" IN ('pending', 'processing');

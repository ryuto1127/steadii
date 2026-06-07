-- 今後この送信者を無視 — per-user permanent sender ignore list.
--
-- WHY a dedicated table rather than reusing agent_rules:
--   agent_rules carries risk_tier / sender_role / bucket semantics and a
--   soft-delete lifecycle tuned for the learned-classification surface.
--   The ignore list is a single boolean intent ("never show me this
--   sender again") with its own origin provenance (which affordance the
--   user used) and a hard delete on un-ignore. Keeping it separate keeps
--   the L1 lookup a tight set-membership probe and avoids overloading the
--   rules table's enabled/deleted_at gating.
--
-- Scope is EMAIL-EXACT for the MVP. The `scope` column is reserved so a
-- future 'domain' variant can be added without a value-shape migration;
-- only 'email' is written today (over-blocking risk: a noisy newsletter
-- must not silence a professor on the same university domain).
--
-- Schema:
--   agent_ignored_senders
--     id            uuid pk
--     user_id       uuid FK users(id) ON DELETE CASCADE
--     sender_email  text NOT NULL  (normalized lowercase + trimmed)
--     scope         text NOT NULL DEFAULT 'email'  ('email' only for MVP)
--     source        text NOT NULL  ('dismiss_followup' | 'quick_menu' |
--                                   'manual')
--     created_at    timestamptz NOT NULL DEFAULT now()
--
-- Indexes:
--   agent_ignored_senders_user_sender_unique — keys the upsert so
--     re-ignoring a sender is idempotent (ON CONFLICT DO NOTHING).
--   agent_ignored_senders_user_idx — supports the L1 buildUserContext
--     bulk load + the settings-page list, both scoped by user_id.
--
-- Per failure-mode MIGRATION_JOURNAL_DRIFT (PR #314 / #316): the meta
-- snapshot chain (0028-0051) is not committed, so `drizzle-kit generate`
-- re-emits the whole schema. This migration is hand-written with
-- IF NOT EXISTS so it applies cleanly on a prod DB that already holds
-- every prior table. Journal entry registered with when > idx 51's value.
-- Per MIGRATION_BREAKPOINT_IN_COMMENT this block deliberately avoids the
-- literal breakpoint marker that the neon-http splitter string-matches on.
--
-- Manual application post-merge per memory feedback_prod_migration_manual.md.

CREATE TABLE IF NOT EXISTS "agent_ignored_senders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL,
  "sender_email" text NOT NULL,
  "scope" text NOT NULL DEFAULT 'email',
  "source" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

ALTER TABLE "agent_ignored_senders"
  ADD CONSTRAINT "agent_ignored_senders_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "agent_ignored_senders_user_sender_unique"
  ON "agent_ignored_senders" ("user_id", "sender_email");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "agent_ignored_senders_user_idx"
  ON "agent_ignored_senders" ("user_id");

-- 2026-05-19 — Task intent metadata.
--
-- Persists the result of the intent classifier (lib/agent/intent-
-- classifier.ts) per external task, so the UI can render smart-action
-- affordances without re-classifying on every page render. Also caches
-- the pre-fetched context (e.g., latest email subject + snippet for a
-- DRAFT_EMAIL_REPLY task) so opening the task is zero-latency.
--
-- Source enum: 'google_tasks' | 'microsoft_todo' for now. A third value
-- 'steadii' could be added once Steadii's own internal task / to-do
-- surface (separate from the assignments table) lands.
--
-- Classifier version: bump when the classifier logic changes so existing
-- rows can be detected as stale and re-classified opportunistically.
-- Phase 1 = "v1".
--
-- Manual application post-merge per memory feedback_prod_migration_manual.md.

CREATE TABLE IF NOT EXISTS "task_intent_metadata" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "source" text NOT NULL,
  "external_id" text NOT NULL,
  "title" text NOT NULL,
  "intent" text NOT NULL,
  "confidence" real NOT NULL,
  "matched_pattern" text,
  "matched_entity_id" uuid REFERENCES "entities"("id") ON DELETE SET NULL,
  "matched_class_code" text,
  "preview" jsonb,
  "title_hash" text NOT NULL,
  "classifier_version" text NOT NULL,
  "classified_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "task_intent_metadata_uk"
  ON "task_intent_metadata" ("user_id", "source", "external_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_intent_metadata_user_idx"
  ON "task_intent_metadata" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_intent_metadata_user_intent_idx"
  ON "task_intent_metadata" ("user_id", "intent")
  WHERE "intent" != 'OTHER';

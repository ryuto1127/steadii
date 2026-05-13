-- engineer-47 — user_facts (persistent facts the agent remembers about
-- the user across chat sessions).
--
-- Sibling to agent_contact_personas.structured_facts (per-contact typed
-- facts shipped by engineer-41). user_facts holds per-user free-form
-- sentences the chat agent picked up via the save_user_fact tool — e.g.
-- "I'm in Vancouver", "Don't notify me at night", "Grade 12, UToronto CS
-- in September".
--
-- The chat orchestrator splices the top-12 facts back into the system
-- prompt at session start (ordered by last_used_at DESC). The settings
-- UI under /app/settings/facts lets the user view / edit / soft-delete
-- entries. Soft-unique index on (user_id, fact) makes the save_user_fact
-- tool idempotent on re-saves without manual de-dup logic.
--
-- Manual migration after merge per memory feedback_prod_migration_manual.md.
-- Journal entry 38 added alongside.

CREATE TABLE "user_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"fact" text NOT NULL,
	"category" text,
	"source" text NOT NULL,
	"confidence" real,
	"source_chat_message_id" uuid,
	"source_inbox_item_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "user_facts" ADD CONSTRAINT "user_facts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_facts_user_idx" ON "user_facts" USING btree ("user_id","last_used_at") WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "user_facts_user_fact_unique" ON "user_facts" USING btree ("user_id","fact") WHERE "deleted_at" IS NULL;

-- engineer-41 — Agentic L2.
--
-- Adds:
--   agent_confirmations — surfaces a question to the user (e.g. "I inferred
--     this sender is in JST — correct?"). Engineer-41 writes rows from the
--     queue_user_confirmation tool; engineer-42 builds the Type F card UI
--     that renders them. Status starts 'pending', flips to confirmed /
--     corrected / dismissed when the user resolves it.
--   agent_contact_personas.structured_facts — JSONB blob carrying typed
--     values the agentic L2 can read at classify/draft time without re-
--     parsing the free-form facts[] array. Shape: { timezone: {value,
--     confidence, source, samples, confirmedAt}, response_window_hours:
--     {...}, primary_language: {...} }. Default {} so legacy rows pre-
--     migration read consistently.
--
-- Manual migration after merge per memory feedback_prod_migration_manual.md.
-- Journal entry 35 added alongside per engineer-39 incident.

CREATE TABLE "agent_confirmations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"topic" text NOT NULL,
	"sender_email" text,
	"question" text NOT NULL,
	"inferred_value" text,
	"options" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"resolved_value" text,
	"resolved_at" timestamp with time zone,
	"originating_draft_id" uuid,
	"context" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_confirmations" ADD CONSTRAINT "agent_confirmations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_confirmations" ADD CONSTRAINT "agent_confirmations_originating_draft_id_agent_drafts_id_fk" FOREIGN KEY ("originating_draft_id") REFERENCES "public"."agent_drafts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_confirmations_user_status_idx" ON "agent_confirmations" USING btree ("user_id","status","created_at");--> statement-breakpoint

ALTER TABLE "agent_contact_personas" ADD COLUMN "structured_facts" jsonb DEFAULT '{}'::jsonb NOT NULL;

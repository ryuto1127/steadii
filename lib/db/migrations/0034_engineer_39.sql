-- engineer-39 — secretary quality bump.
--
-- Adds:
--   agent_contact_personas — per-(user, contact) row carrying the LLM-distilled
--     relationship label + up to 8 short factual statements about the contact,
--     populated by the daily persona-learner cron. Surfaces in the L2 fanout
--     ("Contact persona" block) and in Settings → How your agent thinks
--     ("Contacts Steadii has learned about" section). UNIQUE (user_id,
--     contact_email) so the upsert in extractContactPersona has a stable target.
--   agent_drafts.extracted_action_items — JSONB array of structured to-dos the
--     deep pass extracted from the email. Populated by classify-deep, surfaced
--     in DraftDetailsPanel, accepted via acceptDraftActionItemAction.
--   agent_drafts.accepted_action_item_indices — small int[] tracking which
--     action_items have already been accepted (idempotent guard so a
--     double-click on "Add to my tasks" doesn't dup the assignment / Google Task).
--   agent_drafts.pre_send_warnings — JSONB array of warnings the pre-send
--     fact-checker raised before send. Persisted so the warning modal can
--     re-render after a route refresh, and so analytics can audit how often
--     the check fires.
--
-- Manual migration after merge per memory feedback_prod_migration_manual.md.

CREATE TABLE "agent_contact_personas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"contact_email" text NOT NULL,
	"contact_name" text,
	"relationship" text,
	"facts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_extracted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_contact_personas_user_email_uniq" UNIQUE ("user_id","contact_email")
);
--> statement-breakpoint
ALTER TABLE "agent_contact_personas" ADD CONSTRAINT "agent_contact_personas_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_contact_personas_user_extracted_idx" ON "agent_contact_personas" USING btree ("user_id","last_extracted_at");--> statement-breakpoint

ALTER TABLE "agent_drafts" ADD COLUMN "extracted_action_items" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_drafts" ADD COLUMN "accepted_action_item_indices" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_drafts" ADD COLUMN "pre_send_warnings" jsonb DEFAULT '[]'::jsonb NOT NULL;

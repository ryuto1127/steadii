-- engineer-46 — chat-driven Type E resolution.
--
-- Adds `chats.clarifying_draft_id` (nullable uuid → agent_drafts.id, ON
-- DELETE SET NULL). Set when a chat session is opened from a Type E
-- queue card via the "Steadii と話す" button. The orchestrator reads
-- this column to (a) prepend a clarification-context block to the
-- system prompt and (b) gate availability of the resolve_clarification
-- tool to only clarification sessions. SET NULL on delete because the
-- chat retains audit value even after the originating draft row is
-- gone.
--
-- Partial index keeps the lookup column cheap: only chats opened from a
-- clarifying card need to be matchable back to their draft.
--
-- Manual migration after merge per memory feedback_prod_migration_manual.md.
-- Journal entry 37 added alongside.

ALTER TABLE "chats" ADD COLUMN "clarifying_draft_id" uuid;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_clarifying_draft_id_agent_drafts_id_fk" FOREIGN KEY ("clarifying_draft_id") REFERENCES "public"."agent_drafts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chats_clarifying_draft_idx" ON "chats" USING btree ("clarifying_draft_id") WHERE "clarifying_draft_id" IS NOT NULL;

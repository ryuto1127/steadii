-- engineer-38 — edit-delta capture for the writing-style learner.
--
-- Adds:
--   agent_drafts.original_draft_body — the LLM's first draft body, frozen at
--     L2 time. Stays untouched even if the user edits draftBody via
--     saveDraftEditsAction. Lets the learner compute (original, final)
--     pairs at send time.
--   agent_sender_feedback.original_draft_body / .edited_body — captured at
--     send time when the user's final body differs from the original.
--     Both nullable: the row only carries the pair when an edit actually
--     occurred (sent without changes leaves both null).
--
-- Manual migration after merge per memory feedback_prod_migration_manual.md.

ALTER TABLE "agent_drafts" ADD COLUMN "original_draft_body" text;--> statement-breakpoint
ALTER TABLE "agent_sender_feedback" ADD COLUMN "original_draft_body" text;--> statement-breakpoint
ALTER TABLE "agent_sender_feedback" ADD COLUMN "edited_body" text;

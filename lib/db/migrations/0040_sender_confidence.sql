-- engineer-49 — Per-(user, sender, action) confidence signal.
--
-- Dynamic confirmation thresholds: today's risk tiers are static. If the
-- user has approved 5 drafts in a row from the same sender × action, the
-- next draft of the same shape should bypass the medium-tier confirm and
-- auto-send under the standard 10s undo. Conversely, 3 dismissals on the
-- same sender × action should re-elevate even when L2 says medium.
--
-- Layered on top of the polish-7 `agent_sender_feedback` rows: that table
-- is the raw event log; this one is the rolled-up state machine plus
-- promotion-lock metadata. Independent so a feedback-row write doesn't
-- have to recompute promotion every call.
--
-- learned_confidence is cached on write (recomputed each
-- approve/dismiss/edit/reject) so the L2 fast path doesn't have to recount
-- N rows from agent_sender_feedback on every classify call.
--
-- Manual migration after merge per memory feedback_prod_migration_manual.md.

CREATE TABLE IF NOT EXISTS "sender_confidence" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "sender_email" text NOT NULL,
        "action_type" text NOT NULL,
        "approved_count" integer NOT NULL DEFAULT 0,
        "edited_count" integer NOT NULL DEFAULT 0,
        "dismissed_count" integer NOT NULL DEFAULT 0,
        "rejected_count" integer NOT NULL DEFAULT 0,
        "consecutive_approved_count" integer NOT NULL DEFAULT 0,
        "consecutive_dismissed_count" integer NOT NULL DEFAULT 0,
        "learned_confidence" real NOT NULL DEFAULT 0.5,
        "promotion_state" text NOT NULL DEFAULT 'baseline',
        "promotion_locked_at" timestamp with time zone,
        "promotion_locked_reason" text,
        "last_rejected_at" timestamp with time zone,
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sender_confidence_user_sender_action_idx" ON "sender_confidence" USING btree ("user_id", "sender_email", "action_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sender_confidence_user_promotion_idx" ON "sender_confidence" USING btree ("user_id", "promotion_state");

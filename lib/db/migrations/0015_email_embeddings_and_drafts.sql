-- Phase 6 W2: email_embeddings table + agent_drafts alterations.
-- Requires pgvector (enabled in 0014). Drizzle Kit cannot generate the
-- `vector(1536)` column type or the ivfflat index, so this migration is
-- hand-written; the snapshot is updated by hand to match.

CREATE TABLE "email_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"inbox_item_id" uuid NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"model" text DEFAULT 'text-embedding-3-small' NOT NULL,
	"token_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_embeddings" ADD CONSTRAINT "email_embeddings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_embeddings" ADD CONSTRAINT "email_embeddings_inbox_item_id_inbox_items_id_fk" FOREIGN KEY ("inbox_item_id") REFERENCES "public"."inbox_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_embeddings_inbox_item_unique" ON "email_embeddings" USING btree ("inbox_item_id");--> statement-breakpoint
CREATE INDEX "email_embeddings_user_idx" ON "email_embeddings" USING btree ("user_id");--> statement-breakpoint
-- ivfflat index for cosine-distance search; `lists = 100` is sane for ≤10k
-- rows per α. Re-tune post-α when per-user corpora grow.
CREATE INDEX "email_embeddings_embedding_idx" ON "email_embeddings" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);--> statement-breakpoint

-- agent_drafts: rename classify_usage_id → deep_pass_usage_id, add
-- risk_pass_usage_id + retrieval_provenance + paused_at_step. W1 wrote no
-- rows, so the rename is safe.
ALTER TABLE "agent_drafts" DROP CONSTRAINT "agent_drafts_classify_usage_id_usage_events_id_fk";--> statement-breakpoint
ALTER TABLE "agent_drafts" RENAME COLUMN "classify_usage_id" TO "deep_pass_usage_id";--> statement-breakpoint
ALTER TABLE "agent_drafts" ADD COLUMN "risk_pass_usage_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_drafts" ADD COLUMN "retrieval_provenance" jsonb;--> statement-breakpoint
ALTER TABLE "agent_drafts" ADD COLUMN "paused_at_step" text;--> statement-breakpoint
ALTER TABLE "agent_drafts" ADD CONSTRAINT "agent_drafts_risk_pass_usage_id_usage_events_id_fk" FOREIGN KEY ("risk_pass_usage_id") REFERENCES "public"."usage_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_drafts" ADD CONSTRAINT "agent_drafts_deep_pass_usage_id_usage_events_id_fk" FOREIGN KEY ("deep_pass_usage_id") REFERENCES "public"."usage_events"("id") ON DELETE set null ON UPDATE no action;

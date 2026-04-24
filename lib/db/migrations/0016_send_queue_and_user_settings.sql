CREATE TABLE "send_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"agent_draft_id" uuid NOT NULL,
	"gmail_draft_id" text NOT NULL,
	"send_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"attempted_at" timestamp with time zone,
	"last_error" text,
	"sent_gmail_message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "undo_window_seconds" smallint DEFAULT 20 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "high_risk_notify_immediate" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_gmail_ingest_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_digest_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "send_queue" ADD CONSTRAINT "send_queue_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "send_queue" ADD CONSTRAINT "send_queue_agent_draft_id_agent_drafts_id_fk" FOREIGN KEY ("agent_draft_id") REFERENCES "public"."agent_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "send_queue_status_send_at_idx" ON "send_queue" USING btree ("status","send_at");--> statement-breakpoint
CREATE INDEX "send_queue_user_status_idx" ON "send_queue" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "send_queue_agent_draft_unique" ON "send_queue" USING btree ("agent_draft_id");
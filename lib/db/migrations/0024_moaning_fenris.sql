CREATE TABLE "agent_sender_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"sender_email" text NOT NULL,
	"sender_domain" text NOT NULL,
	"proposed_action" text NOT NULL,
	"user_response" text NOT NULL,
	"inbox_item_id" uuid,
	"agent_draft_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_sender_feedback" ADD CONSTRAINT "agent_sender_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_sender_feedback" ADD CONSTRAINT "agent_sender_feedback_inbox_item_id_inbox_items_id_fk" FOREIGN KEY ("inbox_item_id") REFERENCES "public"."inbox_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_sender_feedback" ADD CONSTRAINT "agent_sender_feedback_agent_draft_id_agent_drafts_id_fk" FOREIGN KEY ("agent_draft_id") REFERENCES "public"."agent_drafts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_sender_feedback_user_sender_idx" ON "agent_sender_feedback" USING btree ("user_id","sender_email");--> statement-breakpoint
CREATE INDEX "agent_sender_feedback_user_domain_idx" ON "agent_sender_feedback" USING btree ("user_id","sender_domain");
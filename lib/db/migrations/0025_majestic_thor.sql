CREATE TABLE "agent_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source" text NOT NULL,
	"source_record_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"analyzed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"trigger_event_id" uuid,
	"issue_type" text NOT NULL,
	"issue_summary" text NOT NULL,
	"reasoning" text NOT NULL,
	"source_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"action_options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"dedup_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"resolved_action" text,
	"resolved_at" timestamp with time zone,
	"viewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_proposals" ADD CONSTRAINT "agent_proposals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_proposals" ADD CONSTRAINT "agent_proposals_trigger_event_id_agent_events_id_fk" FOREIGN KEY ("trigger_event_id") REFERENCES "public"."agent_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_events_user_pending_idx" ON "agent_events" USING btree ("user_id","status","created_at");--> statement-breakpoint
CREATE INDEX "agent_proposals_user_pending_idx" ON "agent_proposals" USING btree ("user_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_proposals_dedup_idx" ON "agent_proposals" USING btree ("user_id","dedup_key");
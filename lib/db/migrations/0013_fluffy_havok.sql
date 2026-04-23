CREATE TABLE "agent_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"inbox_item_id" uuid NOT NULL,
	"classify_model" text,
	"draft_model" text,
	"classify_usage_id" uuid,
	"draft_usage_id" uuid,
	"risk_tier" text NOT NULL,
	"action" text NOT NULL,
	"reasoning" text,
	"draft_subject" text,
	"draft_body" text,
	"draft_to" text[] DEFAULT '{}'::text[] NOT NULL,
	"draft_cc" text[] DEFAULT '{}'::text[] NOT NULL,
	"draft_in_reply_to" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"approved_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"gmail_sent_message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"match_value" text NOT NULL,
	"match_normalized" text NOT NULL,
	"risk_tier" text,
	"bucket" text,
	"sender_role" text,
	"source" text NOT NULL,
	"reason" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "inbox_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_account_id" text NOT NULL,
	"external_id" text NOT NULL,
	"thread_external_id" text,
	"sender_email" text NOT NULL,
	"sender_name" text,
	"sender_domain" text GENERATED ALWAYS AS (split_part(sender_email, '@', 2)) STORED NOT NULL,
	"sender_role" text,
	"recipient_to" text[] DEFAULT '{}'::text[] NOT NULL,
	"recipient_cc" text[] DEFAULT '{}'::text[] NOT NULL,
	"subject" text,
	"snippet" text,
	"received_at" timestamp with time zone NOT NULL,
	"bucket" text NOT NULL,
	"risk_tier" text,
	"rule_provenance" jsonb,
	"first_time_sender" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"reviewed_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "digest_hour_local" smallint DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "digest_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_drafts" ADD CONSTRAINT "agent_drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_drafts" ADD CONSTRAINT "agent_drafts_inbox_item_id_inbox_items_id_fk" FOREIGN KEY ("inbox_item_id") REFERENCES "public"."inbox_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_drafts" ADD CONSTRAINT "agent_drafts_classify_usage_id_usage_events_id_fk" FOREIGN KEY ("classify_usage_id") REFERENCES "public"."usage_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_drafts" ADD CONSTRAINT "agent_drafts_draft_usage_id_usage_events_id_fk" FOREIGN KEY ("draft_usage_id") REFERENCES "public"."usage_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_rules" ADD CONSTRAINT "agent_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_drafts_user_status_idx" ON "agent_drafts" USING btree ("user_id","status","created_at");--> statement-breakpoint
CREATE INDEX "agent_drafts_inbox_item_idx" ON "agent_drafts" USING btree ("inbox_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_rules_user_scope_match_unique" ON "agent_rules" USING btree ("user_id","scope","match_normalized");--> statement-breakpoint
CREATE INDEX "agent_rules_user_scope_enabled_idx" ON "agent_rules" USING btree ("user_id","scope") WHERE enabled = true AND deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_items_external_unique" ON "inbox_items" USING btree ("user_id","source_type","external_id");--> statement-breakpoint
CREATE INDEX "inbox_items_user_status_received_idx" ON "inbox_items" USING btree ("user_id","status","received_at") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "inbox_items_user_bucket_idx" ON "inbox_items" USING btree ("user_id","bucket") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "inbox_items_user_thread_idx" ON "inbox_items" USING btree ("user_id","thread_external_id");
ALTER TABLE "agent_drafts" ADD COLUMN "auto_sent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "autonomy_send_enabled" boolean DEFAULT false NOT NULL;
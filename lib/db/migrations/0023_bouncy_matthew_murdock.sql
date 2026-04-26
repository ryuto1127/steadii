CREATE TABLE "waitlist_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"university" text,
	"reason" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp DEFAULT now() NOT NULL,
	"approved_at" timestamp,
	"email_sent_at" timestamp,
	"google_test_user_added_at" timestamp,
	"signed_in_at" timestamp,
	"approved_by" uuid,
	"notes" text,
	"stripe_promotion_code" text,
	"invite_url" text
);
--> statement-breakpoint
ALTER TABLE "waitlist_requests" ADD CONSTRAINT "waitlist_requests_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_requests_email_unique_idx" ON "waitlist_requests" USING btree ("email");--> statement-breakpoint
CREATE INDEX "waitlist_requests_status_idx" ON "waitlist_requests" USING btree ("status");
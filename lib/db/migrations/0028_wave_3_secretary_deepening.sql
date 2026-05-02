-- Wave 3 — secretary deepening
-- Adds:
--   - users.pre_brief_enabled: cost-gate toggle for the pre-brief LLM generator.
--   - event_pre_briefs: per-event cached briefs surfaced as Type B
--     informational queue cards 15 min before the event.
--   - group_projects + group_project_members + group_project_tasks: tracker
--     for academic group work, with member silence detection.
--   - class_office_hours: structured office-hour slots extracted from
--     the syllabus, used by the office-hours scheduler flow.

ALTER TABLE "users" ADD COLUMN "pre_brief_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint

CREATE TABLE "event_pre_briefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"bullets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"detail_markdown" text,
	"attendee_emails" text[] DEFAULT '{}'::text[] NOT NULL,
	"cache_key" text NOT NULL,
	"usage_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"viewed_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_pre_briefs" ADD CONSTRAINT "event_pre_briefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_pre_briefs" ADD CONSTRAINT "event_pre_briefs_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_pre_briefs" ADD CONSTRAINT "event_pre_briefs_usage_id_usage_events_id_fk" FOREIGN KEY ("usage_id") REFERENCES "public"."usage_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_pre_briefs_user_event_idx" ON "event_pre_briefs" USING btree ("user_id","event_id");--> statement-breakpoint
CREATE INDEX "event_pre_briefs_user_expires_idx" ON "event_pre_briefs" USING btree ("user_id","expires_at");--> statement-breakpoint

CREATE TABLE "group_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"class_id" uuid,
	"title" text NOT NULL,
	"deadline" timestamp with time zone,
	"source_thread_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"detection_method" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "group_projects" ADD CONSTRAINT "group_projects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_projects" ADD CONSTRAINT "group_projects_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "group_projects_user_status_idx" ON "group_projects" USING btree ("user_id","status");--> statement-breakpoint

CREATE TABLE "group_project_members" (
	"group_project_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"role" text,
	"last_responded_at" timestamp with time zone,
	"last_message_at" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_project_members_group_project_id_email_pk" PRIMARY KEY("group_project_id","email")
);
--> statement-breakpoint
ALTER TABLE "group_project_members" ADD CONSTRAINT "group_project_members_group_project_id_group_projects_id_fk" FOREIGN KEY ("group_project_id") REFERENCES "public"."group_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE TABLE "group_project_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"assignee_email" text,
	"due" timestamp with time zone,
	"done_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "group_project_tasks" ADD CONSTRAINT "group_project_tasks_group_project_id_group_projects_id_fk" FOREIGN KEY ("group_project_id") REFERENCES "public"."group_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "group_project_tasks_group_idx" ON "group_project_tasks" USING btree ("group_project_id");--> statement-breakpoint

CREATE TABLE "class_office_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"class_id" uuid NOT NULL,
	"syllabus_id" uuid,
	"professor_email" text,
	"professor_name" text,
	"slots" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"raw_note" text,
	"booking_url" text,
	"extracted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "class_office_hours" ADD CONSTRAINT "class_office_hours_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_office_hours" ADD CONSTRAINT "class_office_hours_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_office_hours" ADD CONSTRAINT "class_office_hours_syllabus_id_syllabi_id_fk" FOREIGN KEY ("syllabus_id") REFERENCES "public"."syllabi"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "class_office_hours_user_class_idx" ON "class_office_hours" USING btree ("user_id","class_id");--> statement-breakpoint

CREATE TABLE "office_hours_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"class_id" uuid,
	"professor_email" text,
	"professor_name" text,
	"topic" text,
	"candidate_slots" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"compiled_questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"picked_slot_index" integer,
	"draft_subject" text,
	"draft_body" text,
	"draft_to" text,
	"sent_message_id" text,
	"sent_event_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "office_hours_requests" ADD CONSTRAINT "office_hours_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_hours_requests" ADD CONSTRAINT "office_hours_requests_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "office_hours_requests_user_status_idx" ON "office_hours_requests" USING btree ("user_id","status");

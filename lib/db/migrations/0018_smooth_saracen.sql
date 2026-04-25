CREATE TABLE "assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"class_id" uuid,
	"title" text NOT NULL,
	"due_at" timestamp with time zone,
	"status" text DEFAULT 'not_started' NOT NULL,
	"priority" text,
	"notes" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"external_id" text,
	"notion_page_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "classes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"term" text,
	"professor" text,
	"color" text,
	"status" text DEFAULT 'active' NOT NULL,
	"notion_page_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "mistake_note_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"mistake_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"chunk_text" text NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"model" text DEFAULT 'text-embedding-3-small' NOT NULL,
	"token_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mistake_note_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mistake_id" uuid NOT NULL,
	"blob_asset_id" uuid,
	"url" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"alt_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mistake_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"class_id" uuid,
	"title" text NOT NULL,
	"unit" text,
	"difficulty" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"body_format" text DEFAULT 'markdown' NOT NULL,
	"body_markdown" text,
	"body_doc" jsonb,
	"source_chat_id" uuid,
	"source_assistant_msg_id" uuid,
	"source_user_question" text,
	"source_explanation" text,
	"notion_page_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "syllabi" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"class_id" uuid,
	"title" text NOT NULL,
	"term" text,
	"grading" text,
	"attendance" text,
	"textbooks" text,
	"office_hours" text,
	"source_url" text,
	"source_kind" text,
	"full_text" text,
	"schedule" jsonb,
	"blob_asset_id" uuid,
	"blob_url" text,
	"blob_filename" text,
	"blob_mime_type" text,
	"blob_size_bytes" integer,
	"notion_page_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "syllabus_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"syllabus_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"chunk_text" text NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"model" text DEFAULT 'text-embedding-3-small' NOT NULL,
	"token_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mistake_note_chunks" ADD CONSTRAINT "mistake_note_chunks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mistake_note_chunks" ADD CONSTRAINT "mistake_note_chunks_mistake_id_mistake_notes_id_fk" FOREIGN KEY ("mistake_id") REFERENCES "public"."mistake_notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mistake_note_images" ADD CONSTRAINT "mistake_note_images_mistake_id_mistake_notes_id_fk" FOREIGN KEY ("mistake_id") REFERENCES "public"."mistake_notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mistake_note_images" ADD CONSTRAINT "mistake_note_images_blob_asset_id_blob_assets_id_fk" FOREIGN KEY ("blob_asset_id") REFERENCES "public"."blob_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mistake_notes" ADD CONSTRAINT "mistake_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mistake_notes" ADD CONSTRAINT "mistake_notes_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mistake_notes" ADD CONSTRAINT "mistake_notes_source_chat_id_chats_id_fk" FOREIGN KEY ("source_chat_id") REFERENCES "public"."chats"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mistake_notes" ADD CONSTRAINT "mistake_notes_source_assistant_msg_id_messages_id_fk" FOREIGN KEY ("source_assistant_msg_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "syllabi" ADD CONSTRAINT "syllabi_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "syllabi" ADD CONSTRAINT "syllabi_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "syllabi" ADD CONSTRAINT "syllabi_blob_asset_id_blob_assets_id_fk" FOREIGN KEY ("blob_asset_id") REFERENCES "public"."blob_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "syllabus_chunks" ADD CONSTRAINT "syllabus_chunks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "syllabus_chunks" ADD CONSTRAINT "syllabus_chunks_syllabus_id_syllabi_id_fk" FOREIGN KEY ("syllabus_id") REFERENCES "public"."syllabi"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assignments_user_due_idx" ON "assignments" USING btree ("user_id","due_at") WHERE deleted_at IS NULL AND status != 'done';--> statement-breakpoint
CREATE INDEX "assignments_user_class_idx" ON "assignments" USING btree ("user_id","class_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "assignments_user_external_idx" ON "assignments" USING btree ("user_id","source","external_id") WHERE external_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "assignments_user_notion_page_idx" ON "assignments" USING btree ("user_id","notion_page_id") WHERE notion_page_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "classes_user_status_idx" ON "classes" USING btree ("user_id","status") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "classes_user_notion_page_idx" ON "classes" USING btree ("user_id","notion_page_id") WHERE notion_page_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "mistake_note_chunks_user_idx" ON "mistake_note_chunks" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mistake_note_chunks_mistake_chunk_idx" ON "mistake_note_chunks" USING btree ("mistake_id","chunk_index");--> statement-breakpoint
CREATE INDEX "mistake_note_images_mistake_idx" ON "mistake_note_images" USING btree ("mistake_id","position");--> statement-breakpoint
CREATE INDEX "mistake_notes_user_class_idx" ON "mistake_notes" USING btree ("user_id","class_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "mistake_notes_user_created_idx" ON "mistake_notes" USING btree ("user_id","created_at") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "mistake_notes_user_tags_idx" ON "mistake_notes" USING gin ("tags");--> statement-breakpoint
CREATE UNIQUE INDEX "mistake_notes_user_notion_page_idx" ON "mistake_notes" USING btree ("user_id","notion_page_id") WHERE notion_page_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "syllabi_user_class_idx" ON "syllabi" USING btree ("user_id","class_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "syllabi_user_notion_page_idx" ON "syllabi" USING btree ("user_id","notion_page_id") WHERE notion_page_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "syllabus_chunks_user_idx" ON "syllabus_chunks" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "syllabus_chunks_syllabus_chunk_idx" ON "syllabus_chunks" USING btree ("syllabus_id","chunk_index");
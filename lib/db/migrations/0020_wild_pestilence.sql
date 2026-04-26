ALTER TABLE "inbox_items" ADD COLUMN "class_id" uuid;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD COLUMN "class_binding_method" text;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD COLUMN "class_binding_confidence" real;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inbox_items_user_class_idx" ON "inbox_items" USING btree ("user_id","class_id") WHERE deleted_at IS NULL AND class_id IS NOT NULL;
-- engineer-51 — cross-source entity graph.
--
-- Adds:
--   entities       — one row per (user, distinct named thing). Kinds:
--                    person / project / course / org / event_series.
--                    Carries displayName + aliases + description +
--                    optional embedding (text-embedding-3-small, 1536d).
--                    primary_email / primary_class_id are person-specific
--                    helpers (null for other kinds). merged_into_entity_id
--                    is the soft-merge target (no FK so a cascade delete
--                    doesn't tombstone the canonical).
--
--   entity_links   — one row per (entity, source row). source_kind
--                    discriminates the source table; source_id holds the
--                    foreign UUID. Unique on
--                    (user_id, source_kind, source_id, entity_id) so the
--                    resolver is idempotent — re-running on the same
--                    source row collapses to a no-op.
--
-- pgvector is already enabled (migration 0014). No new extension needed.
--
-- Manual migration after merge per memory feedback_prod_migration_manual.md.

CREATE TABLE IF NOT EXISTS "entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"display_name" text NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"description" text,
	"primary_email" text,
	"primary_class_id" uuid,
	"embedding" vector(1536),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"merged_into_entity_id" uuid
);
--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_primary_class_id_classes_id_fk" FOREIGN KEY ("primary_class_id") REFERENCES "public"."classes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entities_user_kind_idx" ON "entities" USING btree ("user_id", "kind");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entities_user_email_idx" ON "entities" USING btree ("user_id", "primary_email");--> statement-breakpoint
-- ivfflat index for cosine-distance entity lookup. `lists = 50` is sane
-- for ≤5k rows per α (entity counts grow slower than email — typical
-- student touches O(100) entities over a semester). Re-tune post-α.
CREATE INDEX IF NOT EXISTS "entities_embedding_idx" ON "entities" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 50);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "entity_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" uuid NOT NULL,
	"confidence" real NOT NULL,
	"method" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entity_links" ADD CONSTRAINT "entity_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_links" ADD CONSTRAINT "entity_links_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entity_links_entity_idx" ON "entity_links" USING btree ("entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "entity_links_source_unique" ON "entity_links" USING btree ("user_id", "source_kind", "source_id", "entity_id");

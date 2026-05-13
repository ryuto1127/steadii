-- engineer-52 — agent eval run history.
--
-- One row per `pnpm eval:agent` CI invocation, keyed by commit SHA so
-- post-hoc trend analysis can correlate prompt changes with pass-rate
-- shifts. raw_report holds the full per-scenario breakdown produced by
-- tests/agent-evals/run.ts (assertion outcomes, tool-call sequences,
-- final text, etc.) — denormalized intentionally so a single read at
-- analysis time has everything.
--
-- No FK to users — the harness runs against a synthetic fixture user.
--
-- Manual migration after merge per memory feedback_prod_migration_manual.md.

CREATE TABLE IF NOT EXISTS "agent_eval_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commit_sha" text NOT NULL,
	"branch" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL DEFAULT now(),
	"finished_at" timestamp with time zone,
	"total_scenarios" integer NOT NULL,
	"passed" integer NOT NULL,
	"failed" integer NOT NULL,
	"duration_ms" integer NOT NULL,
	"total_cost_usd" real,
	"raw_report" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_eval_runs_commit_idx" ON "agent_eval_runs" USING btree ("commit_sha");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_eval_runs_started_idx" ON "agent_eval_runs" USING btree ("started_at");

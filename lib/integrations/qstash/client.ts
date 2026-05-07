import "server-only";
import { Client } from "@upstash/qstash";
import { env } from "@/lib/env";

// Publish-side QStash wrapper. The delayed-send pattern (post-α #6)
// publishes one message per approved draft with `delay = users.
// undo_window_seconds`; QStash fires the configured URL after the delay.
// Cancellation = `messages.delete(messageId)` — kept on the deprecated
// helper rather than `messages.cancel(...)` because the handoff doc
// pins the API surface and the underlying behavior is the same.
//
// One client per process — Upstash's HTTP client is stateless so a
// shared singleton is fine.
let cached: Client | null = null;

export class QStashTokenMissingError extends Error {
  code = "QSTASH_TOKEN_MISSING" as const;
  constructor() {
    super(
      "QSTASH_TOKEN is not configured. Set it in the environment to enable the publish-side QStash client."
    );
  }
}

export function qstash(): Client {
  if (cached) return cached;
  const token = env().QSTASH_TOKEN;
  if (!token) throw new QStashTokenMissingError();
  // Region-specific endpoint. The package's default `qstash.upstash.io`
  // routes to eu-central-1 — accounts in any other region hit 404 on
  // every publish. Pass `baseUrl` explicitly so the env value is the
  // single source of truth (the package also reads QSTASH_URL from
  // process.env, but going through env() keeps the schema audit trail
  // visible in lib/env.ts and surfaces a typo as a parse error).
  const baseUrl = env().QSTASH_URL;
  cached = new Client(baseUrl ? { token, baseUrl } : { token });
  return cached;
}

// Test-only — reset the memoized client so a test can swap the env var
// between cases without restarting the worker. Not exported under a
// production-shaped name; only the integration test files call it.
export function __resetQStashClientForTests(): void {
  cached = null;
}

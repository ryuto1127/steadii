import "server-only";
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().url(),
  AUTH_SECRET: z.string().min(1),
  AUTH_GOOGLE_ID: z.string().min(1),
  AUTH_GOOGLE_SECRET: z.string().min(1),
  NOTION_CLIENT_ID: z.string().min(1),
  NOTION_CLIENT_SECRET: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_CHAT_MODEL: z.string().optional().default(""),
  OPENAI_COMPLEX_MODEL: z.string().optional().default(""),
  OPENAI_NANO_MODEL: z.string().optional().default(""),
  OPENAI_EMBEDDING_MODEL: z.string().optional().default(""),
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().optional().default(""),
  // Legacy single-price var, still used by /api/stripe/checkout until the
  // multi-tier refactor lands (Commit 5). New code should use the specific
  // STRIPE_PRICE_* vars below.
  STRIPE_PRICE_ID_PRO: z.string().min(1),
  // New multi-tier price IDs. Optional during rollout: populated by
  // `scripts/stripe-setup.ts`; empty values are acceptable until routes that
  // consume them ship. Once Commit 5 lands, each route that uses a specific
  // price must validate the corresponding var is non-empty at request time
  // and return a clear error if it isn't.
  STRIPE_PRICE_PRO_MONTHLY: z.string().optional().default(""),
  STRIPE_PRICE_PRO_YEARLY: z.string().optional().default(""),
  STRIPE_PRICE_STUDENT_4MO: z.string().optional().default(""),
  STRIPE_PRICE_TOPUP_500: z.string().optional().default(""),
  STRIPE_PRICE_TOPUP_2000: z.string().optional().default(""),
  STRIPE_PRICE_DATA_RETENTION: z.string().optional().default(""),
  // JPY mirror of the above. Populated alongside the USD vars by
  // `scripts/stripe-setup.ts`. Routes select between USD and JPY at request
  // time based on the user's preferred currency (locale on first checkout).
  STRIPE_PRICE_PRO_MONTHLY_JPY: z.string().optional().default(""),
  STRIPE_PRICE_PRO_YEARLY_JPY: z.string().optional().default(""),
  STRIPE_PRICE_STUDENT_4MO_JPY: z.string().optional().default(""),
  STRIPE_PRICE_TOPUP_500_JPY: z.string().optional().default(""),
  STRIPE_PRICE_TOPUP_2000_JPY: z.string().optional().default(""),
  STRIPE_PRICE_DATA_RETENTION_JPY: z.string().optional().default(""),
  STRIPE_COUPON_ADMIN: z.string().optional().default(""),
  STRIPE_COUPON_FRIEND_3MO: z.string().optional().default(""),
  ENCRYPTION_KEY: z.string().min(1),
  BLOB_READ_WRITE_TOKEN: z.string().optional().default(""),
  APP_URL: z.string().url().default("http://localhost:3000"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // Phase 6 W3 — Resend for the morning digest. Optional during dev so local
  // starts without secrets. Routes that send through Resend must validate
  // the key is non-empty before using it and return a clear error if not.
  RESEND_API_KEY: z.string().optional().default(""),
  RESEND_FROM_EMAIL: z.string().optional().default("agent@mysteadii.xyz"),
  // Upstash QStash signing keys. Cron endpoints (/api/cron/*) verify the
  // `upstash-signature` header against these. Both empty in dev = endpoints
  // skip verification; both required in production. See lib/integrations/
  // qstash/verify.ts for the runtime guard.
  QSTASH_CURRENT_SIGNING_KEY: z.string().optional().default(""),
  QSTASH_NEXT_SIGNING_KEY: z.string().optional().default(""),
});

export type Env = z.infer<typeof schema>;

export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = schema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  return result.data;
}

let cached: Env | null = null;

export function env(): Env {
  if (!cached) cached = parseEnv();
  return cached;
}

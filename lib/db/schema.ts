import {
  pgTable,
  text,
  timestamp,
  primaryKey,
  integer,
  real,
  uuid,
  jsonb,
  uniqueIndex,
  index,
  boolean,
  smallint,
  customType,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { AdapterAccountType } from "next-auth/adapters";

// pgvector column type. Drizzle doesn't ship a first-class `vector` column,
// so we wrap pgvector's `[0.1,0.2,...]` wire format via customType. The
// driver-side representation is a string; the JS side is number[].
// `fromDriver` tolerates both string ("[1,2]") and already-parsed array
// shapes in case a driver deserializes pgvector for us in the future.
const vector = (name: string, dimensions: number) =>
  customType<{ data: number[]; driverData: string }>({
    dataType() {
      return `vector(${dimensions})`;
    },
    toDriver(value: number[]): string {
      return `[${value.join(",")}]`;
    },
    fromDriver(value: unknown): number[] {
      if (Array.isArray(value)) return value as number[];
      const s = String(value);
      const inner = s.startsWith("[") && s.endsWith("]") ? s.slice(1, -1) : s;
      if (!inner) return [];
      return inner.split(",").map(Number);
    },
  })(name);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name"),
  email: text("email").notNull(),
  emailVerified: timestamp("email_verified", { mode: "date" }),
  image: text("image"),
  plan: text("plan").$type<"free" | "student" | "pro">().notNull().default("free"),
  // "monthly" for Pro Monthly, "yearly" for Pro Yearly, "four_month" for
  // Student's rolling 4-month plan. Null while on Free or before first
  // subscription. NOT calendar-semester-aligned — see project_decisions.md.
  planInterval: text("plan_interval").$type<"monthly" | "yearly" | "four_month">(),
  preferences: jsonb("preferences").$type<{
    theme?: "light" | "dark" | "system";
    locale?: "en" | "ja";
    agentConfirmationMode?: "destructive_only" | "all" | "none";
    // Voice input hold-to-talk trigger. Caps Lock is the primary; Right
    // Option is a fallback for keyboards/OSes where Caps Lock events are
    // unreliable. Stored only when the user changes it from the default.
    // 2026-05-05 — added meta_right for JIS Mac users (Right Option is
    // intercepted by the kana IME there; Right ⌘ holds cleanly).
    voiceTriggerKey?: "caps_lock" | "alt_right" | "meta_right";
    // 2026-05-05 — keyboard layout drives the default voice trigger
    // key when voiceTriggerKey isn't explicitly set:
    //   en   → alt_right (Right Option holds, no IME interception)
    //   jn   → meta_right (Right ⌘ holds; Right Option = "かな" key
    //          on JIS keyboards triggers IME mode switching)
    //   auto → derived from navigator.keyboard.getLayoutMap() at
    //          runtime; fallback to "en" when unsupported.
    keyboardLayout?: "auto" | "en" | "jn";
    // GitHub login used by the L1 classifier to promote PR notifications
    // out of auto_low when the user is `@`-mentioned. Settings UI to set
    // this is engineer-33 candidate; for now read-only via DB.
    githubUsername?: string;
    // engineer-38 — one-line writing-voice description generated from
    // the user's last 50 sent emails. Injected into the L2 draft prompt
    // as a cold-start anchor for first-time senders. Generated once at
    // onboarding (after Gmail OAuth) and re-runnable from
    // /app/settings/connections. Capped at 200 chars on write so the
    // prompt budget stays bounded.
    voiceProfile?: string;
  }>().default({}),
  timezone: text("timezone"),
  onboardingStep: integer("onboarding_step").notNull().default(0),
  // Admin flag — grants unlimited-credits bypass in W2 credit middleware.
  // Set via db:studio for Ryuto's account; no in-app UI toggles this.
  // Replaces the prior admin-via-redemption mechanism.
  isAdmin: boolean("is_admin").notNull().default(false),
  // Grandfather / founding-member flags. Column-only in W1; automation that
  // flips them lives in a later week (first 100 paid users + α invitees).
  foundingMember: boolean("founding_member").notNull().default(false),
  grandfatherPriceLockedUntil: timestamp("grandfather_price_locked_until", {
    mode: "date",
  }),
  // 14-day Pro trial start timestamp. Column-only in W1; trial state machine
  // is W3. When non-null and still within 14 days, W3 middleware grants Pro.
  trialStartedAt: timestamp("trial_started_at", { mode: "date" }),
  // Set when the user purchases the $10 Extended Data Retention add-on, or
  // computed/refreshed by the retention job (default 120 days after cancel).
  dataRetentionExpiresAt: timestamp("data_retention_expires_at", {
    mode: "date",
  }),
  // Hour (0–23) in the user's local timezone to deliver the morning digest.
  // Column-only in W1; W3 reads it. Default 7 matches the memory-locked
  // 7am digest.
  digestHourLocal: smallint("digest_hour_local").notNull().default(7),
  digestEnabled: boolean("digest_enabled").notNull().default(true),
  // W3 additions — configurable undo window for gmail_send (10-60s slider
  // lives in Settings → Notifications), high-risk immediate push toggle
  // (no-op until web push ships post-α), and timestamps that gate
  // auto-ingest / digest cron from firing more often than necessary.
  undoWindowSeconds: smallint("undo_window_seconds").notNull().default(10),
  highRiskNotifyImmediate: boolean("high_risk_notify_immediate")
    .notNull()
    .default(true),
  lastGmailIngestAt: timestamp("last_gmail_ingest_at", {
    mode: "date",
    withTimezone: true,
  }),
  lastDigestSentAt: timestamp("last_digest_sent_at", {
    mode: "date",
    withTimezone: true,
  }),
  // Post-α #5 — Weekly retrospective digest (Sunday 5pm local). Default
  // ON because this is the retention hook; not gated behind opt-in for α.
  // dow_local 0..6 (Sun..Sat); hour_local 0..23 in IANA timezone. Picker
  // skips when last_weekly_digest_sent_at is within the trailing 6 days.
  weeklyDigestEnabled: boolean("weekly_digest_enabled")
    .notNull()
    .default(true),
  weeklyDigestDowLocal: smallint("weekly_digest_dow_local")
    .notNull()
    .default(0),
  weeklyDigestHourLocal: smallint("weekly_digest_hour_local")
    .notNull()
    .default(17),
  lastWeeklyDigestSentAt: timestamp("last_weekly_digest_sent_at", {
    mode: "date",
    withTimezone: true,
  }),
  // W4.3 — staged autonomy opt-in. When true, eligible draft_reply
  // drafts are routed straight into send_queue (with the standard 20s
  // undo) instead of waiting for explicit Send. False by default; the
  // glass-box brand promise requires opt-in.
  //
  // Eligibility is enforced server-side and currently restricted to
  // `risk_tier='medium'` items (the pipeline's "lowest-stakes drafted
  // class"; low-tier never produces draft_reply today). Memory uses
  // "low-risk fire-and-report" — semantically the lowest-stakes drafted
  // tier — which lines up with our medium classification. If the
  // pipeline ever starts drafting for low tier (e.g. quick acks), that
  // policy can be extended here without a schema change.
  autonomySendEnabled: boolean("autonomy_send_enabled")
    .notNull()
    .default(false),
  // Wave 3 — meeting pre-brief generator gate. Pre-brief is the most
  // LLM-heavy Wave-3 feature (~$1.50/user/month at 5-10 events/day with
  // attendees; heavy users with 30+ daily meetings can exceed $5/month).
  // Default true so the value lands by default; the cron flips this off
  // automatically if a user's monthly pre-brief spend climbs past the
  // hard ceiling, and the Settings → Notifications panel exposes a manual
  // toggle.
  preBriefEnabled: boolean("pre_brief_enabled").notNull().default(true),
  // Phase 7 W-Integrations — set when the user clicks "Skip" on the
  // onboarding integrations page (Step 2). Non-null = the page never
  // re-shows. Contextual suggestion prompts (Surface 2) remain active
  // even after skip per locked decision Q1.
  onboardingIntegrationsSkippedAt: timestamp(
    "onboarding_integrations_skipped_at",
    { mode: "date", withTimezone: true }
  ),
  // Wave 5 — auto-archive low-risk emails. When true, Tier-1 confidence
  // ≥ 0.95 emails are silently archived at ingest time and never appear
  // in queue/inbox primary view. Default false during the α 2-week
  // safety ramp; the env-controlled boolean AUTO_ARCHIVE_DEFAULT_ENABLED
  // overrides for new signups (flipped to true via tiny follow-up PR
  // after validation window).
  autoArchiveEnabled: boolean("auto_archive_enabled").notNull().default(false),
  // Wave 5 — set when Gmail's OAuth refresh path returns invalid_grant
  // (user revoked, password reset, etc). The app shell renders a
  // re-connect banner when this is non-null and clears it on successful
  // re-auth. Avoids the silent-failure path that buried token loss
  // under a Sentry exception only.
  gmailTokenRevokedAt: timestamp("gmail_token_revoked_at", {
    mode: "date",
    withTimezone: true,
  }),
  // Wave 5 — set when the user dismisses the post-skip integrations
  // re-prompt banner. The banner renders once per user after they've
  // skipped Step 2 and had at least one queue interaction; dismissing
  // suppresses it permanently. Distinct from
  // onboarding_integrations_skipped_at, which gates the onboarding flow
  // itself.
  onboardingSkipRecoveryDismissedAt: timestamp(
    "onboarding_skip_recovery_dismissed_at",
    { mode: "date", withTimezone: true }
  ),
  // Preferred currency for Stripe checkouts and pricing display. Set on first
  // checkout from the user's locale ('ja' → 'jpy', everything else → 'usd')
  // and persisted via the subscription webhook so future top-ups stay in the
  // same currency. Stripe Subscriptions are mono-currency, so once a paying
  // user picks one this field stays pinned.
  preferredCurrency: text("preferred_currency")
    .$type<"usd" | "jpy">()
    .notNull()
    .default("usd"),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { mode: "date" }),
}, (table) => ({
  emailIdx: uniqueIndex("users_email_idx").on(table.email),
}));

export const blobAssets = pgTable("blob_assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  source: text("source")
    .$type<"chat_attachment" | "syllabus" | "handwritten_note">()
    .notNull(),
  url: text("url").notNull(),
  filename: text("filename"),
  mimeType: text("mime_type"),
  sizeBytes: integer("size_bytes").notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { mode: "date" }),
});

export type BlobAsset = typeof blobAssets.$inferSelect;

export const accounts = pgTable(
  "accounts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (account) => ({
    compoundKey: primaryKey({
      columns: [account.provider, account.providerAccountId],
    }),
  })
);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (vt) => ({
    compoundKey: primaryKey({ columns: [vt.identifier, vt.token] }),
  })
);

export const notionConnections = pgTable(
  "notion_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").notNull(),
    workspaceName: text("workspace_name"),
    workspaceIcon: text("workspace_icon"),
    botId: text("bot_id").notNull(),
    accessTokenEncrypted: text("access_token_encrypted").notNull(),
    parentPageId: text("parent_page_id"),
    classesDbId: text("classes_db_id"),
    mistakesDbId: text("mistakes_db_id"),
    assignmentsDbId: text("assignments_db_id"),
    syllabiDbId: text("syllabi_db_id"),
    setupCompletedAt: timestamp("setup_completed_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => ({
    userWorkspaceIdx: uniqueIndex("notion_connections_user_workspace_idx").on(
      t.userId,
      t.workspaceId
    ),
  })
);

export const registeredResources = pgTable("registered_resources", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  connectionId: uuid("connection_id")
    .notNull()
    .references(() => notionConnections.id, { onDelete: "cascade" }),
  resourceType: text("resource_type").$type<"page" | "database">().notNull(),
  notionId: text("notion_id").notNull(),
  title: text("title"),
  parentNotionId: text("parent_notion_id"),
  autoRegistered: integer("auto_registered").notNull().default(0),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  archivedAt: timestamp("archived_at", { mode: "date" }),
});

export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  action: text("action").notNull(),
  resourceType: text("resource_type"),
  resourceId: text("resource_id"),
  toolName: text("tool_name"),
  result: text("result").$type<"success" | "failure">().notNull(),
  detail: jsonb("detail"),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
});

export const chats = pgTable("chats", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title"),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { mode: "date" }),
});

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  chatId: uuid("chat_id")
    .notNull()
    .references(() => chats.id, { onDelete: "cascade" }),
  role: text("role").$type<"user" | "assistant" | "system" | "tool">().notNull(),
  content: text("content").notNull().default(""),
  toolCalls: jsonb("tool_calls"),
  toolCallId: text("tool_call_id"),
  model: text("model"),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { mode: "date" }),
});

export const messageAttachments = pgTable("message_attachments", {
  id: uuid("id").primaryKey().defaultRandom(),
  messageId: uuid("message_id")
    .notNull()
    .references(() => messages.id, { onDelete: "cascade" }),
  blobAssetId: uuid("blob_asset_id").references(() => blobAssets.id, {
    onDelete: "set null",
  }),
  kind: text("kind").$type<"image" | "pdf">().notNull(),
  url: text("url").notNull(),
  filename: text("filename"),
  mimeType: text("mime_type"),
  sizeBytes: integer("size_bytes"),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
});

export const usageEvents = pgTable("usage_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  chatId: uuid("chat_id").references(() => chats.id, { onDelete: "set null" }),
  messageId: uuid("message_id").references(() => messages.id, {
    onDelete: "set null",
  }),
  model: text("model").notNull(),
  taskType: text("task_type").notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  cachedTokens: integer("cached_tokens").notNull().default(0),
  creditsUsed: integer("credits_used").notNull().default(0),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
});

export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  stripeCustomerId: text("stripe_customer_id").notNull(),
  stripeSubscriptionId: text("stripe_subscription_id").notNull(),
  stripePriceId: text("stripe_price_id"),
  status: text("status")
    .$type<
      | "trialing"
      | "active"
      | "past_due"
      | "canceled"
      | "incomplete"
      | "incomplete_expired"
      | "unpaid"
      | "paused"
    >()
    .notNull(),
  currentPeriodEnd: timestamp("current_period_end", { mode: "date" }),
  cancelAtPeriodEnd: integer("cancel_at_period_end").notNull().default(0),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
}, (t) => ({
  userIdx: uniqueIndex("subscriptions_user_idx").on(t.userId),
  stripeSubIdx: uniqueIndex("subscriptions_stripe_sub_idx").on(
    t.stripeSubscriptionId
  ),
}));

export type Subscription = typeof subscriptions.$inferSelect;

// Invoices — mirror of Stripe invoices for display in Settings > Billing and
// for auditability. Rows are inserted by the invoice.paid webhook and nowhere
// else. tax_amount is reserved (always 0) until Stripe Tax is enabled post-α.
export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    stripeInvoiceId: text("stripe_invoice_id").notNull(),
    // All amounts in minor units (cents for USD).
    amountTotal: integer("amount_total").notNull(),
    amountSubtotal: integer("amount_subtotal").notNull(),
    taxAmount: integer("tax_amount").notNull().default(0),
    currency: text("currency").notNull().default("usd"),
    paidAt: timestamp("paid_at", { mode: "date" }),
    invoicePdfUrl: text("invoice_pdf_url"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => ({
    stripeInvoiceIdx: uniqueIndex("invoices_stripe_invoice_idx").on(
      t.stripeInvoiceId
    ),
    userCreatedIdx: index("invoices_user_created_idx").on(t.userId, t.createdAt),
  })
);

export type Invoice = typeof invoices.$inferSelect;

// Webhook idempotency ledger. Stripe retries the same event on 5xx/timeouts;
// without this table the handler would double-insert invoice rows and
// double-log audit entries. Flow: before processing, INSERT the event_id in
// the same transaction as the side effects — ON CONFLICT DO NOTHING short-
// circuits retries and we return 200 immediately.
export const processedStripeEvents = pgTable("processed_stripe_events", {
  eventId: text("event_id").primaryKey(),
  type: text("type").notNull(),
  processedAt: timestamp("processed_at", { mode: "date" }).notNull().defaultNow(),
});

export type ProcessedStripeEvent = typeof processedStripeEvents.$inferSelect;

// Top-up credit balances — packs purchased outside the monthly pool.
// Each row is a separate pack with its own expiry (90 days by default).
// Consumption priority: monthly pool first, then top-up rows by earliest
// expiry (use-it-or-lose-it). The credit middleware sums `credits_remaining`
// across non-expired rows to compute a user's top-up balance.
export const topupBalances = pgTable(
  "topup_balances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    stripeInvoiceId: text("stripe_invoice_id").notNull(),
    creditsPurchased: integer("credits_purchased").notNull(),
    creditsRemaining: integer("credits_remaining").notNull(),
    expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => ({
    stripeInvoiceIdx: uniqueIndex("topup_balances_stripe_invoice_idx").on(
      t.stripeInvoiceId
    ),
    userExpiresIdx: index("topup_balances_user_expires_idx").on(
      t.userId,
      t.expiresAt
    ),
  })
);

export type TopupBalance = typeof topupBalances.$inferSelect;

export const pendingToolCalls = pgTable("pending_tool_calls", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  chatId: uuid("chat_id")
    .notNull()
    .references(() => chats.id, { onDelete: "cascade" }),
  assistantMessageId: uuid("assistant_message_id").references(() => messages.id, {
    onDelete: "set null",
  }),
  toolName: text("tool_name").notNull(),
  toolCallId: text("tool_call_id").notNull(),
  args: jsonb("args").notNull(),
  status: text("status")
    .$type<"pending" | "approved" | "denied" | "expired">()
    .notNull()
    .default("pending"),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { mode: "date" }),
});

export type PendingToolCall = typeof pendingToolCalls.$inferSelect;

export type Chat = typeof chats.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type MessageAttachment = typeof messageAttachments.$inferSelect;
export type UsageEvent = typeof usageEvents.$inferSelect;

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type NotionConnection = typeof notionConnections.$inferSelect;
export type RegisteredResource = typeof registeredResources.$inferSelect;
export type AuditLogRow = typeof auditLog.$inferSelect;

export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sourceType: text("source_type")
      .$type<
        | "google_calendar"
        | "google_tasks"
        | "google_classroom_coursework"
        | "ical_subscription"
        | "microsoft_graph"
        | "microsoft_todo"
      >()
      .notNull(),
    sourceAccountId: text("source_account_id").notNull(),
    externalId: text("external_id").notNull(),
    externalParentId: text("external_parent_id"),
    kind: text("kind")
      .$type<"event" | "task" | "assignment">()
      .notNull(),
    title: text("title").notNull(),
    description: text("description"),
    startsAt: timestamp("starts_at", { mode: "date", withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { mode: "date", withTimezone: true }),
    isAllDay: boolean("is_all_day").notNull().default(false),
    originTimezone: text("origin_timezone"),
    location: text("location"),
    url: text("url"),
    status: text("status").$type<
      | "confirmed"
      | "tentative"
      | "cancelled"
      | "needs_action"
      | "completed"
    >(),
    sourceMetadata: jsonb("source_metadata"),
    normalizedKey: text("normalized_key"),
    syncedAt: timestamp("synced_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { mode: "date", withTimezone: true }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    sourceExternalIdx: uniqueIndex("events_source_external_idx").on(
      t.userId,
      t.sourceType,
      t.externalId
    ),
    userStartsAtIdx: index("events_user_starts_at_idx").on(
      t.userId,
      t.startsAt
    ),
    userKindStartsAtIdx: index("events_user_kind_starts_at_idx").on(
      t.userId,
      t.kind,
      t.startsAt
    ),
  })
);

export type EventRow = typeof events.$inferSelect;
export type NewEventRow = typeof events.$inferInsert;

// ---------------------------------------------------------------------------
// Phase 6 — Inbox, Agent Rules, Agent Drafts
// ---------------------------------------------------------------------------

export type InboxBucket =
  | "auto_high"
  | "auto_medium"
  | "auto_low"
  | "ignore"
  | "l2_pending";

export type InboxRiskTier = "low" | "medium" | "high";

export type InboxStatus =
  | "open"
  | "snoozed"
  | "archived"
  | "sent"
  | "dismissed";

export type SenderRole =
  | "professor"
  | "ta"
  | "classmate"
  | "admin"
  // W2 addition — alias for supervisor/PI/lab-director. Mapped to AUTO_HIGH
  // in L1 rules alongside 'admin'. UI picker lands in W3.
  | "supervisor"
  // 2026-04-29 broadening (pre-α dogfood): Career covers recruiters /
  // internship coordinators / interviewers — these are AUTO_HIGH because
  // a missed reply costs an opportunity. Personal covers family / friends
  // / clubs — AUTO_LOW so they don't paginate the inbox triage queue.
  // Splitting them out of the old "Other" catch-all preserves signal that
  // was being dropped at LLM-only classification time.
  | "career"
  | "personal"
  | "other";

// One entry in the provenance chain. `source` is 'global' for hard-coded
// rules and mirrors `agent_rules.source` values ('learned'|'manual'|'chat')
// for per-user rules.
export type RuleProvenance = {
  ruleId: string;
  source: "global" | "learned" | "manual" | "chat";
  why: string;
};

// Phase 7 W1 — class binding method enum. The dominant method that bound
// an inbox item to a `class_id`. Persisted on `inbox_items` so the L2
// fanout retriever can branch (structured-by-class-id vs vector-only)
// without re-running the binding compute. "none" means no signal cleared
// MIN_CONFIDENCE; the row stays unbound.
export type ClassBindingMethod =
  | "subject_code"
  | "subject_name"
  | "sender_professor"
  | "vector_chunks"
  | "calendar_proximity"
  | "ja_sensei_pattern"
  | "none";

// The agent's Gmail queue. One row per message seen by L1.
export const inboxItems = pgTable(
  "inbox_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    sourceType: text("source_type").notNull(), // 'gmail' in W1
    sourceAccountId: text("source_account_id").notNull(),
    externalId: text("external_id").notNull(),
    threadExternalId: text("thread_external_id"),

    senderEmail: text("sender_email").notNull(),
    senderName: text("sender_name"),
    // Generated column so "have we seen this domain before?" stays a cheap
    // index probe. Drizzle emits: GENERATED ALWAYS AS (...) STORED.
    senderDomain: text("sender_domain")
      .notNull()
      .generatedAlwaysAs(sql`split_part(sender_email, '@', 2)`),
    senderRole: text("sender_role").$type<SenderRole>(),
    recipientTo: text("recipient_to")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    recipientCc: text("recipient_cc")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    subject: text("subject"),
    snippet: text("snippet"),
    receivedAt: timestamp("received_at", { mode: "date", withTimezone: true })
      .notNull(),

    bucket: text("bucket").$type<InboxBucket>().notNull(),
    riskTier: text("risk_tier").$type<InboxRiskTier>(),
    ruleProvenance: jsonb("rule_provenance").$type<RuleProvenance[]>(),
    firstTimeSender: boolean("first_time_sender").notNull().default(false),

    // Wave 5 — classifier confidence in [0..1]. Surfaces in admin metrics
    // and gates auto-archive (≥ 0.95 + bucket='auto_low' eligible).
    triageConfidence: real("triage_confidence"),
    // Wave 5 — true when this row was archived by the Tier-1 auto-archive
    // rule (not user action). Used to:
    //   - power the Inbox `Hidden ({n})` filter chip query
    //   - distinguish Steadii-archive from user-archive in audit + digest
    //   - drive the Type D card on Home + the weekly digest section
    autoArchived: boolean("auto_archived").notNull().default(false),
    // Wave 5 — set when the user manually restores a previously
    // auto-archived item. Triggers the learning signal (insert
    // agent_rules row scoped to the sender so similar items don't
    // auto-archive again).
    userRestoredAt: timestamp("user_restored_at", {
      mode: "date",
      withTimezone: true,
    }),

    // engineer-33 — OTP / verification-code time-decay. Stamped by L1
    // when an OTP keyword matches; the urgency-decay sweep auto-archives
    // the row once now() passes this timestamp. Null for non-OTP rows.
    urgencyExpiresAt: timestamp("urgency_expires_at", {
      mode: "date",
      withTimezone: true,
    }),

    // Phase 7 W1 — class binding cache. Populated once at ingest by
    // `bindEmailToClass` so the L2 fanout retriever consults a single
    // index probe instead of re-binding per call. Nullable: rows that
    // bind to no class (no signal above MIN_CONFIDENCE) leave class_id
    // null and the fanout falls back to vector-only retrieval.
    classId: uuid("class_id").references(() => classes.id, {
      onDelete: "set null",
    }),
    classBindingMethod: text("class_binding_method").$type<ClassBindingMethod>(),
    classBindingConfidence: real("class_binding_confidence"),

    status: text("status").$type<InboxStatus>().notNull().default("open"),
    reviewedAt: timestamp("reviewed_at", { mode: "date", withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { mode: "date", withTimezone: true }),

    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { mode: "date", withTimezone: true }),
  },
  (t) => ({
    externalUnique: uniqueIndex("inbox_items_external_unique").on(
      t.userId,
      t.sourceType,
      t.externalId
    ),
    userStatusReceivedIdx: index(
      "inbox_items_user_status_received_idx"
    )
      .on(t.userId, t.status, t.receivedAt)
      .where(sql`deleted_at IS NULL`),
    userBucketIdx: index("inbox_items_user_bucket_idx")
      .on(t.userId, t.bucket)
      .where(sql`deleted_at IS NULL`),
    userThreadIdx: index("inbox_items_user_thread_idx").on(
      t.userId,
      t.threadExternalId
    ),
    // Phase 7 W1 — class-bound retrieval probe. Skips rows with no
    // binding so the index is only as wide as the bound corpus.
    userClassIdx: index("inbox_items_user_class_idx")
      .on(t.userId, t.classId)
      .where(sql`deleted_at IS NULL AND class_id IS NOT NULL`),
    // Wave 5 — Hidden filter chip query path. Indexed only on rows
    // currently auto-archived (small fraction of inbox), so the chip
    // query stays index-only.
    userAutoArchivedIdx: index("inbox_items_user_auto_archived_idx")
      .on(t.userId, t.autoArchived, t.receivedAt)
      .where(sql`deleted_at IS NULL AND auto_archived = true`),
    // engineer-33 — urgency-decay sweep query path. Only rows that
    // haven't decayed yet AND haven't been already-archived are
    // candidates, so the partial index matches exactly the sweep filter.
    urgencyDecayIdx: index("inbox_urgency_decay_idx")
      .on(t.urgencyExpiresAt)
      .where(sql`urgency_expires_at IS NOT NULL AND auto_archived = false`),
  })
);

export type InboxItem = typeof inboxItems.$inferSelect;
export type NewInboxItem = typeof inboxItems.$inferInsert;

export type AgentRuleScope =
  | "sender"
  | "domain"
  | "subject_keyword"
  | "thread"
  // engineer-38 — global writing-style rules learned from edit-deltas.
  // matchValue is always "*"; one row per rule sentence. Source is
  // "edit_delta_learner". Injected into the L2 draft prompt under
  // "Your writing-style preferences (learned from past edits)".
  | "writing_style";
export type AgentRuleSource =
  | "learned"
  | "manual"
  | "chat"
  | "edit_delta_learner";

// Per-user rules that shape L1 triage. Globals (operator-maintained) stay in
// code under `lib/agent/email/rules-global.ts`; only user-specific rules
// live here. Learned rules are inserted automatically by L2/L3 feedback
// loops (post-α); manual ones come from Settings → Agent Rules (W3); chat
// ones come from a chat tool call (W3+).
export const agentRules = pgTable(
  "agent_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    scope: text("scope").$type<AgentRuleScope>().notNull(),
    matchValue: text("match_value").notNull(),
    matchNormalized: text("match_normalized").notNull(),

    riskTier: text("risk_tier").$type<InboxRiskTier>(),
    bucket: text("bucket").$type<InboxBucket>(),
    senderRole: text("sender_role").$type<SenderRole>(),

    source: text("source").$type<AgentRuleSource>().notNull(),
    reason: text("reason"),

    enabled: boolean("enabled").notNull().default(true),

    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { mode: "date", withTimezone: true }),
  },
  (t) => ({
    userScopeMatchUnique: uniqueIndex("agent_rules_user_scope_match_unique").on(
      t.userId,
      t.scope,
      t.matchNormalized
    ),
    userScopeEnabledIdx: index("agent_rules_user_scope_enabled_idx")
      .on(t.userId, t.scope)
      .where(sql`enabled = true AND deleted_at IS NULL`),
  })
);

export type AgentRule = typeof agentRules.$inferSelect;
export type NewAgentRule = typeof agentRules.$inferInsert;

export type AgentDraftAction =
  | "draft_reply"
  | "archive"
  | "snooze"
  | "no_op"
  | "ask_clarifying"
  // polish-7: Category B from the 2-category triage. Sender doesn't expect
  // a reply but the content matters to the student (grade posted,
  // scholarship awarded, course-wide announcement). Surfaces in the inbox
  // list as a pending row with an "Important" pill, no draft form.
  | "notify_only"
  // Set when status='paused' so analytics don't conflate genuine
  // ask_clarifying actions with credit-exhausted pipeline halts. The DB
  // column is plain text so no migration is needed — only the TS enum.
  | "paused";

export type AgentDraftStatus =
  | "pending"
  | "edited"
  | "approved"
  | "sent"
  | "dismissed"
  | "expired"
  // W2 addition — status set when credit gate denies deep/draft mid-pipeline.
  // `paused_at_step` records which step hit the gate so W3 UI can explain.
  | "paused"
  // W3 addition — in-flight between Send click and the 10s undo worker
  // dispatch. A send_queue row with status='pending' exists for this draft.
  // Cancellation flips back to 'approved'; successful worker dispatch flips
  // to 'sent'. Exists only in TS; DB column is plain text.
  | "sent_pending";

// Retrieval provenance blob. Populated by L2 deep pass + (Phase 7 W1)
// the multi-source fanout retriever. Surfaces in the inbox-detail
// "Thinking · complete" pill row and the per-decision Settings →
// "How your agent thinks" surface.
//
// Schema widening (Phase 7 W1): the prior email-only shape stays
// readable because the discriminator (`type: "email"`) is preserved on
// existing rows. New rows emit additional source variants as the L2
// pipeline grows beyond similar-email retrieval.
export type RetrievalProvenanceSource =
  | {
      type: "email";
      id: string; // inbox_items.id
      similarity: number; // 0..1
      snippet: string; // <=200 chars
    }
  | {
      type: "mistake";
      id: string; // mistake_notes.id
      classId: string | null;
      similarity?: number; // optional — recency-ranked, no similarity score
      snippet: string; // <=400 chars
    }
  | {
      type: "syllabus";
      id: string; // chunk id (syllabus_chunks.id)
      syllabusId: string;
      classId: string | null;
      similarity: number;
      snippet: string;
    }
  | {
      type: "calendar";
      id: string;
      kind: "event" | "task" | "assignment";
      title: string;
      start: string;
      end: string | null;
    }
  // engineer-38 — past replies the user sent to the SAME sender. Surfaces
  // tone / register precedent that no vector retrieval will catch
  // ("self-N · 4/22"). id is agent_drafts.id; sentAt is the row's sent_at
  // ISO; snippet capped at 200 chars of the past reply body.
  | {
      type: "sender_history";
      id: string;
      sentAt: string;
      snippet: string;
    };

export type ClassBindingProvenance = {
  classId: string | null;
  className: string | null;
  classCode: string | null;
  method:
    | "subject_code"
    | "subject_name"
    | "sender_professor"
    | "vector_chunks"
    | "calendar_proximity"
    | "ja_sensei_pattern"
    | "none";
  confidence: number;
};

export type RetrievalProvenance = {
  sources: RetrievalProvenanceSource[];
  total_candidates: number;
  returned: number;
  // Phase 7 W1 — class binding payload, separate so the UI can render it
  // distinct from the per-source pills. Optional for backwards-compat
  // with deep-pass-only rows persisted before W1.
  classBinding?: ClassBindingProvenance | null;
  // Per-phase counts for admin dashboards. Optional for the same
  // backwards-compat reason. senderHistory/syllabus reflect row counts;
  // calendar = events + tasks + steadii assignments combined.
  // engineer-38: `mistakes` was renamed to `senderHistory`. Older rows
  // persisted before the rename keep `mistakes` so we tolerate either
  // shape on read; new rows always emit `senderHistory`.
  fanoutCounts?: {
    senderHistory?: number;
    mistakes?: number;
    syllabus: number;
    emails: number;
    calendar: number;
  } | null;
  // Per-source timing in ms — surfaced in admin metrics. Optional.
  // Same rename rule as fanoutCounts above.
  fanoutTimings?: {
    senderHistory?: number;
    mistakes?: number;
    syllabus: number;
    emails: number;
    calendar: number;
    total: number;
  } | null;
};

// engineer-39 — structured action items the deep pass extracted from the
// inbound email. Persisted on agent_drafts.extracted_action_items. The
// DraftDetailsPanel surfaces items >= MIN_CONFIDENCE; "Add to my tasks"
// writes to assignments + Google Tasks and records the index in
// accepted_action_item_indices for idempotency.
export type ExtractedActionItem = {
  // Short imperative ("Submit photo ID", "Reply by Friday with availability").
  title: string;
  // Optional ISO date when the email implies a deadline. YYYY-MM-DD.
  dueDate: string | null;
  // Confidence 0-1. UI only surfaces items >= 0.6 to suppress noise.
  confidence: number;
};

// engineer-39 — pre-send fact-checker output. Persisted so the warning
// modal can re-render after a route refresh and so analytics can audit
// how often the check fires per user.
export type PreSendWarning = {
  phrase: string;
  why: string;
};

// W1 writes no rows; W2 starts populating. The W2-added columns
// (retrieval_provenance, risk_pass_usage_id, paused_at_step) + the rename of
// classify_usage_id → deep_pass_usage_id reflect the risk/deep two-pass
// pipeline introduced in Phase 6 W2.
export const agentDrafts = pgTable(
  "agent_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    inboxItemId: uuid("inbox_item_id")
      .notNull()
      .references(() => inboxItems.id, { onDelete: "cascade" }),

    classifyModel: text("classify_model"),
    draftModel: text("draft_model"),
    // Renamed in W2: was `classify_usage_id`. The risk pass is a separate
    // LLM call now, so the "classify" usage pointer is specifically the
    // deep pass.
    riskPassUsageId: uuid("risk_pass_usage_id").references(() => usageEvents.id, {
      onDelete: "set null",
    }),
    deepPassUsageId: uuid("deep_pass_usage_id").references(() => usageEvents.id, {
      onDelete: "set null",
    }),
    draftUsageId: uuid("draft_usage_id").references(() => usageEvents.id, {
      onDelete: "set null",
    }),

    riskTier: text("risk_tier").$type<InboxRiskTier>().notNull(),
    action: text("action").$type<AgentDraftAction>().notNull(),
    reasoning: text("reasoning"),
    retrievalProvenance: jsonb("retrieval_provenance").$type<RetrievalProvenance>(),

    draftSubject: text("draft_subject"),
    draftBody: text("draft_body"),
    // engineer-38 — frozen LLM-first body. saveDraftEditsAction overwrites
    // draftBody with the user's edit; this column keeps the original so
    // the edit-delta learner can compute (original, final) pairs at send
    // time. Null on legacy rows pre-migration AND on rows persisted by
    // pipelines that didn't generate a draft body (paused / no_op).
    originalDraftBody: text("original_draft_body"),
    draftTo: text("draft_to")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    draftCc: text("draft_cc")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    draftInReplyTo: text("draft_in_reply_to"),

    status: text("status").$type<AgentDraftStatus>().notNull().default("pending"),
    // Set when status transitions to 'paused'. Values: 'risk' | 'deep' | 'draft'.
    pausedAtStep: text("paused_at_step").$type<"risk" | "deep" | "draft">(),
    approvedAt: timestamp("approved_at", { mode: "date", withTimezone: true }),
    sentAt: timestamp("sent_at", { mode: "date", withTimezone: true }),
    gmailSentMessageId: text("gmail_sent_message_id"),
    // W4.3 — true when the orchestrator enqueued the send without a
    // human Send click (per `users.autonomy_low_risk_enabled`). The UI
    // labels these distinctly so users immediately see "the agent did
    // this on its own" — protects the glass-box promise even when the
    // human was out of the loop.
    autoSent: boolean("auto_sent").notNull().default(false),

    // Post-α #6 — delayed-message pattern (replaces polling send_queue).
    // qstashMessageId is the id returned from `qstash().publishJSON(...)`,
    // used by the cancel path. gmailDraftId moves off send_queue so the
    // execute route can resolve both off the agent_drafts row directly.
    // Both nullable: legacy rows pre-migration won't have either, and
    // dismissed / cancelled drafts that never reached send don't need
    // them.
    qstashMessageId: text("qstash_message_id"),
    gmailDraftId: text("gmail_draft_id"),

    // engineer-39 — structured to-dos the deep pass extracted from the
    // inbound email. Surfaces in DraftDetailsPanel and is accepted via
    // acceptDraftActionItemAction (writes to assignments + Google Tasks).
    // Default empty array so legacy rows pre-migration read consistently.
    extractedActionItems: jsonb("extracted_action_items")
      .$type<ExtractedActionItem[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    // engineer-39 — indices into extractedActionItems that the user has
    // already accepted. Idempotency guard so a double-click on
    // "Add to my tasks" doesn't dup the assignment / Google Task.
    acceptedActionItemIndices: jsonb("accepted_action_item_indices")
      .$type<number[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    // engineer-39 — pre-send fact-checker warnings. Populated by the
    // approveAgentDraftAction path before enqueueing the send when the
    // sanity-check returned ok=false. Empty array on the happy path.
    preSendWarnings: jsonb("pre_send_warnings")
      .$type<PreSendWarning[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),

    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userStatusCreatedIdx: index("agent_drafts_user_status_idx").on(
      t.userId,
      t.status,
      t.createdAt
    ),
    inboxItemIdx: index("agent_drafts_inbox_item_idx").on(t.inboxItemId),
  })
);

export type AgentDraft = typeof agentDrafts.$inferSelect;
export type NewAgentDraft = typeof agentDrafts.$inferInsert;

// polish-7 — per-user feedback log for the agent's L2 action proposals.
// One row per user-action moment (dismiss / send / edit / auto-send) so
// the L2 classifier can read recent precedent for a sender at classify
// time and bias toward the student's revealed preference. Locked
// decision in memory deferred this until ≥100 users; α dogfood revised
// it forward because over-drafting is acute.
export type AgentSenderFeedbackResponse =
  | "dismissed"
  | "sent"
  | "edited"
  | "auto_sent";

export const agentSenderFeedback = pgTable(
  "agent_sender_feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    senderEmail: text("sender_email").notNull(),
    senderDomain: text("sender_domain").notNull(),

    // What the agent proposed for this row. Mirrors agent_drafts.action.
    proposedAction: text("proposed_action").$type<AgentDraftAction>().notNull(),

    // What the user did. Independent of agent_drafts.status because we
    // care about per-action moments (a user can dismiss without ever
    // editing) — not the final draft state.
    userResponse: text("user_response")
      .$type<AgentSenderFeedbackResponse>()
      .notNull(),

    inboxItemId: uuid("inbox_item_id").references(() => inboxItems.id, {
      onDelete: "set null",
    }),
    agentDraftId: uuid("agent_draft_id").references(() => agentDrafts.id, {
      onDelete: "set null",
    }),

    // engineer-38 — edit-delta capture. Both columns are null when the
    // user sent without editing (the common path); populated only when
    // the final body diverges from the LLM's original. The style-learner
    // cron consumes pairs where editedBody IS NOT NULL.
    originalDraftBody: text("original_draft_body"),
    editedBody: text("edited_body"),

    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userSenderIdx: index("agent_sender_feedback_user_sender_idx").on(
      t.userId,
      t.senderEmail
    ),
    userDomainIdx: index("agent_sender_feedback_user_domain_idx").on(
      t.userId,
      t.senderDomain
    ),
  })
);

export type AgentSenderFeedback = typeof agentSenderFeedback.$inferSelect;
export type NewAgentSenderFeedback = typeof agentSenderFeedback.$inferInsert;

// engineer-39 — per-(user, contact) memory. The persona-learner cron
// distills the relationship label + a short list of facts about the
// contact from the user's correspondence history with them. Surfaces in
// the L2 fanout's contactPersona block (so drafts respect the relationship)
// and in Settings → How your agent thinks (so the user can correct mistakes
// or wipe a stale persona). User-scoped — never read across users.
export const agentContactPersonas = pgTable(
  "agent_contact_personas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    contactEmail: text("contact_email").notNull(),
    contactName: text("contact_name"),
    // Free-form short label for the relationship (e.g. "MAT223 instructor",
    // "Stripe support", "Mom"). Surfaced in draft prompts AND in the
    // settings surface so the user can correct mistakes.
    relationship: text("relationship"),
    // Up to 8 short factual statements about the contact. Strings only;
    // structured fields would over-engineer the v1 surface.
    facts: jsonb("facts")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    // Last full extraction timestamp. The cron skips contacts where
    // last_extracted_at > now() - 7 days OR no new inbox/sent activity
    // since.
    lastExtractedAt: timestamp("last_extracted_at", {
      mode: "date",
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userEmailUnique: uniqueIndex("agent_contact_personas_user_email_uniq").on(
      t.userId,
      t.contactEmail
    ),
    userExtractedIdx: index(
      "agent_contact_personas_user_extracted_idx"
    ).on(t.userId, t.lastExtractedAt),
  })
);

export type AgentContactPersona = typeof agentContactPersonas.$inferSelect;
export type NewAgentContactPersona = typeof agentContactPersonas.$inferInsert;

// One row per inbox_item holding the OpenAI `text-embedding-3-small` 1536-dim
// vector of its subject+body. Used by L2 deep-pass retrieval to surface
// similar past emails. Scope is per-user — cross-user retrieval is a privacy
// boundary enforced with WHERE user_id = $1 at every call site.
export const emailEmbeddings = pgTable(
  "email_embeddings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    inboxItemId: uuid("inbox_item_id")
      .notNull()
      .references(() => inboxItems.id, { onDelete: "cascade" }),
    embedding: vector("embedding", 1536).notNull(),
    model: text("model").notNull().default("text-embedding-3-small"),
    tokenCount: integer("token_count").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    inboxItemUnique: uniqueIndex("email_embeddings_inbox_item_unique").on(
      t.inboxItemId
    ),
    userIdx: index("email_embeddings_user_idx").on(t.userId),
  })
);

export type EmailEmbedding = typeof emailEmbeddings.$inferSelect;
export type NewEmailEmbedding = typeof emailEmbeddings.$inferInsert;

// ---------------------------------------------------------------------------
// Phase 6 W3 — Send queue (10s undo window dispatcher)
// ---------------------------------------------------------------------------

export type SendQueueStatus =
  | "pending"
  // polish-13b — exclusive claim by a single cron tick. Acquired via
  // UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED). Transitions
  // to 'sent' on success or 'failed' on Gmail-API error. A stale-claim
  // sweep at cron entry flips rows stuck >5 min back to 'pending' so a
  // crashed worker doesn't strand its row.
  | "processing"
  | "sent"
  | "cancelled"
  | "failed";

// One row per approved agent_draft that's waiting out the undo window.
// The cron worker at /api/cron/send-queue picks rows with status='pending'
// AND send_at <= now() and promotes them via Gmail users.drafts.send.
// `gmail_draft_id` is returned from an initial users.drafts.create call so
// the user can also see the pending draft in Gmail's own UI during the
// window — and so cancellation is a clean drafts.delete.
export const sendQueue = pgTable(
  "send_queue",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    agentDraftId: uuid("agent_draft_id")
      .notNull()
      .references(() => agentDrafts.id, { onDelete: "cascade" }),
    gmailDraftId: text("gmail_draft_id").notNull(),
    sendAt: timestamp("send_at", { mode: "date", withTimezone: true })
      .notNull(),
    status: text("status")
      .$type<SendQueueStatus>()
      .notNull()
      .default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    attemptedAt: timestamp("attempted_at", {
      mode: "date",
      withTimezone: true,
    }),
    // polish-13b — set when a cron tick atomically claims the row
    // (status: pending → processing). Used by the stale-claim sweep
    // to detect rows held >5 min by a presumed-dead worker.
    processingStartedAt: timestamp("processing_started_at", {
      mode: "date",
      withTimezone: true,
    }),
    lastError: text("last_error"),
    sentGmailMessageId: text("sent_gmail_message_id"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    statusSendAtIdx: index("send_queue_status_send_at_idx").on(
      t.status,
      t.sendAt
    ),
    userStatusIdx: index("send_queue_user_status_idx").on(t.userId, t.status),
    agentDraftUnique: uniqueIndex("send_queue_agent_draft_unique").on(
      t.agentDraftId
    ),
  })
);

export type SendQueueRow = typeof sendQueue.$inferSelect;
export type NewSendQueueRow = typeof sendQueue.$inferInsert;

// ---------------------------------------------------------------------------
// Phase 7 Pre-W1 — Postgres-canonical academic entities
//
// Replaces the prior Notion-canonical model for Classes / Mistake Notes /
// Assignments / Syllabi. Notion stays as an optional one-way import surface
// during α (notion_connections + registered_resources stay live for
// rollback safety). `notion_page_id` columns make the import idempotent via
// ON CONFLICT (user_id, notion_page_id) DO UPDATE.
// ---------------------------------------------------------------------------

export type ClassStatus = "active" | "archived";
export type ClassColorEnum =
  | "blue"
  | "green"
  | "orange"
  | "purple"
  | "red"
  | "gray"
  | "brown"
  | "pink";

export const classes = pgTable(
  "classes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    code: text("code"),
    term: text("term"),
    professor: text("professor"),
    color: text("color").$type<ClassColorEnum>(),
    status: text("status").$type<ClassStatus>().notNull().default("active"),
    notionPageId: text("notion_page_id"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { mode: "date", withTimezone: true }),
  },
  (t) => ({
    userStatusIdx: index("classes_user_status_idx")
      .on(t.userId, t.status)
      .where(sql`deleted_at IS NULL`),
    userNotionPageIdx: uniqueIndex("classes_user_notion_page_idx")
      .on(t.userId, t.notionPageId)
      .where(sql`notion_page_id IS NOT NULL`),
  })
);

export type ClassRow = typeof classes.$inferSelect;
export type NewClassRow = typeof classes.$inferInsert;

export type MistakeBodyFormat = "markdown" | "tiptap_json";
export type MistakeDifficulty = "easy" | "medium" | "hard";
export type MistakeSource = "user_typed" | "handwritten_ocr";

// Mistake Notes — α v1 ships markdown only. The body_format discriminator +
// dual columns exist so a future flip to TipTap JSON is a forward-only
// column-populate migration (not a rewrite).
export const mistakeNotes = pgTable(
  "mistake_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    classId: uuid("class_id").references(() => classes.id, {
      onDelete: "set null",
    }),

    title: text("title").notNull(),
    unit: text("unit"),
    difficulty: text("difficulty").$type<MistakeDifficulty>(),
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),

    bodyFormat: text("body_format")
      .$type<MistakeBodyFormat>()
      .notNull()
      .default("markdown"),
    bodyMarkdown: text("body_markdown"),
    bodyDoc: jsonb("body_doc"),

    // Phase 7 W-Notes — discriminator for how the body_markdown was produced.
    // Existing rows backfill to "user_typed". Handwritten-OCR rows carry the
    // source blob asset id so the original scan stays linked.
    source: text("source")
      .$type<MistakeSource>()
      .notNull()
      .default("user_typed"),
    sourceBlobAssetId: uuid("source_blob_asset_id").references(
      () => blobAssets.id,
      { onDelete: "set null" }
    ),

    sourceChatId: uuid("source_chat_id").references(() => chats.id, {
      onDelete: "set null",
    }),
    sourceAssistantMsgId: uuid("source_assistant_msg_id").references(
      () => messages.id,
      { onDelete: "set null" }
    ),
    sourceUserQuestion: text("source_user_question"),
    sourceExplanation: text("source_explanation"),

    notionPageId: text("notion_page_id"),

    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { mode: "date", withTimezone: true }),
  },
  (t) => ({
    userClassIdx: index("mistake_notes_user_class_idx")
      .on(t.userId, t.classId)
      .where(sql`deleted_at IS NULL`),
    userCreatedIdx: index("mistake_notes_user_created_idx")
      .on(t.userId, t.createdAt)
      .where(sql`deleted_at IS NULL`),
    userTagsIdx: index("mistake_notes_user_tags_idx").using("gin", t.tags),
    userNotionPageIdx: uniqueIndex("mistake_notes_user_notion_page_idx")
      .on(t.userId, t.notionPageId)
      .where(sql`notion_page_id IS NOT NULL`),
  })
);

export type MistakeNoteRow = typeof mistakeNotes.$inferSelect;
export type NewMistakeNoteRow = typeof mistakeNotes.$inferInsert;

// Per-image attachment row. Multi-row beats a TEXT[] of urls because
// ON DELETE CASCADE through blob_assets makes storage cleanup automatic
// and per-image position/alt-text fields stay normalized.
export const mistakeNoteImages = pgTable(
  "mistake_note_images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mistakeId: uuid("mistake_id")
      .notNull()
      .references(() => mistakeNotes.id, { onDelete: "cascade" }),
    blobAssetId: uuid("blob_asset_id").references(() => blobAssets.id, {
      onDelete: "set null",
    }),
    url: text("url").notNull(),
    position: integer("position").notNull().default(0),
    altText: text("alt_text"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    mistakePositionIdx: index("mistake_note_images_mistake_idx").on(
      t.mistakeId,
      t.position
    ),
  })
);

export type MistakeNoteImageRow = typeof mistakeNoteImages.$inferSelect;
export type NewMistakeNoteImageRow = typeof mistakeNoteImages.$inferInsert;

export type AssignmentStatus = "not_started" | "in_progress" | "done";
export type AssignmentPriority = "low" | "medium" | "high";
export type AssignmentSource = "manual" | "classroom" | "chat";

export const assignments = pgTable(
  "assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    classId: uuid("class_id").references(() => classes.id, {
      onDelete: "set null",
    }),

    title: text("title").notNull(),
    dueAt: timestamp("due_at", { mode: "date", withTimezone: true }),
    status: text("status")
      .$type<AssignmentStatus>()
      .notNull()
      .default("not_started"),
    priority: text("priority").$type<AssignmentPriority>(),
    notes: text("notes"),

    source: text("source")
      .$type<AssignmentSource>()
      .notNull()
      .default("manual"),
    externalId: text("external_id"),

    notionPageId: text("notion_page_id"),

    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { mode: "date", withTimezone: true }),
  },
  (t) => ({
    userDueIdx: index("assignments_user_due_idx")
      .on(t.userId, t.dueAt)
      .where(sql`deleted_at IS NULL AND status != 'done'`),
    userClassIdx: index("assignments_user_class_idx")
      .on(t.userId, t.classId)
      .where(sql`deleted_at IS NULL`),
    userExternalIdx: uniqueIndex("assignments_user_external_idx")
      .on(t.userId, t.source, t.externalId)
      .where(sql`external_id IS NOT NULL`),
    userNotionPageIdx: uniqueIndex("assignments_user_notion_page_idx")
      .on(t.userId, t.notionPageId)
      .where(sql`notion_page_id IS NOT NULL`),
  })
);

export type AssignmentRow = typeof assignments.$inferSelect;
export type NewAssignmentRow = typeof assignments.$inferInsert;

export type SyllabusSourceKind = "pdf" | "image" | "url";
export type SyllabusScheduleItem = { date: string | null; topic: string | null };

export const syllabi = pgTable(
  "syllabi",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    classId: uuid("class_id").references(() => classes.id, {
      onDelete: "set null",
    }),

    title: text("title").notNull(),
    term: text("term"),
    grading: text("grading"),
    attendance: text("attendance"),
    textbooks: text("textbooks"),
    officeHours: text("office_hours"),
    sourceUrl: text("source_url"),
    sourceKind: text("source_kind").$type<SyllabusSourceKind>(),

    fullText: text("full_text"),
    schedule: jsonb("schedule").$type<SyllabusScheduleItem[]>(),

    blobAssetId: uuid("blob_asset_id").references(() => blobAssets.id, {
      onDelete: "set null",
    }),
    blobUrl: text("blob_url"),
    blobFilename: text("blob_filename"),
    blobMimeType: text("blob_mime_type"),
    blobSizeBytes: integer("blob_size_bytes"),

    notionPageId: text("notion_page_id"),

    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { mode: "date", withTimezone: true }),
  },
  (t) => ({
    userClassIdx: index("syllabi_user_class_idx")
      .on(t.userId, t.classId)
      .where(sql`deleted_at IS NULL`),
    userNotionPageIdx: uniqueIndex("syllabi_user_notion_page_idx")
      .on(t.userId, t.notionPageId)
      .where(sql`notion_page_id IS NOT NULL`),
  })
);

export type SyllabusRow = typeof syllabi.$inferSelect;
export type NewSyllabusRow = typeof syllabi.$inferInsert;

// Per-entity chunk tables for Phase 7 W1 fanout retrieval. Same shape as
// email_embeddings (1536-dim text-embedding-3-small). pgvector index
// (IVFFlat / HNSW) is deferred until α volume justifies it — sequential
// scans are fine at single-user dogfood scale.
export const mistakeNoteChunks = pgTable(
  "mistake_note_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    mistakeId: uuid("mistake_id")
      .notNull()
      .references(() => mistakeNotes.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    chunkText: text("chunk_text").notNull(),
    embedding: vector("embedding", 1536).notNull(),
    model: text("model").notNull().default("text-embedding-3-small"),
    tokenCount: integer("token_count").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userIdx: index("mistake_note_chunks_user_idx").on(t.userId),
    mistakeChunkIdx: uniqueIndex("mistake_note_chunks_mistake_chunk_idx").on(
      t.mistakeId,
      t.chunkIndex
    ),
  })
);

export type MistakeNoteChunk = typeof mistakeNoteChunks.$inferSelect;
export type NewMistakeNoteChunk = typeof mistakeNoteChunks.$inferInsert;

export const syllabusChunks = pgTable(
  "syllabus_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    syllabusId: uuid("syllabus_id")
      .notNull()
      .references(() => syllabi.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    chunkText: text("chunk_text").notNull(),
    embedding: vector("embedding", 1536).notNull(),
    model: text("model").notNull().default("text-embedding-3-small"),
    tokenCount: integer("token_count").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userIdx: index("syllabus_chunks_user_idx").on(t.userId),
    syllabusChunkIdx: uniqueIndex("syllabus_chunks_syllabus_chunk_idx").on(
      t.syllabusId,
      t.chunkIndex
    ),
  })
);

export type SyllabusChunk = typeof syllabusChunks.$inferSelect;
export type NewSyllabusChunk = typeof syllabusChunks.$inferInsert;

// ---------------------------------------------------------------------------
// Phase 7 W-Integrations — iCal subscriptions
// ---------------------------------------------------------------------------

// One per user-pasted webcal:// or https:// .ics URL. Sync runs every 6h
// via /api/cron/ical-sync; events flow into the shared `events` mirror
// table with sourceType='ical_subscription'. Bandwidth-conscious sync uses
// the stored ETag in a conditional GET — most polls return 304 and skip
// parsing entirely. After 3 consecutive failures the row is auto-deactivated
// (active=false) and the user sees the lastError surface in Settings.
export const icalSubscriptions = pgTable(
  "ical_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    label: text("label"),
    active: boolean("active").notNull().default(true),
    lastSyncedAt: timestamp("last_synced_at", {
      mode: "date",
      withTimezone: true,
    }),
    lastError: text("last_error"),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    etag: text("etag"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userIdx: index("ical_subscriptions_user_idx").on(t.userId),
  })
);

export type IcalSubscription = typeof icalSubscriptions.$inferSelect;
export type NewIcalSubscription = typeof icalSubscriptions.$inferInsert;

// ---------------------------------------------------------------------------
// Phase 7 W-Integrations — Suggestion subsystem
// ---------------------------------------------------------------------------

// Stable IDs for the integrations Steadii can suggest. Add a new entry here
// when shipping a new integration; the suggestion eligibility helpers branch
// on this string to decide which "is connected?" check to run.
export type IntegrationSourceId =
  | "microsoft"
  | "ical"
  | "notion";

// Where in the product the suggestion was rendered. Used to attribute
// impressions back to the surface so we can tell e.g. "Trigger A inbox
// pill" from "Step 2 onboarding card" in analytics. Onboarding Step 2 is
// the only Surface 1 today; the three named triggers are Surface 2 entries.
export type SuggestionSurface =
  | "onboarding_step2"
  | "trigger_inbox_outlook"
  | "trigger_chat_ical"
  | "trigger_mistakes_notion";

// One row per (user, source, surface) impression so the eligibility helper
// can enforce the 7-day-per-source cap (Q4) — the cap is computed against
// the most-recent impression across ALL surfaces for the same source. We
// never write more than one impression per render, so a single page view
// is one row.
export const integrationSuggestionImpressions = pgTable(
  "integration_suggestion_impressions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    source: text("source").$type<IntegrationSourceId>().notNull(),
    surface: text("surface").$type<SuggestionSurface>().notNull(),
    shownAt: timestamp("shown_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userSourceIdx: index("integration_suggestion_impressions_user_source_idx").on(
      t.userId,
      t.source,
      t.shownAt
    ),
  })
);

// One row per dismissal across the lifetime of a (user, source). After the
// 3rd row the source is permanently suppressed for the user (Q4). Connect
// events do NOT clear dismissals; they're a separate signal — once the
// account row exists for the corresponding provider, the eligibility
// helper short-circuits before reading dismissals.
export const integrationSuggestionDismissals = pgTable(
  "integration_suggestion_dismissals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    source: text("source").$type<IntegrationSourceId>().notNull(),
    surface: text("surface").$type<SuggestionSurface>().notNull(),
    dismissedAt: timestamp("dismissed_at", {
      mode: "date",
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userSourceIdx: index("integration_suggestion_dismissals_user_source_idx").on(
      t.userId,
      t.source
    ),
  })
);

export type IntegrationSuggestionImpression =
  typeof integrationSuggestionImpressions.$inferSelect;
export type IntegrationSuggestionDismissal =
  typeof integrationSuggestionDismissals.$inferSelect;

// Phase 7 W-Waitlist — α access control. Public form writes one row per
// request; admin gates approval; signIn callback checks status before
// letting Google OAuth complete in production. Email is canonicalised
// to lower-case on write so the lookup in the signIn callback is a
// single equality check.
export const waitlistRequests = pgTable(
  "waitlist_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    name: text("name"),
    university: text("university"),
    reason: text("reason"),
    status: text("status")
      .$type<"pending" | "approved" | "denied">()
      .notNull()
      .default("pending"),
    requestedAt: timestamp("requested_at", { mode: "date" })
      .notNull()
      .defaultNow(),
    approvedAt: timestamp("approved_at", { mode: "date" }),
    emailSentAt: timestamp("email_sent_at", { mode: "date" }),
    googleTestUserAddedAt: timestamp("google_test_user_added_at", {
      mode: "date",
    }),
    signedInAt: timestamp("signed_in_at", { mode: "date" }),
    approvedBy: uuid("approved_by").references(() => users.id, {
      onDelete: "set null",
    }),
    notes: text("notes"),
    stripePromotionCode: text("stripe_promotion_code"),
    inviteUrl: text("invite_url"),
  },
  (t) => ({
    emailUniqueIdx: uniqueIndex("waitlist_requests_email_unique_idx").on(
      t.email
    ),
    statusIdx: index("waitlist_requests_status_idx").on(t.status),
  })
);

export type WaitlistRequest = typeof waitlistRequests.$inferSelect;
export type NewWaitlistRequest = typeof waitlistRequests.$inferInsert;

// ---------------------------------------------------------------------------
// Phase 8 — Proactive agent (event log + proposals)
// ---------------------------------------------------------------------------

// Every meaningful change that should trigger a scan. Inserted by the write
// hooks (calendar / syllabus / assignment / mistake / inbox) and by the
// daily cron fallback. Processed by lib/agent/proactive/scanner.ts.
export type AgentEventSource =
  | "calendar.created"
  | "calendar.updated"
  | "calendar.deleted"
  | "syllabus.uploaded"
  | "syllabus.deleted"
  | "assignment.created"
  | "assignment.updated"
  | "assignment.deleted"
  | "mistake.created"
  | "mistake.updated"
  | "inbox.classified"
  | "cron.daily";

export type AgentEventStatus =
  | "pending"
  // polish-13b — distributed lock state. Inserted with status='running'
  // via the partial unique index agent_events_running_per_user_idx, which
  // permits at most one running row per user. Two near-simultaneous
  // triggers on different serverless instances thus collapse into a
  // single scan: the loser sees a unique-violation and returns early.
  // Transitions to 'analyzed' / 'no_issue' / 'error' when the scan
  // completes (or to 'error' if a stale-claim sweep flips a row stuck
  // >10 min by a presumed-dead worker).
  | "running"
  | "analyzed"
  | "no_issue"
  | "error";

export const agentEvents = pgTable(
  "agent_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    source: text("source").$type<AgentEventSource>().notNull(),
    sourceRecordId: text("source_record_id"),
    status: text("status")
      .$type<AgentEventStatus>()
      .notNull()
      .default("pending"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
    analyzedAt: timestamp("analyzed_at", { mode: "date", withTimezone: true }),
  },
  (t) => ({
    userPendingIdx: index("agent_events_user_pending_idx").on(
      t.userId,
      t.status,
      t.createdAt
    ),
    // polish-13b — partial unique index enforcing at most one running
    // claim per user. The proactive scanner inserts with status='running'
    // via ON CONFLICT DO NOTHING; the second concurrent caller sees no
    // row returned and short-circuits. Historical analyzed / no_issue /
    // error rows are unconstrained.
    runningPerUserIdx: uniqueIndex("agent_events_running_per_user_idx")
      .on(t.userId)
      .where(sql`${t.status} = 'running'`),
  })
);

export type AgentEventRow = typeof agentEvents.$inferSelect;
export type NewAgentEventRow = typeof agentEvents.$inferInsert;

// Proactive issue surfaces — one row per detected (or auto-action-logged)
// item. Issues with `status='pending'` await the user's click in the inbox
// "Steadii noticed" section; status transitions on resolve / dismiss /
// expire. The dedup index (userId + dedupKey) guards the 24h re-surface
// window described in D2 — recreate-after-expire happens by recomputing
// the same key after the prior row was set to `expired`.
export type AgentProposalIssueType =
  | "time_conflict"
  | "exam_conflict"
  | "deadline_during_travel"
  | "exam_under_prepared"
  | "workload_over_capacity"
  | "syllabus_calendar_ambiguity"
  // D11 — informational "Steadii did X" log entry. status='resolved' on
  // creation; surfaces in inbox as a muted row until viewed.
  | "auto_action_log"
  // Admin-targeted: a new waitlist request landed and needs human
  // approve/deny. One row per (admin_user, waitlist_request); cleared
  // to status='dismissed' when the matching request flips status.
  | "admin_waitlist_pending"
  // Wave 3.2 — group project detection. Surfaces as a Type E clarifying
  // card; user confirm spawns a `group_projects` row.
  | "group_project_detected"
  // Wave 3.2 — silence detection. Surfaces as a Type C card; click
  // opens the group detail page where Steadii drafts a check-in.
  | "group_member_silent";

export type AgentProposalStatus =
  | "pending"
  | "resolved"
  | "dismissed"
  | "expired";

export type AgentProposalActionTool =
  | "email_professor"
  | "reschedule_event"
  | "delete_event"
  | "create_task"
  | "chat_followup"
  | "add_mistake_note"
  | "link_existing"
  | "add_anyway"
  | "auto"
  | "dismiss";

// One option in a proposal's action menu. `payload` is pre-filled args
// for the named tool — passed verbatim to the resolver endpoint when
// the user picks this key.
export type ActionOption = {
  key: string;
  label: string;
  description: string;
  tool: AgentProposalActionTool;
  payload: Record<string, unknown>;
};

// `kind` discriminates the source label/url shape so the detail page can
// render a deep-link back to the originating record (e.g., a calendar
// event, an assignment row, a syllabus PDF).
export type ProposalSourceRef = {
  kind:
    | "calendar_event"
    | "assignment"
    | "syllabus"
    | "syllabus_event"
    | "class"
    | "mistake"
    | "inbox_item"
    | "waitlist_request";
  id: string;
  label: string;
};

export const agentProposals = pgTable(
  "agent_proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    triggerEventId: uuid("trigger_event_id").references(() => agentEvents.id, {
      onDelete: "set null",
    }),

    issueType: text("issue_type").$type<AgentProposalIssueType>().notNull(),
    issueSummary: text("issue_summary").notNull(),
    reasoning: text("reasoning").notNull(),
    sourceRefs: jsonb("source_refs")
      .$type<ProposalSourceRef[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),

    actionOptions: jsonb("action_options")
      .$type<ActionOption[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),

    // sha256(issueType + sorted source_record_ids). Per-user unique,
    // so identical re-detections don't double-surface.
    dedupKey: text("dedup_key").notNull(),

    status: text("status")
      .$type<AgentProposalStatus>()
      .notNull()
      .default("pending"),
    resolvedAction: text("resolved_action"),
    resolvedAt: timestamp("resolved_at", { mode: "date", withTimezone: true }),
    viewedAt: timestamp("viewed_at", { mode: "date", withTimezone: true }),

    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true }),
  },
  (t) => ({
    userPendingIdx: index("agent_proposals_user_pending_idx").on(
      t.userId,
      t.status,
      t.createdAt
    ),
    dedupIdx: uniqueIndex("agent_proposals_dedup_idx").on(t.userId, t.dedupKey),
  })
);

export type AgentProposalRow = typeof agentProposals.$inferSelect;
export type NewAgentProposalRow = typeof agentProposals.$inferInsert;

// ---------------------------------------------------------------------------
// Wave 3 — Meeting pre-brief (Wave 3.1)
// ---------------------------------------------------------------------------

// One row per (user, calendar event) brief generation. The cron generates
// these 15 min before the event with attendees; the queue surfaces the row
// as a Type B informational card. Cache invalidation is implicit — the
// cron checks `expires_at` and the cache-bust signals (last attendee email
// timestamp, last task added) before re-using a cached row.
export type PreBriefBullet = {
  // Short headline ("Last email from Prof Tanaka — extension granted")
  text: string;
  // Optional source kind for chip rendering on detail page.
  kind?: "email" | "task" | "deadline" | "mistake" | "syllabus" | "decision";
  // Optional href to jump to the underlying record.
  href?: string;
};

export const eventPreBriefs = pgTable(
  "event_pre_briefs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    // Cached LLM output — 4-6 bullets covering the dimensions in the spec.
    bullets: jsonb("bullets")
      .$type<PreBriefBullet[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    // Long-form executive briefing rendered on the detail page. Single
    // paragraph per topic; markdown allowed.
    detailMarkdown: text("detail_markdown"),
    attendeeEmails: text("attendee_emails")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    // Cache-bust hash composed of (last attendee email id ∪ last task id ∪
    // event updated_at). The cron compares this against the live signal
    // before reusing the cached row; mismatch means regenerate.
    cacheKey: text("cache_key").notNull(),
    // Cost analytics — links to the usage_events row that paid for this brief.
    usageId: uuid("usage_id").references(() => usageEvents.id, {
      onDelete: "set null",
    }),
    // The cron schedules briefs for events in the next 30 min. expires_at is
    // set to event_starts_at + 1h so post-meeting briefs still appear briefly
    // for the "what did I just talk about" use case but eventually drop.
    expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true })
      .notNull(),
    viewedAt: timestamp("viewed_at", { mode: "date", withTimezone: true }),
    dismissedAt: timestamp("dismissed_at", { mode: "date", withTimezone: true }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userEventIdx: uniqueIndex("event_pre_briefs_user_event_idx").on(
      t.userId,
      t.eventId
    ),
    userExpiresIdx: index("event_pre_briefs_user_expires_idx").on(
      t.userId,
      t.expiresAt
    ),
  })
);

export type EventPreBriefRow = typeof eventPreBriefs.$inferSelect;
export type NewEventPreBriefRow = typeof eventPreBriefs.$inferInsert;

// ---------------------------------------------------------------------------
// Wave 3 — Group project coordinator (Wave 3.2)
// ---------------------------------------------------------------------------

export type GroupProjectStatus = "active" | "done" | "abandoned";
export type GroupProjectDetectionMethod = "auto" | "manual";
export type GroupProjectMemberStatus = "active" | "silent" | "done";

export const groupProjects = pgTable(
  "group_projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    classId: uuid("class_id").references(() => classes.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    deadline: timestamp("deadline", { mode: "date", withTimezone: true }),
    sourceThreadIds: text("source_thread_ids")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    detectionMethod: text("detection_method")
      .$type<GroupProjectDetectionMethod>()
      .notNull(),
    status: text("status")
      .$type<GroupProjectStatus>()
      .notNull()
      .default("active"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userStatusIdx: index("group_projects_user_status_idx").on(
      t.userId,
      t.status
    ),
  })
);

export type GroupProjectRow = typeof groupProjects.$inferSelect;
export type NewGroupProjectRow = typeof groupProjects.$inferInsert;

export const groupProjectMembers = pgTable(
  "group_project_members",
  {
    groupProjectId: uuid("group_project_id")
      .notNull()
      .references(() => groupProjects.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    name: text("name"),
    role: text("role"),
    lastRespondedAt: timestamp("last_responded_at", {
      mode: "date",
      withTimezone: true,
    }),
    lastMessageAt: timestamp("last_message_at", {
      mode: "date",
      withTimezone: true,
    }),
    status: text("status")
      .$type<GroupProjectMemberStatus>()
      .notNull()
      .default("active"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.groupProjectId, t.email] }),
  })
);

export type GroupProjectMemberRow =
  typeof groupProjectMembers.$inferSelect;
export type NewGroupProjectMemberRow =
  typeof groupProjectMembers.$inferInsert;

export const groupProjectTasks = pgTable(
  "group_project_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupProjectId: uuid("group_project_id")
      .notNull()
      .references(() => groupProjects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    assigneeEmail: text("assignee_email"),
    due: timestamp("due", { mode: "date", withTimezone: true }),
    doneAt: timestamp("done_at", { mode: "date", withTimezone: true }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    groupIdx: index("group_project_tasks_group_idx").on(t.groupProjectId),
  })
);

export type GroupProjectTaskRow = typeof groupProjectTasks.$inferSelect;
export type NewGroupProjectTaskRow = typeof groupProjectTasks.$inferInsert;

// ---------------------------------------------------------------------------
// Wave 3 — Office hours scheduler (Wave 3.3)
// ---------------------------------------------------------------------------

// Per-class office hours slots, extracted from the syllabus. One row per
// recurring slot the prof publishes (e.g. "Tue 14:00-16:00 in MP203").
// The scheduler tool composes specific calendar dates from these slots
// when the user asks to schedule office hours; the slots themselves are
// recurring, not date-specific.
export type OfficeHoursSlot = {
  // 0 = Sunday, 1 = Monday, ... 6 = Saturday. Aligned with JS Date.getDay().
  weekday: number;
  // 24-hour HH:MM format in the prof's local timezone (which we assume
  // matches the user's timezone — α is single-region per user).
  startTime: string;
  endTime: string;
  // Optional location ("MP203", "Zoom: <url>", "by appointment").
  location?: string;
  // Optional notes ("by appointment only", "first-come first-served").
  notes?: string;
};

export const classOfficeHours = pgTable(
  "class_office_hours",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    classId: uuid("class_id")
      .notNull()
      .references(() => classes.id, { onDelete: "cascade" }),
    syllabusId: uuid("syllabus_id").references(() => syllabi.id, {
      onDelete: "set null",
    }),
    professorEmail: text("professor_email"),
    professorName: text("professor_name"),
    slots: jsonb("slots")
      .$type<OfficeHoursSlot[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    // Free-form text section that didn't parse into structured slots; shown
    // verbatim alongside the slot picker as a fallback.
    rawNote: text("raw_note"),
    // External booking link if one was extracted (Calendly, Cal.com, etc.).
    bookingUrl: text("booking_url"),
    extractedAt: timestamp("extracted_at", {
      mode: "date",
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userClassIdx: index("class_office_hours_user_class_idx").on(
      t.userId,
      t.classId
    ),
  })
);

export type ClassOfficeHoursRow = typeof classOfficeHours.$inferSelect;
export type NewClassOfficeHoursRow = typeof classOfficeHours.$inferInsert;

// One in-flight office-hours-scheduling request per user. Surfaces to
// the queue as Type A while pending (slot picker), then upgrades to
// Type B when the user picks a slot and the email draft is generated.
// Final transitions: 'sent' (email out + provisional calendar event),
// 'dismissed' (user backed out).
export type OfficeHoursRequestStatus =
  | "pending"
  | "confirmed"
  | "sent"
  | "dismissed";

export type OfficeHoursCandidateSlot = {
  // ISO datetime — the specific date/time we're proposing.
  startsAt: string;
  endsAt: string;
  location?: string;
};

export type OfficeHoursCompiledQuestion = {
  // Display label rendered on the Type A card and the email body.
  label: string;
  // Source kind for the chip on the card.
  source: "mistake" | "email" | "chat" | "task";
  // Optional href to the underlying record.
  href?: string;
};

export const officeHoursRequests = pgTable(
  "office_hours_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    classId: uuid("class_id").references(() => classes.id, {
      onDelete: "set null",
    }),
    professorEmail: text("professor_email"),
    professorName: text("professor_name"),
    topic: text("topic"),
    candidateSlots: jsonb("candidate_slots")
      .$type<OfficeHoursCandidateSlot[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    compiledQuestions: jsonb("compiled_questions")
      .$type<OfficeHoursCompiledQuestion[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    pickedSlotIndex: integer("picked_slot_index"),
    draftSubject: text("draft_subject"),
    draftBody: text("draft_body"),
    draftTo: text("draft_to"),
    sentMessageId: text("sent_message_id"),
    sentEventId: uuid("sent_event_id"),
    status: text("status")
      .$type<OfficeHoursRequestStatus>()
      .notNull()
      .default("pending"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userStatusIdx: index("office_hours_requests_user_status_idx").on(
      t.userId,
      t.status
    ),
  })
);

export type OfficeHoursRequestRow = typeof officeHoursRequests.$inferSelect;
export type NewOfficeHoursRequestRow =
  typeof officeHoursRequests.$inferInsert;

// ---------------------------------------------------------------------------
// Wave 5 — cron heartbeats
// ---------------------------------------------------------------------------

// One row per cron name. Each cron handler upserts on tick start/end so a
// missed-tick monitor can compare last_tick_at vs the cron's expected
// cadence. Stays a single small table — no per-tick history; if we need
// retention later we'll add a sibling table.
export const cronHeartbeats = pgTable("cron_heartbeats", {
  name: text("name").primaryKey(),
  lastTickAt: timestamp("last_tick_at", {
    mode: "date",
    withTimezone: true,
  }).notNull(),
  lastStatus: text("last_status")
    .$type<"ok" | "error">()
    .notNull()
    .default("ok"),
  lastDurationMs: integer("last_duration_ms"),
  lastError: text("last_error"),
  updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type CronHeartbeatRow = typeof cronHeartbeats.$inferSelect;

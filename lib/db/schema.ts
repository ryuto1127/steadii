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
  undoWindowSeconds: smallint("undo_window_seconds").notNull().default(20),
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
  source: text("source").$type<"chat_attachment" | "syllabus">().notNull(),
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
  })
);

export type InboxItem = typeof inboxItems.$inferSelect;
export type NewInboxItem = typeof inboxItems.$inferInsert;

export type AgentRuleScope =
  | "sender"
  | "domain"
  | "subject_keyword"
  | "thread";
export type AgentRuleSource = "learned" | "manual" | "chat";

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
  // W3 addition — in-flight between Send click and the 20s undo worker
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
  // backwards-compat reason. mistakes/syllabus reflect chunk counts;
  // calendar = events + tasks + steadii assignments combined.
  fanoutCounts?: {
    mistakes: number;
    syllabus: number;
    emails: number;
    calendar: number;
  } | null;
  // Per-source timing in ms — surfaced in admin metrics. Optional.
  fanoutTimings?: {
    mistakes: number;
    syllabus: number;
    emails: number;
    calendar: number;
    total: number;
  } | null;
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
// Phase 6 W3 — Send queue (20s undo window dispatcher)
// ---------------------------------------------------------------------------

export type SendQueueStatus =
  | "pending"
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

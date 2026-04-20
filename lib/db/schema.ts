import {
  pgTable,
  text,
  timestamp,
  primaryKey,
  integer,
  uuid,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name"),
  email: text("email").notNull(),
  emailVerified: timestamp("email_verified", { mode: "date" }),
  image: text("image"),
  preferences: jsonb("preferences").$type<{
    theme?: "light" | "dark" | "system";
    locale?: "en" | "ja";
    agentConfirmationMode?: "destructive_only" | "all" | "none";
  }>().default({}),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { mode: "date" }),
}, (table) => ({
  emailIdx: uniqueIndex("users_email_idx").on(table.email),
}));

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

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type NotionConnection = typeof notionConnections.$inferSelect;
export type RegisteredResource = typeof registeredResources.$inferSelect;
export type AuditLogRow = typeof auditLog.$inferSelect;

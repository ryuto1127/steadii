import { describe, expect, it } from "vitest";
import {
  users,
  accounts,
  sessions,
  verificationTokens,
  chats,
  messages,
  messageAttachments,
  usageEvents,
  pendingToolCalls,
} from "@/lib/db/schema";
import { getTableColumns } from "drizzle-orm";

describe("Drizzle schema — Phase 0 tables", () => {
  it("users has id, email, timestamps, soft delete", () => {
    const cols = getTableColumns(users);
    expect(cols.id).toBeDefined();
    expect(cols.email).toBeDefined();
    expect(cols.createdAt).toBeDefined();
    expect(cols.updatedAt).toBeDefined();
    expect(cols.deletedAt).toBeDefined();
    expect(cols.preferences).toBeDefined();
  });

  it("accounts has standard Auth.js columns", () => {
    const cols = getTableColumns(accounts);
    expect(cols.userId).toBeDefined();
    expect(cols.provider).toBeDefined();
    expect(cols.providerAccountId).toBeDefined();
    expect(cols.access_token).toBeDefined();
    expect(cols.refresh_token).toBeDefined();
  });

  it("sessions keyed by sessionToken", () => {
    const cols = getTableColumns(sessions);
    expect(cols.sessionToken).toBeDefined();
    expect(cols.userId).toBeDefined();
    expect(cols.expires).toBeDefined();
  });

  it("verificationTokens has identifier/token/expires", () => {
    const cols = getTableColumns(verificationTokens);
    expect(cols.identifier).toBeDefined();
    expect(cols.token).toBeDefined();
    expect(cols.expires).toBeDefined();
  });

  it("users id is UUID-typed", () => {
    const cols = getTableColumns(users);
    expect(cols.id.columnType).toBe("PgUUID");
  });
});

describe("Drizzle schema — Phase 2 chat tables", () => {
  it("chats has user_id, title, timestamps, soft delete", () => {
    const cols = getTableColumns(chats);
    expect(cols.userId).toBeDefined();
    expect(cols.title).toBeDefined();
    expect(cols.createdAt).toBeDefined();
    expect(cols.updatedAt).toBeDefined();
    expect(cols.deletedAt).toBeDefined();
  });

  it("messages has chat_id, role, content, tool fields, model", () => {
    const cols = getTableColumns(messages);
    expect(cols.chatId).toBeDefined();
    expect(cols.role).toBeDefined();
    expect(cols.content).toBeDefined();
    expect(cols.toolCalls).toBeDefined();
    expect(cols.toolCallId).toBeDefined();
    expect(cols.model).toBeDefined();
    expect(cols.deletedAt).toBeDefined();
  });

  it("message_attachments has kind, url, mime, size", () => {
    const cols = getTableColumns(messageAttachments);
    expect(cols.messageId).toBeDefined();
    expect(cols.kind).toBeDefined();
    expect(cols.url).toBeDefined();
    expect(cols.mimeType).toBeDefined();
    expect(cols.sizeBytes).toBeDefined();
  });

  it("usage_events records model, task_type, token counts, credits", () => {
    const cols = getTableColumns(usageEvents);
    expect(cols.userId).toBeDefined();
    expect(cols.chatId).toBeDefined();
    expect(cols.messageId).toBeDefined();
    expect(cols.model).toBeDefined();
    expect(cols.taskType).toBeDefined();
    expect(cols.inputTokens).toBeDefined();
    expect(cols.outputTokens).toBeDefined();
    expect(cols.cachedTokens).toBeDefined();
    expect(cols.creditsUsed).toBeDefined();
  });
});

describe("Drizzle schema — Phase 3 pending_tool_calls", () => {
  it("has status transitions, tool info, chat/user foreign keys", () => {
    const cols = getTableColumns(pendingToolCalls);
    expect(cols.userId).toBeDefined();
    expect(cols.chatId).toBeDefined();
    expect(cols.toolName).toBeDefined();
    expect(cols.toolCallId).toBeDefined();
    expect(cols.args).toBeDefined();
    expect(cols.status).toBeDefined();
    expect(cols.resolvedAt).toBeDefined();
  });
});

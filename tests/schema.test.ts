import { describe, expect, it } from "vitest";
import { users, accounts, sessions, verificationTokens } from "@/lib/db/schema";
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

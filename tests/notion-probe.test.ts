import { describe, expect, it, vi } from "vitest";
import { databaseStillExists, pageStillExists } from "@/lib/integrations/notion/probe";

function clientWith(handler: () => Promise<unknown>) {
  return {
    databases: { retrieve: handler },
    pages: { retrieve: handler },
  } as never;
}

class NotionLikeError extends Error {
  status?: number;
  code?: string;
  constructor(msg: string, status?: number, code?: string) {
    super(msg);
    this.status = status;
    this.code = code;
  }
}

describe("databaseStillExists", () => {
  it("returns true when Notion resolves the retrieve call", async () => {
    const client = clientWith(async () => ({ id: "db-1" }));
    expect(await databaseStillExists(client, "db-1")).toBe(true);
  });

  it("returns false on status 404", async () => {
    const client = clientWith(async () => {
      throw new NotionLikeError("Could not find database", 404);
    });
    expect(await databaseStillExists(client, "db-1")).toBe(false);
  });

  it("returns false on object_not_found code", async () => {
    const client = clientWith(async () => {
      throw new NotionLikeError("anything", undefined, "object_not_found");
    });
    expect(await databaseStillExists(client, "db-1")).toBe(false);
  });

  it("returns false when error message matches Notion's phrasing", async () => {
    const client = clientWith(async () => {
      throw new Error("Could not find database with ID: abc");
    });
    expect(await databaseStillExists(client, "db-1")).toBe(false);
  });

  it("throws on transient errors (non-404)", async () => {
    const client = clientWith(async () => {
      throw new NotionLikeError("Internal Server Error", 500);
    });
    await expect(databaseStillExists(client, "db-1")).rejects.toThrow();
  });
});

describe("pageStillExists", () => {
  it("treats archived pages as missing", async () => {
    const client = {
      pages: { retrieve: vi.fn(async () => ({ id: "p", archived: true })) },
    } as never;
    expect(await pageStillExists(client, "p")).toBe(false);
  });

  it("returns true for a live page", async () => {
    const client = {
      pages: { retrieve: vi.fn(async () => ({ id: "p", archived: false })) },
    } as never;
    expect(await pageStillExists(client, "p")).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { parseEnv } from "@/lib/env";

const baseEnv = {
  DATABASE_URL: "postgres://user:pass@host/db",
  AUTH_SECRET: "secret",
  AUTH_GOOGLE_ID: "gid",
  AUTH_GOOGLE_SECRET: "gsec",
  NOTION_CLIENT_ID: "nid",
  NOTION_CLIENT_SECRET: "nsec",
  OPENAI_API_KEY: "oai",
  STRIPE_SECRET_KEY: "sk",
  STRIPE_PRICE_ID_PRO: "price_123",
  ENCRYPTION_KEY: "key",
  APP_URL: "http://localhost:3000",
  NODE_ENV: "test" as const,
} satisfies NodeJS.ProcessEnv;

describe("env validation", () => {
  it("accepts a complete env", () => {
    const parsed = parseEnv(baseEnv);
    expect(parsed.DATABASE_URL).toBe(baseEnv.DATABASE_URL);
    expect(parsed.APP_URL).toBe("http://localhost:3000");
  });

  it("throws on missing required var", () => {
    const bad = { ...baseEnv } as NodeJS.ProcessEnv;
    delete bad.DATABASE_URL;
    expect(() => parseEnv(bad)).toThrow(/DATABASE_URL/);
  });

  it("throws on invalid URL", () => {
    const bad = { ...baseEnv, DATABASE_URL: "not-a-url" } as NodeJS.ProcessEnv;
    expect(() => parseEnv(bad)).toThrow(/Invalid environment/);
  });

  it("throws on empty secret", () => {
    const bad = { ...baseEnv, AUTH_SECRET: "" } as NodeJS.ProcessEnv;
    expect(() => parseEnv(bad)).toThrow(/AUTH_SECRET/);
  });
});

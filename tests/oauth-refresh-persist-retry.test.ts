import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  env: () => ({
    DATABASE_URL: "postgres://test",
    ENCRYPTION_KEY: "k".repeat(64),
  }),
}));

// In-memory ledger of UPDATE invocations + a queue of errors to throw on
// successive calls. Each call shifts one entry off the queue; an
// undefined entry means "succeed".
const updateCalls: Array<Record<string, unknown>> = [];
let throwQueue: Array<unknown> = [];

vi.mock("@/lib/db/client", () => ({
  db: {
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          updateCalls.push({ values });
          const next = throwQueue.shift();
          if (next !== undefined) throw next;
        },
      }),
    }),
  },
}));

vi.mock("@/lib/auth/oauth-tokens", () => ({
  encryptOAuthToken: (v: string | null | undefined) =>
    v == null ? null : `enc:v1:${v}`,
}));

const sentryCaptures: Array<{
  err: unknown;
  options: Record<string, unknown> | undefined;
}> = [];

vi.mock("@sentry/nextjs", () => ({
  captureException: (err: unknown, options?: Record<string, unknown>) => {
    sentryCaptures.push({ err, options });
  },
}));

import { persistRefreshedOAuthToken } from "@/lib/auth/oauth-refresh-persist";

describe("persistRefreshedOAuthToken", () => {
  beforeEach(() => {
    updateCalls.length = 0;
    throwQueue = [];
    sentryCaptures.length = 0;
  });

  it("succeeds on first attempt without retry", async () => {
    await persistRefreshedOAuthToken({
      provider: "google",
      providerAccountId: "1234567890",
      accessTokenPlain: "ya29.access-new",
      expiresAtSeconds: 1_800_000_000,
    });

    expect(updateCalls).toHaveLength(1);
    expect(sentryCaptures).toHaveLength(0);
    expect(updateCalls[0].values).toMatchObject({
      access_token: "enc:v1:ya29.access-new",
      expires_at: 1_800_000_000,
    });
  });

  it("retries once on transient failure and succeeds on second attempt", async () => {
    throwQueue = [new Error("fetch failed")];

    await persistRefreshedOAuthToken({
      provider: "google",
      providerAccountId: "1234567890",
      accessTokenPlain: "ya29.access-new",
      expiresAtSeconds: 1_800_000_000,
    });

    expect(updateCalls).toHaveLength(2);
    expect(sentryCaptures).toHaveLength(0);
  });

  it("captures Sentry warning when both attempts fail", async () => {
    const firstErr = new Error("fetch failed (1)");
    const secondErr = new Error("fetch failed (2)");
    throwQueue = [firstErr, secondErr];

    await persistRefreshedOAuthToken({
      provider: "google",
      providerAccountId: "1234567890",
      accessTokenPlain: "ya29.access-new",
      expiresAtSeconds: 1_800_000_000,
    });

    expect(updateCalls).toHaveLength(2);
    expect(sentryCaptures).toHaveLength(1);
    expect(sentryCaptures[0].err).toBe(secondErr);
    const opts = sentryCaptures[0].options as {
      level: string;
      tags: { context: string; provider: string };
      extra: { firstError: unknown; providerAccountId: string };
    };
    expect(opts.level).toBe("warning");
    expect(opts.tags.context).toBe("oauth_refresh_persist_failed");
    expect(opts.tags.provider).toBe("google");
    expect(opts.extra.firstError).toBe(firstErr);
    expect(opts.extra.providerAccountId).toBe("1234567890");
  });

  it("preserves existing expires_at when expiresAtSeconds is null", async () => {
    await persistRefreshedOAuthToken({
      provider: "google",
      providerAccountId: "1234567890",
      accessTokenPlain: "ya29.access-new",
      expiresAtSeconds: null,
    });

    expect(updateCalls).toHaveLength(1);
    const values = updateCalls[0].values as Record<string, unknown>;
    expect(values).toHaveProperty("access_token");
    expect(values).not.toHaveProperty("expires_at");
  });

  it("includes refresh_token, scope, and token_type when provided (Microsoft rotation)", async () => {
    await persistRefreshedOAuthToken({
      provider: "microsoft-entra-id",
      providerAccountId: "ms-acct-1",
      accessTokenPlain: "ms.access-new",
      expiresAtSeconds: 1_800_000_000,
      refreshTokenPlain: "ms.refresh-rotated",
      scope: "openid email User.Read",
      tokenType: "Bearer",
    });

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].values).toMatchObject({
      access_token: "enc:v1:ms.access-new",
      refresh_token: "enc:v1:ms.refresh-rotated",
      expires_at: 1_800_000_000,
      scope: "openid email User.Read",
      token_type: "Bearer",
    });
  });
});

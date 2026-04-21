import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  env: () => ({
    ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
  }),
}));

import {
  OAUTH_CIPHERTEXT_PREFIX,
  decryptAccountTokens,
  decryptOAuthToken,
  encryptAccountTokens,
  encryptOAuthToken,
  isEncryptedOAuthToken,
} from "@/lib/auth/oauth-tokens";

describe("oauth-tokens helpers", () => {
  it("round-trips a single token", () => {
    const plain = "ya29.a0AbCdE-FgHiJkLmN-secretvalue";
    const encrypted = encryptOAuthToken(plain);
    expect(encrypted).toBeTruthy();
    expect(encrypted).not.toBe(plain);
    expect(encrypted!.startsWith(OAUTH_CIPHERTEXT_PREFIX)).toBe(true);
    expect(decryptOAuthToken(encrypted)).toBe(plain);
  });

  it("encryptOAuthToken is idempotent on already-encrypted values", () => {
    const plain = "secret-abc";
    const once = encryptOAuthToken(plain)!;
    const twice = encryptOAuthToken(once);
    expect(twice).toBe(once);
    expect(decryptOAuthToken(twice)).toBe(plain);
  });

  it("decryptOAuthToken is a passthrough for plaintext (legacy rows)", () => {
    expect(decryptOAuthToken("legacy-plain-token")).toBe("legacy-plain-token");
  });

  it("null/empty are preserved", () => {
    expect(encryptOAuthToken(null)).toBe(null);
    expect(encryptOAuthToken(undefined)).toBe(null);
    expect(encryptOAuthToken("")).toBe("");
    expect(decryptOAuthToken(null)).toBe(null);
    expect(decryptOAuthToken("")).toBe("");
  });

  it("isEncryptedOAuthToken detects the prefix", () => {
    expect(isEncryptedOAuthToken(encryptOAuthToken("x"))).toBe(true);
    expect(isEncryptedOAuthToken("plain")).toBe(false);
    expect(isEncryptedOAuthToken(null)).toBe(false);
    expect(isEncryptedOAuthToken("")).toBe(false);
  });
});

describe("encryptAccountTokens / decryptAccountTokens", () => {
  it("round-trips the token fields and leaves other fields alone", () => {
    const input = {
      userId: "u-1",
      provider: "google",
      providerAccountId: "123",
      refresh_token: "refresh-abc",
      access_token: "access-xyz",
      id_token: "id-jwt",
      expires_at: 1234567,
      token_type: "Bearer",
      scope: "openid email profile",
      session_state: null,
    };
    const encrypted = encryptAccountTokens(input);
    expect(encrypted.userId).toBe("u-1");
    expect(encrypted.provider).toBe("google");
    expect(encrypted.providerAccountId).toBe("123");
    expect(encrypted.expires_at).toBe(1234567);
    expect(encrypted.token_type).toBe("Bearer");
    expect(encrypted.scope).toBe("openid email profile");

    expect(encrypted.refresh_token).not.toBe(input.refresh_token);
    expect(encrypted.access_token).not.toBe(input.access_token);
    expect(encrypted.id_token).not.toBe(input.id_token);
    expect(isEncryptedOAuthToken(encrypted.refresh_token as string)).toBe(true);
    expect(isEncryptedOAuthToken(encrypted.access_token as string)).toBe(true);
    expect(isEncryptedOAuthToken(encrypted.id_token as string)).toBe(true);

    const decrypted = decryptAccountTokens(encrypted);
    expect(decrypted.refresh_token).toBe(input.refresh_token);
    expect(decrypted.access_token).toBe(input.access_token);
    expect(decrypted.id_token).toBe(input.id_token);
  });

  it("handles partial rows (only some token fields present)", () => {
    const input = { access_token: "a-1" };
    const encrypted = encryptAccountTokens(input);
    expect(isEncryptedOAuthToken(encrypted.access_token as string)).toBe(true);
    expect(decryptAccountTokens(encrypted).access_token).toBe("a-1");
  });
});

describe("EncryptedDrizzleAdapter", () => {
  it("encrypts tokens before handing them to linkAccount", async () => {
    const calls: unknown[] = [];
    const fakeBaseAdapter = {
      async linkAccount(account: Record<string, unknown>) {
        calls.push(account);
      },
    };
    vi.doMock("@auth/drizzle-adapter", () => ({
      DrizzleAdapter: () => fakeBaseAdapter,
    }));

    const { EncryptedDrizzleAdapter } = await import(
      "@/lib/auth/encrypted-adapter"
    );
    const adapter = EncryptedDrizzleAdapter(
      {} as never,
      {} as never
    );
    await adapter.linkAccount!({
      userId: "u-1",
      provider: "google",
      providerAccountId: "123",
      type: "oidc",
      refresh_token: "rrr",
      access_token: "aaa",
      id_token: "iii",
      expires_at: 1,
      scope: "openid",
    } as never);

    const received = calls[0] as Record<string, unknown>;
    expect(isEncryptedOAuthToken(received.refresh_token as string)).toBe(true);
    expect(isEncryptedOAuthToken(received.access_token as string)).toBe(true);
    expect(isEncryptedOAuthToken(received.id_token as string)).toBe(true);
    expect(received.providerAccountId).toBe("123");
    expect(received.scope).toBe("openid");

    vi.doUnmock("@auth/drizzle-adapter");
  });
});

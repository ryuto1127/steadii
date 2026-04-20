import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { encryptWith, decryptWith } from "@/lib/utils/crypto";

describe("AES-256-GCM encryption", () => {
  const key = randomBytes(32);

  it("round-trips a secret", () => {
    const plaintext = "secret_xOjjhbrJg8XYumd3ATGWxt";
    const encrypted = encryptWith(plaintext, key);
    expect(encrypted).not.toContain(plaintext);
    expect(decryptWith(encrypted, key)).toBe(plaintext);
  });

  it("produces different ciphertexts for same plaintext (IV randomness)", () => {
    const p = "abc";
    expect(encryptWith(p, key)).not.toBe(encryptWith(p, key));
  });

  it("fails to decrypt with wrong key", () => {
    const p = "abc";
    const c = encryptWith(p, key);
    const other = randomBytes(32);
    expect(() => decryptWith(c, other)).toThrow();
  });

  it("fails to decrypt tampered ciphertext", () => {
    const c = encryptWith("hello", key);
    const buf = Buffer.from(c, "base64");
    buf[buf.length - 1] ^= 0xff;
    const tampered = buf.toString("base64");
    expect(() => decryptWith(tampered, key)).toThrow();
  });
});

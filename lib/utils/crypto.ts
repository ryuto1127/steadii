import "server-only";
import { env } from "@/lib/env";
import { encryptWith, decryptWith } from "./crypto-primitives";

function getKey(): Buffer {
  const raw = env().ENCRYPTION_KEY;
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY must be a base64-encoded 32-byte key (got ${key.length} bytes)`
    );
  }
  return key;
}

export function encrypt(plaintext: string): string {
  return encryptWith(plaintext, getKey());
}

export function decrypt(ciphertext: string): string {
  return decryptWith(ciphertext, getKey());
}

export { encryptWith, decryptWith };

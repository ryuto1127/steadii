import "server-only";
import { encrypt, decrypt } from "@/lib/utils/crypto";

// Prefix marker so we can detect already-encrypted values and tolerate a
// mixed-state window during the one-shot backfill migration. The format
// is simple on purpose — just `enc:v1:<base64-aes256gcm>`. Bumping to
// v2 later (e.g. key rotation) means teaching decryptOAuthToken a second
// prefix and having the migration script re-wrap v1 rows.
export const OAUTH_CIPHERTEXT_PREFIX = "enc:v1:";

export function isEncryptedOAuthToken(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(OAUTH_CIPHERTEXT_PREFIX);
}

export function encryptOAuthToken(plain: string | null | undefined): string | null {
  if (plain == null || plain === "") return plain ?? null;
  if (isEncryptedOAuthToken(plain)) return plain;
  return OAUTH_CIPHERTEXT_PREFIX + encrypt(plain);
}

export function decryptOAuthToken(value: string | null | undefined): string | null {
  if (value == null || value === "") return value ?? null;
  if (!isEncryptedOAuthToken(value)) return value;
  return decrypt(value.slice(OAUTH_CIPHERTEXT_PREFIX.length));
}

// The subset of account fields we transparently encrypt/decrypt. NextAuth
// treats these as opaque strings; Google only uses refresh_token +
// access_token; id_token is included defensively.
const ENCRYPTED_FIELDS = ["refresh_token", "access_token", "id_token"] as const;
type EncryptedField = (typeof ENCRYPTED_FIELDS)[number];

export function encryptAccountTokens<T extends Partial<Record<EncryptedField, unknown>>>(
  data: T
): T {
  const out: T = { ...data };
  for (const field of ENCRYPTED_FIELDS) {
    if (field in out) {
      const v = out[field];
      if (typeof v === "string") {
        (out as Record<string, unknown>)[field] = encryptOAuthToken(v);
      }
    }
  }
  return out;
}

export function decryptAccountTokens<T extends Partial<Record<EncryptedField, unknown>>>(
  row: T
): T {
  const out: T = { ...row };
  for (const field of ENCRYPTED_FIELDS) {
    if (field in out) {
      const v = out[field];
      if (typeof v === "string") {
        (out as Record<string, unknown>)[field] = decryptOAuthToken(v);
      }
    }
  }
  return out;
}

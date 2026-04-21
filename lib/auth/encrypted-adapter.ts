import "server-only";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import type { Adapter, AdapterAccount } from "next-auth/adapters";
import { encryptAccountTokens } from "./oauth-tokens";

type DrizzleAdapterArgs = Parameters<typeof DrizzleAdapter>;

// Wraps the stock Drizzle adapter so that initial OAuth account rows are
// written with encrypted refresh_token / access_token / id_token. Reads
// that flow through the adapter (getUserByAccount, getAccount) are passed
// through untouched — our own Google clients decrypt at their read site.
// Keeping the read-path cipher-aware means the stored value stays opaque
// to anything that doesn't explicitly ask for it.
export function EncryptedDrizzleAdapter(...args: DrizzleAdapterArgs): Adapter {
  const inner = DrizzleAdapter(...args);
  const originalLink = inner.linkAccount;
  if (!originalLink) return inner;

  const wrapped: Adapter["linkAccount"] = async (account: AdapterAccount) => {
    const encrypted = encryptAccountTokens(
      account as unknown as Record<string, unknown>
    );
    await originalLink(encrypted as unknown as AdapterAccount);
  };

  return { ...inner, linkAccount: wrapped };
}

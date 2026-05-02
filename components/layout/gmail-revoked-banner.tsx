import Link from "next/link";
import { getTranslations } from "next-intl/server";

// Wave 5 — Gmail token revocation banner. Server component because
// the gating happens upstream (layout reads users.gmail_token_revoked_at);
// this just renders the message + the re-connect link. The user goes
// through the standard Google OAuth flow which writes a fresh
// access_token + refresh_token into accounts; the auth callback
// clears gmail_token_revoked_at.
export async function GmailRevokedBanner() {
  const t = await getTranslations("gmail_revoked_banner");
  return (
    <div className="mx-auto mb-5 max-w-4xl rounded-lg border border-[hsl(var(--destructive)/0.3)] bg-[hsl(var(--destructive)/0.06)] px-4 py-2.5 text-small text-[hsl(var(--foreground))]">
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <p className="font-medium text-[hsl(var(--destructive))]">
            {t("heading")}
          </p>
          <p className="mt-0.5 text-[hsl(var(--muted-foreground))]">
            {t("body")}
          </p>
        </div>
        <Link
          href="/api/auth/signout"
          className="shrink-0 rounded-md bg-[hsl(var(--destructive))] px-3 py-1.5 text-small font-medium text-[hsl(var(--destructive-foreground))] transition-hover hover:opacity-90"
        >
          {t("reconnect")}
        </Link>
      </div>
    </div>
  );
}

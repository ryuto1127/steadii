import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ reason?: string }>;

export default async function AccessDeniedPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const t = await getTranslations();
  const { reason } = await searchParams;
  const adminEmail = env().ADMIN_EMAIL;
  const showRequestCta = reason !== "denied";

  return (
    <div className="min-h-screen bg-[hsl(var(--background))] text-[hsl(var(--foreground))]">
      <nav className="mx-auto flex max-w-5xl items-center px-6 py-5">
        <Link href="/" className="text-[15px] font-semibold tracking-tight">
          Steadii
        </Link>
      </nav>

      <main className="mx-auto max-w-lg px-6 pt-12 pb-16">
        <p className="font-mono text-[11px] uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
          {t("landing.alpha")}
        </p>

        <h1 className="mt-4 font-display text-[32px] leading-tight tracking-tight">
          {t("access_denied.title_ja")}
        </h1>
        <p className="mt-3 text-body text-[hsl(var(--muted-foreground))]">
          {t("access_denied.body_ja")}
        </p>
        <p className="mt-2 text-small text-[hsl(var(--muted-foreground))]">
          {t("access_denied.contact_label_ja")}{" "}
          <a
            href={`mailto:${adminEmail}`}
            className="text-[hsl(var(--foreground))] underline transition-hover hover:opacity-80"
          >
            {adminEmail}
          </a>
        </p>

        <hr className="my-8 border-[hsl(var(--border))]" />

        <h2 className="font-display text-[22px] leading-tight tracking-tight">
          {t("access_denied.title_en")}
        </h2>
        <p className="mt-2 text-body text-[hsl(var(--muted-foreground))]">
          {t("access_denied.body_en")}
        </p>
        <p className="mt-2 text-small text-[hsl(var(--muted-foreground))]">
          {t("access_denied.contact_label_en")}{" "}
          <a
            href={`mailto:${adminEmail}`}
            className="text-[hsl(var(--foreground))] underline transition-hover hover:opacity-80"
          >
            {adminEmail}
          </a>
        </p>

        {showRequestCta ? (
          <p className="mt-10">
            <Link
              href="/request-access"
              className="inline-flex items-center text-small text-[hsl(var(--primary))] transition-hover hover:opacity-80"
            >
              {t("access_denied.request_access_cta")}
            </Link>
          </p>
        ) : null}
      </main>
    </div>
  );
}

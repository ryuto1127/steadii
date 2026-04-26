import Link from "next/link";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-static";

type SearchParams = Promise<{ "already-submitted"?: string }>;

export default async function AccessPendingPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const t = await getTranslations();
  const sp = await searchParams;
  const showAlreadySubmittedHint = "already-submitted" in sp;

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
          {t("access_pending.title_ja")}
        </h1>
        <p className="mt-3 text-body text-[hsl(var(--muted-foreground))]">
          {t("access_pending.body_ja")}
        </p>

        {showAlreadySubmittedHint ? (
          <p className="mt-6 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-2 text-small text-[hsl(var(--foreground))]">
            {t("access_pending.already_submitted_hint")}
          </p>
        ) : null}

        <hr className="my-8 border-[hsl(var(--border))]" />

        <h2 className="font-display text-[22px] leading-tight tracking-tight">
          {t("access_pending.title_en")}
        </h2>
        <p className="mt-2 text-body text-[hsl(var(--muted-foreground))]">
          {t("access_pending.body_en")}
        </p>

        <p className="mt-10 text-small">
          <Link
            href="/"
            className="text-[hsl(var(--muted-foreground))] transition-hover hover:text-[hsl(var(--foreground))]"
          >
            {t("access_pending.back_to_landing")}
          </Link>
        </p>
      </main>
    </div>
  );
}

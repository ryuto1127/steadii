import Link from "next/link";
import { getTranslations } from "next-intl/server";

export default async function LandingPage() {
  const t = await getTranslations();

  return (
    <main className="mx-auto max-w-3xl px-6 py-20">
      <p className="font-mono text-xs uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
        {t("landing.alpha")}
      </p>
      <h1 className="mt-6 font-serif text-5xl leading-[1.15] tracking-tight text-[hsl(var(--foreground))]">
        {t("landing.headline")}
      </h1>
      <p className="mt-6 text-lg leading-relaxed text-[hsl(var(--muted-foreground))]">
        {t("landing.subhead")}
      </p>
      <div className="mt-10">
        <Link
          href="/login"
          className="inline-flex items-center rounded-lg bg-[hsl(var(--primary))] px-5 py-3 font-medium text-[hsl(var(--primary-foreground))] shadow-sm transition hover:opacity-90"
        >
          {t("landing.cta")}
        </Link>
      </div>
      <nav className="mt-16 flex gap-6 text-sm text-[hsl(var(--muted-foreground))]">
        <Link href="/privacy" className="hover:text-[hsl(var(--foreground))]">
          Privacy
        </Link>
        <Link href="/terms" className="hover:text-[hsl(var(--foreground))]">
          Terms
        </Link>
      </nav>
    </main>
  );
}

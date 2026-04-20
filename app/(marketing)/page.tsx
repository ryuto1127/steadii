import Link from "next/link";
import { getTranslations } from "next-intl/server";

export default async function LandingPage() {
  const t = await getTranslations();

  return (
    <main className="mx-auto max-w-5xl px-6 py-20">
      <header>
        <p className="font-mono text-xs uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
          {t("landing.alpha")}
        </p>
        <h1 className="mt-6 font-serif text-5xl leading-[1.15] tracking-tight text-[hsl(var(--foreground))] md:text-6xl">
          {t("landing.headline")}
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-[hsl(var(--muted-foreground))]">
          {t("landing.subhead")}
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-4">
          <Link
            href="/login"
            className="inline-flex items-center rounded-lg bg-[hsl(var(--primary))] px-5 py-3 font-medium text-[hsl(var(--primary-foreground))] shadow-sm transition hover:opacity-90"
          >
            {t("landing.cta")}
          </Link>
          <span className="text-xs text-[hsl(var(--muted-foreground))]">
            α is invite-only. If you weren&apos;t invited, sign-in will
            fail gracefully.
          </span>
        </div>
      </header>

      <section className="mt-24 grid gap-10 md:grid-cols-3">
        <Feature
          title="Chat-first"
          body="Ask Steadii anything about your classes. It reads your Notion and calendar, then answers. No dashboards to navigate."
        />
        <Feature
          title="Notion-native"
          body="Your mistake notes, syllabi, and assignments live in your own Notion. Steadii organizes, doesn&rsquo;t lock in."
        />
        <Feature
          title="Verbatim by default"
          body="Original PDFs and full-text source are preserved on every syllabus save — not summarized, not lossy."
        />
      </section>

      <section className="mt-24 rounded-2xl bg-[hsl(var(--surface))] p-10 shadow-sm">
        <h2 className="font-serif text-3xl">What&apos;s in α</h2>
        <ul className="mt-6 grid gap-3 text-sm text-[hsl(var(--foreground))] md:grid-cols-2">
          <li>📚 Class-centric workspace auto-created in your Notion</li>
          <li>🗓 Week-ahead calendar in the agent&apos;s context</li>
          <li>📝 Mistake notebook with step-by-step solutions</li>
          <li>📄 Syllabus extraction from PDF, image, or URL</li>
          <li>🔍 Registered-resource discovery</li>
          <li>💳 250 credits/month free · 1,000 for Pro</li>
        </ul>
      </section>

      <footer className="mt-24 flex gap-6 text-sm text-[hsl(var(--muted-foreground))]">
        <Link href="/privacy" className="hover:text-[hsl(var(--foreground))]">
          Privacy
        </Link>
        <Link href="/terms" className="hover:text-[hsl(var(--foreground))]">
          Terms
        </Link>
        <span className="ml-auto font-mono text-xs">
          α · subject to change
        </span>
      </footer>
    </main>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h3 className="font-serif text-xl">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">
        {body}
      </p>
    </div>
  );
}

import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Plug, Eye, Sparkles } from "lucide-react";
import { ChatActionCards } from "./_components/chat-action-cards";
import { ProactiveMock } from "./_components/proactive-mock";
import { LocaleToggle } from "./_components/locale-toggle";

export default async function LandingPage() {
  const t = await getTranslations();
  const locale = (await getLocale()) as "en" | "ja";

  const cards = [
    {
      input: t("landing.what_you_do.cards.calendar.input"),
      action: t("landing.what_you_do.cards.calendar.action"),
    },
    {
      input: t("landing.what_you_do.cards.syllabus.input"),
      action: t("landing.what_you_do.cards.syllabus.action"),
    },
    {
      input: t("landing.what_you_do.cards.absence.input"),
      action: t("landing.what_you_do.cards.absence.action"),
    },
  ];

  const proactiveCopy = {
    step_calendar: t("landing.steadii_in_motion.step_calendar"),
    step_calendar_meta: t("landing.steadii_in_motion.step_calendar_meta"),
    step_notification: t("landing.steadii_in_motion.step_notification"),
    step_notification_meta: t(
      "landing.steadii_in_motion.step_notification_meta",
    ),
    step_proposal: t("landing.steadii_in_motion.step_proposal"),
    step_proposal_meta: t("landing.steadii_in_motion.step_proposal_meta"),
    action_email: t("landing.steadii_in_motion.action_email"),
    action_reschedule: t("landing.steadii_in_motion.action_reschedule"),
    action_dismiss: t("landing.steadii_in_motion.action_dismiss"),
  };

  const steps = [
    {
      icon: Plug,
      title: t("landing.how_it_works.steps.connect.title"),
      body: t("landing.how_it_works.steps.connect.body"),
    },
    {
      icon: Eye,
      title: t("landing.how_it_works.steps.watch.title"),
      body: t("landing.how_it_works.steps.watch.body"),
    },
    {
      icon: Sparkles,
      title: t("landing.how_it_works.steps.trust.title"),
      body: t("landing.how_it_works.steps.trust.body"),
    },
  ];

  return (
    <div className="dark min-h-screen bg-[hsl(var(--background))] text-[hsl(var(--foreground))]">
      {/* Force the landing canvas (html + body) to dark, regardless of the
          user's app-level theme preference. The Cluely-style aesthetic only
          works dark; user theme still wins inside /app/*. */}
      <style>{`
        html { background-color: hsl(0 5% 10%); color-scheme: dark; }
        body { background-color: hsl(0 5% 10%); }
      `}</style>
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <span className="text-[15px] font-semibold tracking-tight">
          Steadii
        </span>
        <Link
          href="/login"
          className="text-small text-[hsl(var(--muted-foreground))] transition-hover hover:text-[hsl(var(--foreground))]"
        >
          {t("landing.sign_in")}
        </Link>
      </nav>

      <main className="mx-auto max-w-6xl px-6">
        {/* Section 1 — Hero */}
        <section className="grid items-center gap-10 pt-10 pb-24 md:grid-cols-[3fr_2fr] md:gap-12 md:pt-16 md:pb-32">
          <div className="order-2 flex flex-col items-start gap-6 md:order-1">
            <p className="font-mono text-[11px] uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
              {t("landing.alpha")}
            </p>
            <h1 className="font-display text-[40px] leading-[1.05] tracking-tight text-[hsl(var(--foreground))] md:text-[56px]">
              {t("landing.headline")}
            </h1>
            <p className="max-w-xl text-body text-[hsl(var(--muted-foreground))]">
              {t("landing.subhead")}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-4">
              <Link
                href="/request-access"
                className="landing-cta inline-flex items-center rounded-md bg-[hsl(var(--primary))] px-4 py-2 text-body font-medium text-[hsl(var(--primary-foreground))] transition-hover hover:opacity-90"
              >
                {t("landing.cta_request_access")}
              </Link>
              <Link
                href="/login"
                className="text-small text-[hsl(var(--muted-foreground))] transition-hover hover:text-[hsl(var(--foreground))]"
              >
                {t("landing.cta_already_approved")}
              </Link>
            </div>
          </div>
          <div className="relative order-1 md:order-2">
            <div className="relative overflow-hidden rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] shadow-lg">
              <video
                autoPlay
                muted
                loop
                playsInline
                preload="auto"
                poster="/demo/hero-poster.png"
                aria-label="Steadii product demo"
                className="block aspect-[4/3] w-full object-cover"
              >
                <source src="/demo/hero.webm" type="video/webm" />
                <source src="/demo/hero.mp4" type="video/mp4" />
              </video>
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-black/15 via-transparent to-transparent"
              />
            </div>
          </div>
        </section>

        {/* Section 2 — What you do */}
        <section className="border-t border-[hsl(var(--border))] py-20">
          <div className="mb-10 max-w-2xl">
            <h2 className="text-h1 text-[hsl(var(--foreground))] md:text-[32px] md:leading-[1.15]">
              {t("landing.what_you_do.title")}
            </h2>
            <p className="mt-3 text-body text-[hsl(var(--muted-foreground))]">
              {t("landing.what_you_do.subhead")}
            </p>
          </div>
          <ChatActionCards cards={cards} />
        </section>

        {/* Section 3 — Steadii in motion */}
        <section className="border-t border-[hsl(var(--border))] py-20">
          <div className="mb-10 max-w-2xl">
            <h2 className="text-h1 text-[hsl(var(--foreground))] md:text-[32px] md:leading-[1.15]">
              {t("landing.steadii_in_motion.title")}
            </h2>
            <p className="mt-3 text-body text-[hsl(var(--muted-foreground))]">
              {t("landing.steadii_in_motion.body")}
            </p>
          </div>
          <ProactiveMock copy={proactiveCopy} />
          <p className="mt-3 font-mono text-[11px] uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
            {t("landing.steadii_in_motion.real_screen")}
          </p>
        </section>

        {/* Section 4 — How it works */}
        <section className="border-t border-[hsl(var(--border))] py-20">
          <h2 className="mb-10 text-h1 text-[hsl(var(--foreground))] md:text-[32px] md:leading-[1.15]">
            {t("landing.how_it_works.title")}
          </h2>
          <ol className="grid gap-6 md:grid-cols-3">
            {steps.map((step, i) => {
              const Icon = step.icon;
              return (
                <li
                  key={step.title}
                  className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-5"
                >
                  <div className="flex items-center gap-2">
                    <Icon
                      size={16}
                      strokeWidth={1.5}
                      className="text-[hsl(var(--primary))]"
                    />
                    <span className="font-mono text-[11px] uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
                      0{i + 1}
                    </span>
                  </div>
                  <h3 className="mt-3 text-h2 text-[hsl(var(--foreground))]">
                    {step.title}
                  </h3>
                  <p className="mt-1.5 text-small text-[hsl(var(--muted-foreground))]">
                    {step.body}
                  </p>
                </li>
              );
            })}
          </ol>
        </section>

        {/* Section 5 — Glass box */}
        <section className="border-t border-[hsl(var(--border))] py-20">
          <h2 className="text-h1 text-[hsl(var(--foreground))] md:text-[32px] md:leading-[1.15]">
            {t("landing.glass_box.title")}
          </h2>
          <div className="mt-8 grid max-w-3xl gap-6 text-body text-[hsl(var(--muted-foreground))]">
            <p>{t("landing.glass_box.paragraph_reasoning")}</p>
            <p>{t("landing.glass_box.paragraph_yours")}</p>
            <p>{t("landing.glass_box.paragraph_confirm")}</p>
          </div>
        </section>

        {/* Section 6 — Founding member CTA */}
        <section className="border-t border-[hsl(var(--border))] py-20">
          <div className="rounded-lg border border-[hsl(var(--primary))]/40 bg-[hsl(var(--primary))]/[0.06] p-6 md:p-8">
            <p className="font-mono text-[11px] uppercase tracking-widest text-[hsl(var(--primary))]">
              {t("landing.founding.headline")}
            </p>
            <p className="mt-3 max-w-2xl text-body text-[hsl(var(--foreground))]">
              {t("landing.founding.body")}
            </p>
            <div className="mt-6">
              <Link
                href="/request-access"
                className="inline-flex items-center rounded-md bg-[hsl(var(--primary))] px-4 py-2 text-body font-medium text-[hsl(var(--primary-foreground))] transition-hover hover:opacity-90"
              >
                {t("landing.founding.cta")}
              </Link>
            </div>
          </div>
        </section>

        {/* Section 7 — Footer */}
        <footer className="flex flex-wrap items-center gap-6 border-t border-[hsl(var(--border))] py-12 text-small text-[hsl(var(--muted-foreground))]">
          <Link
            href="/privacy"
            className="transition-hover hover:text-[hsl(var(--foreground))]"
          >
            {t("landing.footer.privacy")}
          </Link>
          <Link
            href="/terms"
            className="transition-hover hover:text-[hsl(var(--foreground))]"
          >
            {t("landing.footer.terms")}
          </Link>
          <a
            href="mailto:hello@mysteadii.xyz"
            className="transition-hover hover:text-[hsl(var(--foreground))]"
          >
            {t("landing.footer.contact")}
          </a>
          <div className="ml-auto flex flex-wrap items-center gap-4">
            <LocaleToggle
              current={locale}
              labels={{
                en: t("landing.locale_toggle.en"),
                ja: t("landing.locale_toggle.ja"),
              }}
              ariaLabel={t("landing.locale_toggle.aria_label")}
            />
            <span className="font-mono text-[11px]">
              {t("landing.footer.subject_to_change")}
            </span>
          </div>
        </footer>
      </main>
    </div>
  );
}

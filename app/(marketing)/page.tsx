import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Plug, Eye, Sparkles } from "lucide-react";
import { ChatActionCards } from "./_components/chat-action-cards";
import { ProactiveMock } from "./_components/proactive-mock";
import { LocaleToggle } from "./_components/locale-toggle";
import { HeroMesh } from "./_components/hero-mesh";
import HeroAnimation from "@/components/landing/hero-animation";
import { VoiceDemo } from "@/components/landing/voice-demo";

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
    <>
      {/* Section 1 — Hero (full-bleed mesh + stacked headline → video) */}
      <section className="relative overflow-hidden">
        <HeroMesh />
        <nav className="relative mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <span className="text-[17px] font-semibold tracking-tight text-[#1A1814]">
            Steadii
          </span>
          <Link
            href="/login"
            className="text-small text-[#1A1814]/70 transition-hover hover:text-[#7C3AED]"
          >
            {t("landing.sign_in")}
          </Link>
        </nav>

        <div className="relative mx-auto max-w-5xl px-6 pt-8 pb-10 text-center md:pt-16 md:pb-14 md:text-left">
          <p className="font-mono text-[11px] uppercase tracking-widest text-[#7C3AED]">
            {t("landing.alpha")}
          </p>
          <h1 className="mt-6 whitespace-pre-line text-[48px] font-semibold leading-[1.05] tracking-[-0.02em] text-[#1A1814] [word-break:keep-all] md:text-[72px] lg:text-[80px]">
            {t("landing.headline")}
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-[17px] leading-[1.55] text-[#1A1814]/70 md:mx-0 md:text-[18px]">
            {t("landing.subhead")}
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-4 md:justify-start">
            <Link
              href="/request-access"
              className="landing-cta inline-flex items-center rounded-full bg-[#0A0A0A] px-6 py-3 text-[15px] font-medium text-white shadow-[0_8px_24px_rgba(0,0,0,0.18)] transition-hover hover:scale-[1.02]"
            >
              {t("landing.cta_request_access")}
            </Link>
            <Link
              href="/login"
              className="text-small text-[#1A1814]/60 transition-hover hover:text-[#7C3AED]"
            >
              {t("landing.cta_already_approved")}
            </Link>
          </div>
        </div>

        <div className="relative mx-auto mt-6 max-w-6xl px-4 pb-20 md:px-6 md:pb-28">
          <div className="overflow-hidden rounded-[16px] bg-white/40 shadow-[0_30px_80px_-20px_rgba(20,20,40,0.25)] ring-1 ring-black/5 backdrop-blur-sm">
            <HeroAnimation />
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-6xl px-6">
        {/* Section 2 — What you do */}
        <section className="py-20 md:py-28">
          <div className="landing-strip mb-16 w-full" />
          <div className="mb-12 max-w-2xl">
            <h2 className="whitespace-pre-line text-[32px] font-semibold leading-[1.15] tracking-[-0.02em] text-[#1A1814] [word-break:keep-all] md:text-[44px]">
              {t("landing.what_you_do.title")}
            </h2>
            <p className="mt-3 text-[14px] text-[#1A1814]/55">
              {t("landing.what_you_do.voice_or_type")}
            </p>
            <p className="mt-4 text-[17px] leading-[1.55] text-[#1A1814]/65 md:text-[18px]">
              {t("landing.what_you_do.subhead")}
            </p>
          </div>
          <ChatActionCards cards={cards} />

          {/* Voice as a sub-feature — the typing examples in the cards
              above are the primary "what you do" pitch; this is a
              compact "or just talk" demo of the noisy-voice → cleaned-text
              pipeline. Per Ryuto 2026-04-30: voice is a sub-feature and
              shouldn't lead the page, but it's worth showing the
              cleanup that makes Steadii's voice meaningfully different
              from raw STT. */}
          <div className="mt-16 md:mt-20">
            <VoiceDemo />
          </div>
        </section>

        {/* Section 3 — Steadii in motion */}
        <section className="py-20 md:py-28">
          <div className="landing-strip mb-16 w-full" />
          <div className="mb-12 max-w-2xl">
            <h2 className="whitespace-pre-line text-[32px] font-semibold leading-[1.15] tracking-[-0.02em] text-[#1A1814] [word-break:keep-all] md:text-[44px]">
              {t("landing.steadii_in_motion.title")}
            </h2>
            <p className="mt-4 text-[17px] leading-[1.55] text-[#1A1814]/65 md:text-[18px]">
              {t("landing.steadii_in_motion.body")}
            </p>
          </div>
          <ProactiveMock copy={proactiveCopy} />
          <p className="mt-4 font-mono text-[11px] uppercase tracking-widest text-[#1A1814]/50">
            {t("landing.steadii_in_motion.real_screen")}
          </p>
        </section>

        {/* Section 4 — How it works */}
        <section className="py-20 md:py-28">
          <div className="landing-strip mb-16 w-full" />
          <h2 className="mb-12 whitespace-pre-line text-[32px] font-semibold leading-[1.15] tracking-[-0.02em] text-[#1A1814] [word-break:keep-all] md:text-[44px]">
            {t("landing.how_it_works.title")}
          </h2>
          <ol className="grid gap-5 md:grid-cols-3">
            {steps.map((step, i) => {
              const Icon = step.icon;
              return (
                <li
                  key={step.title}
                  className="rounded-[12px] border border-black/[0.06] bg-white p-6 shadow-[0_4px_20px_-8px_rgba(20,20,40,0.08)]"
                >
                  <div className="flex items-center gap-2">
                    <Icon
                      size={16}
                      strokeWidth={1.6}
                      className="text-[#7C3AED]"
                    />
                    <span className="font-mono text-[11px] uppercase tracking-widest text-[#1A1814]/50">
                      0{i + 1}
                    </span>
                  </div>
                  <h3 className="mt-3 text-[18px] font-semibold tracking-tight text-[#1A1814]">
                    {step.title}
                  </h3>
                  <p className="mt-2 text-[14px] leading-[1.5] text-[#1A1814]/65">
                    {step.body}
                  </p>
                </li>
              );
            })}
          </ol>
        </section>

        {/* Section 5 — Glass box */}
        <section className="py-20 md:py-28">
          <div className="landing-strip mb-16 w-full" />
          <h2 className="whitespace-pre-line text-[32px] font-semibold leading-[1.15] tracking-[-0.02em] text-[#1A1814] [word-break:keep-all] md:text-[44px]">
            {t("landing.glass_box.title")}
          </h2>
          <div className="mt-8 grid max-w-3xl gap-5 text-[17px] leading-[1.6] text-[#1A1814]/75 md:text-[18px]">
            <p>{t("landing.glass_box.paragraph_reasoning")}</p>
            <p>{t("landing.glass_box.paragraph_yours")}</p>
            <p>{t("landing.glass_box.paragraph_confirm")}</p>
          </div>
        </section>

        {/* Section 6 — Founding member CTA */}
        <section className="py-20 md:py-28">
          <div className="landing-strip mb-16 w-full" />
          <div className="relative overflow-hidden rounded-[16px] border border-black/[0.06] bg-white p-8 shadow-[0_8px_30px_-12px_rgba(20,20,40,0.12)] md:p-10">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 opacity-70"
              style={{
                background: `
                  radial-gradient(circle at 0% 0%, rgba(124, 58, 237, 0.08) 0%, transparent 45%),
                  radial-gradient(circle at 100% 100%, rgba(6, 182, 212, 0.08) 0%, transparent 45%)
                `,
              }}
            />
            <div className="relative">
              <p className="font-mono text-[11px] uppercase tracking-widest text-[#7C3AED]">
                {t("landing.founding.headline")}
              </p>
              <p className="mt-4 max-w-2xl text-[17px] leading-[1.55] text-[#1A1814] md:text-[18px]">
                {t("landing.founding.body")}
              </p>
              <div className="mt-7">
                <Link
                  href="/request-access"
                  className="inline-flex items-center rounded-full bg-[#0A0A0A] px-6 py-3 text-[15px] font-medium text-white shadow-[0_8px_24px_rgba(0,0,0,0.18)] transition-hover hover:scale-[1.02]"
                >
                  {t("landing.founding.cta")}
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* Section 7 — Footer */}
        <footer className="flex flex-wrap items-center gap-6 border-t border-black/[0.06] py-12 text-small text-[#1A1814]/60">
          <Link
            href="/privacy"
            className="transition-hover hover:text-[#7C3AED]"
          >
            {t("landing.footer.privacy")}
          </Link>
          <Link
            href="/terms"
            className="transition-hover hover:text-[#7C3AED]"
          >
            {t("landing.footer.terms")}
          </Link>
          <a
            href="mailto:hello@mysteadii.com"
            className="transition-hover hover:text-[#7C3AED]"
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
            <span className="font-mono text-[11px] text-[#7C3AED]">
              {t("landing.footer.subject_to_change")}
            </span>
          </div>
        </footer>
      </main>
    </>
  );
}

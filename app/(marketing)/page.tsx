import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ChatActionCards } from "./_components/chat-action-cards";
import { LocaleToggle } from "./_components/locale-toggle";
import { NavLocaleToggle } from "./_components/nav-locale-toggle";
import { BoundariesSection } from "./_components/boundaries-section";
import { MorningBriefing } from "./_components/morning-briefing";
import { WeekWithSteadii } from "./_components/week-with-steadii";
import { FoundingCta } from "./_components/founding-cta";
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

  const weekCopy = {
    context_label: t("landing.week.context_label"),
    locale,
    moments: [
      {
        time: t("landing.week.moment1_time"),
        event: t("landing.week.moment1_event"),
        action: t("landing.week.moment1_action"),
        context: t("landing.week.moment1_context"),
      },
      {
        time: t("landing.week.moment2_time"),
        event: t("landing.week.moment2_event"),
        action: t("landing.week.moment2_action"),
        context: t("landing.week.moment2_context"),
      },
      {
        time: t("landing.week.moment3_time"),
        event: t("landing.week.moment3_event"),
        action: t("landing.week.moment3_action"),
        context: t("landing.week.moment3_context"),
      },
      {
        time: t("landing.week.moment4_time"),
        event: t("landing.week.moment4_event"),
        action: t("landing.week.moment4_action"),
        context: t("landing.week.moment4_context"),
      },
      {
        time: t("landing.week.moment5_time"),
        event: t("landing.week.moment5_event"),
        action: t("landing.week.moment5_action"),
        context: t("landing.week.moment5_context"),
      },
    ],
  };

  return (
    <>
      {/* Section 1 — Hero (full-bleed mesh + stacked headline → video) */}
      <section className="relative overflow-hidden">
        <HeroMesh />
        <nav className="relative mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <span className="text-[17px] font-semibold tracking-tight text-[#1A1814]">
            Steadii
          </span>
          <div className="flex items-center gap-4">
            <NavLocaleToggle
              current={locale}
              labels={{
                en: t("landing.locale_toggle.en"),
                ja: t("landing.locale_toggle.ja"),
              }}
              ariaLabel={t("landing.locale_toggle.aria_label")}
            />
            <Link
              href="/login"
              className="inline-flex items-center rounded-full border border-black/[0.10] bg-white/60 px-4 py-1.5 text-[14px] font-medium text-[#1A1814] transition-hover hover:border-black/[0.18] hover:bg-white"
            >
              {t("landing.sign_in")}
            </Link>
          </div>
        </nav>

        <div className="relative mx-auto max-w-5xl px-6 pt-8 pb-10 text-center md:pt-16 md:pb-14 md:text-left">
          <p className="font-mono text-[11px] uppercase tracking-widest text-[#8579A8]">
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
              className="text-small text-[#1A1814]/60 transition-hover hover:text-[#8579A8]"
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

      {/* Section 2 — Morning Briefing (proof) */}
      <MorningBriefing />

      {/* Section 3 — Boundaries: "Not ChatGPT." (positioning) */}
      <BoundariesSection />

      <main className="mx-auto max-w-6xl px-6">
        {/* Section 4 — What you do */}
        <section className="py-10 md:py-14">
          <div className="landing-strip mb-10 w-full" />
          <div className="mb-10 max-w-2xl">
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
          <div className="mt-12 md:mt-14">
            <VoiceDemo />
          </div>
        </section>

        {/* Section 5 — A week with Steadii (persistence) */}
        <section className="py-10 md:py-14">
          <div className="landing-strip mb-10 w-full" />
          <div className="mb-10 max-w-2xl">
            <h2 className="whitespace-pre-line text-[32px] font-semibold leading-[1.15] tracking-[-0.02em] text-[#1A1814] [word-break:keep-all] md:text-[44px]">
              {t("landing.week.title")}
            </h2>
            <p className="mt-4 text-[17px] leading-[1.55] text-[#1A1814]/65 md:text-[18px]">
              {t("landing.week.subhead")}
            </p>
          </div>
          <WeekWithSteadii copy={weekCopy} />
        </section>
      </main>

      {/* Section 5 — Founding CTA (cherry-picked Claude Design UI) */}
      <FoundingCta />

      {/* Section 6 — Footer */}
      <footer className="mx-auto flex max-w-6xl flex-wrap items-center gap-6 border-t border-black/[0.06] px-6 py-12 text-small text-[#1A1814]/60">
        <Link
          href="/privacy"
          className="transition-hover hover:text-[#8579A8]"
        >
          {t("landing.footer.privacy")}
        </Link>
        <Link
          href="/terms"
          className="transition-hover hover:text-[#8579A8]"
        >
          {t("landing.footer.terms")}
        </Link>
        <a
          href="mailto:hello@mysteadii.com"
          className="transition-hover hover:text-[#8579A8]"
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
          <span className="font-mono text-[11px] text-[#8579A8]">
            {t("landing.footer.subject_to_change")}
          </span>
        </div>
      </footer>
    </>
  );
}

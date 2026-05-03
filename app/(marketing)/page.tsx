import { getLocale, getTranslations } from "next-intl/server";
import { ChatActionCards } from "./_components/chat-action-cards";
import { ProactiveMock } from "./_components/proactive-mock";
import { VoiceDemo } from "@/components/landing/voice-demo";
import { LandingNav } from "./_components/landing-nav";
import { LandingHero } from "./_components/landing-hero";
import { ValuePropsRow } from "./_components/value-props-row";
import { BoundariesSection } from "./_components/boundaries-section";
import { FoundingCta } from "./_components/founding-cta";
import { LandingFooter } from "./_components/landing-footer";

// Landing structure aligned to the Claude Design archive (2026-05-02).
// Sections in order:
//   1. LandingNav        — logomark + links + locale + CTA
//   2. LandingHero       — voice demo right, copy stack left, holo mesh
//   3. ValuePropsRow     — 4-column thin strip (Email / Calendar / …)
//   4. BoundariesSection — Learning / Deciding / Doing 3-card
//   5. WhatYouDo block   — kept ChatActionCards + VoiceDemo sub-feature
//   6. SteadiiInMotion   — kept ProactiveMock inside a CD-styled frame
//   7. FoundingCta       — dark card with holo mesh
//   8. LandingFooter
//
// Retired: the prior how_it_works (3-step) and glass_box (3-paragraph)
// blocks are dropped per the Claude Design layout. Their copy stays in
// memory if they need to be re-introduced later.
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
    step1_label: t("landing.steadii_in_motion.step1_label"),
    step1_sender: t("landing.steadii_in_motion.step1_sender"),
    step1_subject: t("landing.steadii_in_motion.step1_subject"),
    step1_chip_tier: t("landing.steadii_in_motion.step1_chip_tier"),
    step1_chip_time: t("landing.steadii_in_motion.step1_chip_time"),
    step1_classifying: t("landing.steadii_in_motion.step1_classifying"),
    step1_outcome: t("landing.steadii_in_motion.step1_outcome"),
    step1_outcome_meta: t("landing.steadii_in_motion.step1_outcome_meta"),
    step2_label: t("landing.steadii_in_motion.step2_label"),
    step2_filter_all: t("landing.steadii_in_motion.step2_filter_all"),
    step2_filter_hidden: t("landing.steadii_in_motion.step2_filter_hidden", {
      n: 12,
    }),
    step2_restore: t("landing.steadii_in_motion.step2_restore"),
    step2_meta: t("landing.steadii_in_motion.step2_meta"),
    step3_label: t("landing.steadii_in_motion.step3_label"),
    step3_sender: t("landing.steadii_in_motion.step3_sender"),
    step3_subject: t("landing.steadii_in_motion.step3_subject"),
    step3_chip_tier: t("landing.steadii_in_motion.step3_chip_tier"),
    step3_chip_time: t("landing.steadii_in_motion.step3_chip_time"),
    step3_status: t("landing.steadii_in_motion.step3_status"),
    step3_meta: t("landing.steadii_in_motion.step3_meta"),
  };

  return (
    <>
      <LandingNav />
      <LandingHero />
      <ValuePropsRow />
      <BoundariesSection />

      {/* What you do — kept ChatActionCards + VoiceDemo sub-feature */}
      <section className="mx-auto max-w-[1280px] px-6 pb-12 pt-4 md:px-12">
        <div className="mb-10 max-w-[640px]">
          <h2
            className="m-0 whitespace-pre-line text-[32px] font-semibold leading-[1.15] md:text-[36px]"
            style={{
              color: "var(--ink-1)",
              letterSpacing: "-0.022em",
              fontFamily:
                locale === "ja" ? "var(--font-jp)" : "var(--font-sans)",
              wordBreak: "keep-all",
            }}
          >
            {t("landing.what_you_do.title")}
          </h2>
          <p
            className="mt-2 text-[14px]"
            style={{ color: "var(--ink-4)" }}
          >
            {t("landing.what_you_do.voice_or_type")}
          </p>
          <p
            className="mt-3 text-[16px] leading-[1.55]"
            style={{ color: "var(--ink-3)" }}
          >
            {t("landing.what_you_do.subhead")}
          </p>
        </div>
        <ChatActionCards cards={cards} />
        <div className="mt-16 md:mt-20">
          <VoiceDemo />
        </div>
      </section>

      {/* Steadii in motion — kept ProactiveMock inside a CD-styled frame */}
      <section
        id="in-motion"
        className="mx-auto max-w-[1280px] px-6 py-16 md:px-12"
      >
        <div className="mb-5 max-w-[520px]">
          <h2
            className="m-0 text-[32px] font-semibold leading-[1.15] md:text-[36px]"
            style={{
              color: "var(--ink-1)",
              letterSpacing: "-0.022em",
              fontFamily:
                locale === "ja" ? "var(--font-jp)" : "var(--font-sans)",
            }}
          >
            {t("landing.steadii_in_motion.title")}
          </h2>
          <p
            className="mt-2 text-[16px] leading-[1.55]"
            style={{ color: "var(--ink-3)" }}
          >
            {t("landing.steadii_in_motion.body")}
          </p>
        </div>
        <ProactiveMock copy={proactiveCopy} />
        <p
          className="mt-3 font-mono text-[11px] uppercase tracking-widest"
          style={{ color: "var(--ink-4)" }}
        >
          {t("landing.steadii_in_motion.real_screen")}
        </p>
      </section>

      <FoundingCta />
      <LandingFooter />
    </>
  );
}

import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Sparkles } from "lucide-react";
import { HoloMesh } from "@/components/landing/visual/holo-mesh";
import { HoloText } from "@/components/landing/visual/holo-text";
import { HeroVoiceDemo } from "./hero-voice-demo";

// Hero — left column copy stack, right column voice demo. Atmospheric
// holo-mesh sits behind everything.
export async function LandingHero() {
  const t = await getTranslations();
  const locale = (await getLocale()) as "en" | "ja";

  return (
    <section className="relative mx-auto max-w-[1280px] px-6 pb-[60px] pt-[44px] md:px-12">
      <HoloMesh opacity={0.45} blur={60} />

      <div className="relative z-[1] grid items-center gap-14 md:grid-cols-[minmax(0,540px)_1fr]">
        <div>
          <span
            className="mb-[18px] inline-flex items-center gap-1 rounded-full px-2 py-[2px] text-[11.5px] font-medium"
            style={{
              height: 22,
              background:
                "color-mix(in oklch, var(--holo-2) 8%, var(--bg-raised))",
              border:
                "0.5px solid color-mix(in oklch, var(--holo-2) 30%, transparent)",
              color: "var(--ink-1)",
              letterSpacing: "0.005em",
            }}
          >
            <Sparkles size={11} strokeWidth={1.7} />
            {t("landing.hero.eyebrow")}
          </span>
          <h1
            className="m-0 text-[44px] font-semibold leading-[1.04] md:text-[56px]"
            style={{
              color: "var(--ink-1)",
              letterSpacing: "-0.025em",
              fontFamily:
                locale === "ja" ? "var(--font-jp)" : "var(--font-sans)",
            }}
          >
            {t("landing.hero.h1_a")}{" "}
            <HoloText italic>{t("landing.hero.h1_b")}</HoloText>{" "}
            {t("landing.hero.h1_c")}
          </h1>
          <p
            className="mt-5 max-w-[480px] text-[17px] leading-[1.55]"
            style={{ color: "var(--ink-2)" }}
          >
            {t("landing.hero.sub")}
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-2.5">
            <Link
              href="/request-access"
              className="landing-cta inline-flex h-[44px] items-center rounded-[10px] bg-[#0c0d10] px-[18px] text-[15px] font-medium text-white shadow-[0_8px_24px_rgba(0,0,0,0.18)] transition-hover hover:scale-[1.02]"
            >
              {t("landing.hero.cta_primary")}
            </Link>
            <a
              href="#in-motion"
              className="inline-flex h-[44px] items-center gap-2 rounded-[10px] px-[14px] text-[15px] font-medium transition-hover hover:text-[#8579A8]"
              style={{ color: "var(--ink-1)" }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden
              >
                <path d="M6 4l10 6-10 6z" />
              </svg>
              {t("landing.hero.cta_secondary")}
            </a>
          </div>
          <div
            className="mt-5 flex items-center gap-2.5 text-[12.5px]"
            style={{ color: "var(--ink-4)" }}
          >
            <span className="flex">
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  className="block"
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 999,
                    marginLeft: i ? -6 : 0,
                    border: "2px solid var(--bg-page)",
                    background:
                      i === 0
                        ? "var(--gradient-holo)"
                        : i === 1
                          ? "color-mix(in oklch, var(--holo-1) 50%, white)"
                          : i === 2
                            ? "color-mix(in oklch, var(--holo-2) 50%, white)"
                            : "color-mix(in oklch, var(--holo-3) 50%, white)",
                  }}
                  aria-hidden
                />
              ))}
            </span>
            <span>{t("landing.hero.meta")}</span>
          </div>
        </div>

        <HeroVoiceDemo
          copy={{
            ariaLabel: t("landing.hero.demo.aria_label"),
            fullPhrase: t("landing.hero.demo.full_phrase"),
            listening: t("landing.hero.demo.listening"),
            transcribing: t("landing.hero.demo.transcribing"),
            drafting: t("landing.hero.demo.drafting"),
            done: t("landing.hero.demo.done"),
            draft_eyebrow: t("landing.hero.demo.draft_eyebrow"),
            draft_title: t("landing.hero.demo.draft_title"),
            draft_subject: t("landing.hero.demo.draft_subject"),
            draft_body: t("landing.hero.demo.draft_body"),
            draft_send: t("landing.hero.demo.draft_send"),
            draft_review: t("landing.hero.demo.draft_review"),
            draft_skip: t("landing.hero.demo.draft_skip"),
            draft_origin: t("landing.hero.demo.draft_origin"),
            draft_time: t("landing.hero.demo.draft_time"),
            fontJa: locale === "ja",
          }}
        />
      </div>
    </section>
  );
}

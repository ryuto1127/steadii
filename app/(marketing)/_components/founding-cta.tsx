import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { HoloMesh } from "@/components/landing/visual/holo-mesh";

// Founding CTA — dark card with a holographic mesh. Primary CTA goes to
// /request-access (the existing handler). Secondary CTA points at the
// invite landing as a referral-code redemption.
export async function FoundingCta() {
  const t = await getTranslations();
  const locale = (await getLocale()) as "en" | "ja";

  return (
    <section className="relative mx-auto max-w-[1280px] px-6 pb-20 md:px-12">
      <div
        className="relative overflow-hidden text-white"
        style={{
          background: "var(--ink-1)",
          borderRadius: "var(--r-4)",
          padding: "56px 48px",
        }}
      >
        <HoloMesh opacity={0.35} blur={50} />
        <div className="relative max-w-[720px]">
          <h2
            className="mb-3 text-[32px] font-semibold leading-[1.05] md:text-[44px]"
            style={{
              letterSpacing: "-0.024em",
              fontFamily:
                locale === "ja" ? "var(--font-jp)" : "var(--font-sans)",
            }}
          >
            {t("landing.founding.h2")}
          </h2>
          <p
            className="mb-7 max-w-[520px] text-[17px]"
            style={{ color: "rgba(255,255,255,0.78)" }}
          >
            {t("landing.founding.body")}
          </p>
          <div className="flex flex-wrap items-center gap-2.5">
            <Link
              href="/request-access"
              className="inline-flex h-[44px] items-center rounded-[10px] px-[18px] text-[15px] font-semibold transition-hover hover:scale-[1.02]"
              style={{
                background: "var(--gradient-holo)",
                color: "var(--ink-1)",
              }}
            >
              {t("landing.founding.cta")}
            </Link>
            <Link
              href="/login"
              className="inline-flex h-[44px] items-center rounded-[10px] px-[18px] text-[15px] font-medium transition-hover"
              style={{
                color: "white",
                border: "1px solid rgba(255,255,255,0.3)",
              }}
            >
              {t("landing.founding.cta_secondary")}
            </Link>
            <span
              className="ml-1 text-[12px]"
              style={{ color: "rgba(255,255,255,0.55)" }}
            >
              {t("landing.founding.note")}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Logomark } from "@/components/landing/visual/logomark";
import { NavLocaleToggle } from "./nav-locale-toggle";

// Top-of-landing navigation. Adopts Claude Design's row layout: logomark +
// brand wordmark on the left, link cluster, pill locale toggle, primary
// CTA. Hover is restrained — accent (#8579A8) on link hover, no underline.
export async function LandingNav() {
  const t = await getTranslations();
  const locale = (await getLocale()) as "en" | "ja";

  return (
    <nav className="relative z-10 mx-auto flex max-w-[1280px] items-center gap-6 px-6 py-5 md:px-12">
      <Link href="/" className="flex items-center gap-2 text-[#1A1814]">
        <Logomark size={22} />
        <span className="text-[16px] font-semibold tracking-[-0.012em]">
          Steadii
        </span>
      </Link>
      <div className="flex-1" />
      <div className="hidden items-center gap-[22px] text-[13.5px] text-[#2a2c33] md:flex">
        <a
          href="#what-it-does"
          className="transition-hover hover:text-[#8579A8]"
        >
          {t("landing.nav.what_it_does")}
        </a>
        <a
          href="#students"
          className="transition-hover hover:text-[#8579A8]"
        >
          {t("landing.nav.students")}
        </a>
        <Link
          href="/privacy"
          className="transition-hover hover:text-[#8579A8]"
        >
          {t("landing.nav.privacy")}
        </Link>
        <Link
          href="/login"
          className="transition-hover hover:text-[#8579A8]"
        >
          {t("landing.nav.log_in")}
        </Link>
      </div>
      <NavLocaleToggle
        current={locale}
        labels={{
          en: t("landing.locale_toggle.en"),
          ja: t("landing.locale_toggle.ja"),
        }}
        ariaLabel={t("landing.locale_toggle.aria_label")}
      />
      <Link
        href="/request-access"
        className="inline-flex h-[28px] items-center rounded-[10px] bg-[#0c0d10] px-3 text-[13px] font-medium text-white transition-hover hover:scale-[1.02]"
      >
        {t("landing.cta_request_access")}
      </Link>
    </nav>
  );
}

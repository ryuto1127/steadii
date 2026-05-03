import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Logomark } from "@/components/landing/visual/logomark";
import { LocaleToggle } from "./locale-toggle";

// Single-row landing footer. Brand mark + © + city on the left, three
// links + locale toggle on the right.
export async function LandingFooter() {
  const t = await getTranslations();
  const locale = (await getLocale()) as "en" | "ja";

  return (
    <footer
      className="mx-auto max-w-[1280px] px-6 pb-12 pt-8 md:px-12"
      style={{ borderTop: "1px solid var(--line)" }}
    >
      <div
        className="flex flex-wrap items-center gap-4 text-[12.5px]"
        style={{ color: "var(--ink-4)" }}
      >
        <Logomark size={18} />
        <span>{t("landing.footer.copyright")}</span>
        <span aria-hidden>·</span>
        <span>{locale === "ja" ? "東京・三田" : "Tokyo · Mita"}</span>
        <span className="flex-1" />
        <Link
          href="/privacy"
          className="transition-hover hover:text-[#8579A8]"
          style={{ color: "inherit" }}
        >
          {t("landing.footer.privacy")}
        </Link>
        <Link
          href="/terms"
          className="transition-hover hover:text-[#8579A8]"
          style={{ color: "inherit" }}
        >
          {t("landing.footer.terms")}
        </Link>
        <a
          href="mailto:hello@mysteadii.com"
          className="transition-hover hover:text-[#8579A8]"
          style={{ color: "inherit" }}
        >
          {t("landing.footer.contact")}
        </a>
        <LocaleToggle
          current={locale}
          labels={{
            en: t("landing.locale_toggle.en"),
            ja: t("landing.locale_toggle.ja"),
          }}
          ariaLabel={t("landing.locale_toggle.aria_label")}
        />
        <span
          className="font-mono text-[11px]"
          style={{ color: "var(--ink-4)" }}
        >
          {t("landing.footer.subject_to_change")}
        </span>
      </div>
    </footer>
  );
}

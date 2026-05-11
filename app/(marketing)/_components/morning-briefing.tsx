import { getLocale, getTranslations } from "next-intl/server";
import { ContextTag } from "./context-tag";

// "Your morning, already organized." — phone-screen-feeling brief card.
// Three numbered items, each with a headline, action, and context tag.
// Static — the card IS the proof, it doesn't need to perform.
export async function MorningBriefing() {
  const t = await getTranslations();
  const locale = (await getLocale()) as "en" | "ja";

  const jpFont = locale === "ja" ? "var(--font-jp)" : "var(--font-sans)";
  const contextLabel = t("landing.morning_briefing.context_label");

  const items = [
    {
      headline: t("landing.morning_briefing.item1_headline"),
      action: t("landing.morning_briefing.item1_action"),
      context: t("landing.morning_briefing.item1_context"),
    },
    {
      headline: t("landing.morning_briefing.item2_headline"),
      action: t("landing.morning_briefing.item2_action"),
      context: t("landing.morning_briefing.item2_context"),
    },
    {
      headline: t("landing.morning_briefing.item3_headline"),
      action: t("landing.morning_briefing.item3_action"),
      context: t("landing.morning_briefing.item3_context"),
    },
  ];

  return (
    <section className="relative mx-auto max-w-[1280px] px-6 py-16 md:px-12">
      <h2
        className="mb-2 text-[32px] font-semibold leading-[1.15] md:text-[36px]"
        style={{
          color: "var(--ink-1)",
          letterSpacing: "-0.022em",
          maxWidth: 640,
          fontFamily: jpFont,
        }}
      >
        {t("landing.morning_briefing.title")}
      </h2>
      <p
        className="mb-10 max-w-[640px] text-[16px] leading-[1.55]"
        style={{ color: "var(--ink-3)" }}
      >
        {t("landing.morning_briefing.subhead")}
      </p>

      <div className="relative mx-auto max-w-[480px]">
        {/* Soft gradient backdrop — warm amber + lavender wash, low opacity. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-8 opacity-70"
          style={{
            background: `
              radial-gradient(circle at 0% 0%, rgba(220, 200, 170, 0.18) 0%, transparent 55%),
              radial-gradient(circle at 100% 100%, rgba(178, 165, 200, 0.18) 0%, transparent 55%)
            `,
            filter: "blur(20px)",
          }}
        />

        <div className="relative rounded-[16px] border border-black/[0.06] bg-white px-6 py-6 shadow-[0_30px_80px_-20px_rgba(20,20,40,0.18)]">
          <p
            className="font-mono text-[11px] uppercase tracking-widest"
            style={{ color: "var(--ink-4)" }}
          >
            {t("landing.morning_briefing.card_datetime")}
          </p>
          <div className="mt-3 border-t border-black/[0.06]" />

          <h3
            className="mt-4 text-[17px] font-semibold"
            style={{ color: "var(--ink-1)", fontFamily: jpFont }}
          >
            {t("landing.morning_briefing.card_greeting")}
          </h3>
          <p
            className="mt-1 text-[14px] leading-[1.5]"
            style={{ color: "var(--ink-3)" }}
          >
            {t("landing.morning_briefing.card_intro")}
          </p>

          <ol className="mt-5 flex flex-col gap-4">
            {items.map((item, i) => (
              <li key={i} className="flex flex-col">
                <div className="flex items-baseline gap-2">
                  <span
                    className="font-mono text-[11px] font-medium"
                    style={{ color: "var(--ink-4)" }}
                  >
                    {i + 1}
                  </span>
                  <strong
                    className="text-[15px] font-semibold leading-[1.35]"
                    style={{ color: "var(--ink-1)", fontFamily: jpFont }}
                  >
                    {item.headline}
                  </strong>
                </div>
                <p
                  className="mt-1 pl-[20px] text-[13.5px] leading-[1.5]"
                  style={{ color: "var(--ink-3)" }}
                >
                  {item.action}
                </p>
                <div className="mt-1.5 pl-[20px]">
                  <ContextTag label={contextLabel} value={item.context} />
                </div>
              </li>
            ))}
          </ol>

          <div className="mt-5 border-t border-black/[0.06] pt-4">
            <p
              className="text-center text-[13px] italic"
              style={{ color: "var(--ink-3)", fontFamily: jpFont }}
            >
              {t("landing.morning_briefing.card_close")}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

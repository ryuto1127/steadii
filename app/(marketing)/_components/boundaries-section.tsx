import { getLocale, getTranslations } from "next-intl/server";
import { Sparkles, Eye, Play } from "lucide-react";
import { HoloMesh } from "@/components/landing/visual/holo-mesh";

// "What you do, what Steadii does" — three boundary cards. Last card
// (Doing → Steadii) is dark with a holo mesh, signaling Steadii's lane.
const ICONS = {
  learning: Sparkles,
  deciding: Eye,
  doing: Play,
} as const;

type CardKey = keyof typeof ICONS;

export async function BoundariesSection() {
  const t = await getTranslations();
  const locale = (await getLocale()) as "en" | "ja";

  const cards: Array<{ id: CardKey; who: string; key: string; body: string }> =
    [
      {
        id: "learning",
        who: t("landing.boundaries.cards.learning.who"),
        key: t("landing.boundaries.cards.learning.key"),
        body: t("landing.boundaries.cards.learning.body"),
      },
      {
        id: "deciding",
        who: t("landing.boundaries.cards.deciding.who"),
        key: t("landing.boundaries.cards.deciding.key"),
        body: t("landing.boundaries.cards.deciding.body"),
      },
      {
        id: "doing",
        who: t("landing.boundaries.cards.doing.who"),
        key: t("landing.boundaries.cards.doing.key"),
        body: t("landing.boundaries.cards.doing.body"),
      },
    ];

  return (
    <section
      id="students"
      className="relative mx-auto max-w-[1280px] px-6 py-16 md:px-12"
    >
      <h2
        className="mb-2 text-[32px] font-semibold leading-[1.15] md:text-[36px]"
        style={{
          color: "var(--ink-1)",
          letterSpacing: "-0.022em",
          maxWidth: 640,
          fontFamily: locale === "ja" ? "var(--font-jp)" : "var(--font-sans)",
        }}
      >
        {t("landing.boundaries.title")}
      </h2>
      <p
        className="mb-8 max-w-[540px] text-[16px] leading-[1.55]"
        style={{ color: "var(--ink-3)" }}
      >
        {t("landing.boundaries.subhead")}
      </p>
      <div className="grid gap-4 md:grid-cols-3">
        {cards.map((c, i) => {
          const Icon = ICONS[c.id];
          const isLast = i === cards.length - 1;
          return (
            <div
              key={c.id}
              className="relative overflow-hidden p-6"
              style={{
                background: isLast ? "var(--ink-1)" : "var(--bg-raised)",
                color: isLast ? "white" : "var(--ink-1)",
                border: isLast ? "none" : "1px solid var(--line)",
                borderRadius: "var(--r-4)",
                minHeight: 240,
              }}
            >
              {isLast && <HoloMesh opacity={0.45} blur={40} />}
              <div className="relative mb-4 flex items-center gap-2">
                <span
                  className="grid h-7 w-7 place-items-center rounded-lg"
                  style={{
                    background: isLast
                      ? "rgba(255,255,255,0.14)"
                      : "var(--bg-sunken)",
                    color: isLast ? "white" : "var(--ink-2)",
                  }}
                >
                  <Icon size={14} strokeWidth={1.7} />
                </span>
                <span
                  className="text-[11px] font-semibold uppercase tracking-[0.08em]"
                  style={{
                    color: isLast ? "rgba(255,255,255,0.7)" : "var(--ink-4)",
                  }}
                >
                  {c.who}
                </span>
              </div>
              <div
                className="relative mb-2.5 text-[28px] font-semibold leading-[1.1]"
                style={{
                  letterSpacing: "-0.02em",
                  fontFamily:
                    locale === "ja" ? "var(--font-jp)" : "var(--font-sans)",
                }}
              >
                {c.key}
              </div>
              <p
                className="relative m-0 text-[14px] leading-[1.5]"
                style={{
                  color: isLast ? "rgba(255,255,255,0.78)" : "var(--ink-3)",
                }}
              >
                {c.body}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

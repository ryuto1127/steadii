import { getLocale, getTranslations } from "next-intl/server";
import { HoloMesh } from "@/components/landing/visual/holo-mesh";

// "Not ChatGPT." — ChatGPT vs Steadii. Light card / dark card with holo mesh.
// The Learning/Deciding/Doing axis is gone; this section now names the
// positioning thesis directly.
type CardKey = "chatgpt" | "steadii";

export async function BoundariesSection() {
  const t = await getTranslations();
  const locale = (await getLocale()) as "en" | "ja";

  const cards: Array<{ id: CardKey; who: string; key: string; body: string }> =
    [
      {
        id: "chatgpt",
        who: t("landing.boundaries.cards.chatgpt.who"),
        key: t("landing.boundaries.cards.chatgpt.key"),
        body: t("landing.boundaries.cards.chatgpt.body"),
      },
      {
        id: "steadii",
        who: t("landing.boundaries.cards.steadii.who"),
        key: t("landing.boundaries.cards.steadii.key"),
        body: t("landing.boundaries.cards.steadii.body"),
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
        className="mb-8 max-w-[640px] text-[16px] leading-[1.55]"
        style={{ color: "var(--ink-3)" }}
      >
        {t("landing.boundaries.subhead")}
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        {cards.map((c) => {
          const isSteadii = c.id === "steadii";
          return (
            <div
              key={c.id}
              className="relative overflow-hidden p-6"
              style={{
                background: isSteadii ? "var(--ink-1)" : "var(--bg-raised)",
                color: isSteadii ? "white" : "var(--ink-1)",
                border: isSteadii ? "none" : "1px solid var(--line)",
                borderRadius: "var(--r-4)",
                minHeight: 240,
              }}
            >
              {isSteadii && <HoloMesh opacity={0.45} blur={40} />}
              <div className="relative mb-4">
                <span
                  className="text-[11px] font-mono font-semibold uppercase tracking-[0.08em]"
                  style={{
                    color: isSteadii ? "rgba(255,255,255,0.7)" : "var(--ink-4)",
                  }}
                >
                  {c.who}
                </span>
              </div>
              <div
                className="relative mb-3 text-[28px] font-semibold leading-[1.15] md:text-[32px]"
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
                  color: isSteadii ? "rgba(255,255,255,0.78)" : "var(--ink-3)",
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

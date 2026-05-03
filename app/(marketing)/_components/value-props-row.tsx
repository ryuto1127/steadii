import { getTranslations } from "next-intl/server";
import { HoloText } from "@/components/landing/visual/holo-text";

// 4-column row of value prop labels under the hero. Adopts Claude
// Design's narrow strip pattern: thin top + bottom border, holographic
// uppercase eyebrow per cell, single sentence body.
export async function ValuePropsRow() {
  const t = await getTranslations();
  const items = [
    {
      key: t("landing.value_props.email.key"),
      body: t("landing.value_props.email.body"),
    },
    {
      key: t("landing.value_props.calendar.key"),
      body: t("landing.value_props.calendar.body"),
    },
    {
      key: t("landing.value_props.groups.key"),
      body: t("landing.value_props.groups.body"),
    },
    {
      key: t("landing.value_props.admin.key"),
      body: t("landing.value_props.admin.body"),
    },
  ];

  return (
    <section
      id="what-it-does"
      className="relative mx-auto max-w-[1280px] px-6 py-8 md:px-12"
    >
      <div
        className="grid gap-[18px] py-5 md:grid-cols-4"
        style={{
          borderTop: "1px solid var(--line)",
          borderBottom: "1px solid var(--line)",
        }}
      >
        {items.map((it) => (
          <div key={it.key}>
            <HoloText className="text-[11px] font-semibold uppercase tracking-[0.08em]">
              {it.key}
            </HoloText>
            <div
              className="mt-1.5 text-[13.5px] leading-[1.5]"
              style={{ color: "var(--ink-2)" }}
            >
              {it.body}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

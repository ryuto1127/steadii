import { getTranslations } from "next-intl/server";

// Switched off `force-static` so the locale cookie / Accept-Language header
// can drive whether the JA or EN copy is rendered. The page is still
// effectively cacheable per (locale, build) by next-intl.
export const dynamic = "force-dynamic";

export default async function PrivacyPage() {
  const t = await getTranslations("legal");
  const sections = [
    "what_we_collect",
    "how_we_use_it",
    "model_training",
    "third_parties",
    "data_location",
    "retention_deletion",
    "your_rights",
    "appi_purpose",
    "appi_third_party",
    "appi_cross_border",
    "appi_contact",
    "appi_request_procedure",
    "alpha_caveat",
  ] as const;

  return (
    <main className="mx-auto max-w-2xl px-6 py-20">
      <p className="font-mono text-[11px] uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
        {t("alpha_caveat")}
      </p>
      <h1 className="mt-4 font-display text-[hsl(var(--foreground))]">
        {t("privacy_title")}
      </h1>
      <p className="mt-3 text-small text-[hsl(var(--muted-foreground))]">
        {t("last_updated")}: {t("last_updated_date")}
      </p>

      <div className="mt-10 space-y-6 text-sm leading-relaxed">
        {sections.map((key) => (
          <Section
            key={key}
            heading={t(`privacy.${key}.heading`)}
            body={t(`privacy.${key}.body`)}
          />
        ))}
      </div>
    </main>
  );
}

function Section({ heading, body }: { heading: string; body: string }) {
  return (
    <section>
      <h2 className="text-h2 text-[hsl(var(--foreground))]">{heading}</h2>
      <p className="mt-2 text-body text-[hsl(var(--foreground))]">{body}</p>
    </section>
  );
}

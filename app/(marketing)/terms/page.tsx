import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

export default async function TermsPage() {
  const t = await getTranslations("legal");
  const sections = [
    "alpha_status",
    "acceptable_use",
    "your_content",
    "external_services",
    "plan_limits",
    "founding_member",
    "termination",
    "liability",
    "contact",
  ] as const;

  return (
    <main className="mx-auto max-w-2xl px-6 py-20">
      <p className="font-mono text-[11px] uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
        {t("alpha_caveat")}
      </p>
      <h1 className="mt-4 font-display text-[hsl(var(--foreground))]">
        {t("terms_title")}
      </h1>
      <p className="mt-3 text-small text-[hsl(var(--muted-foreground))]">
        {t("last_updated")}: {t("last_updated_date")}
      </p>

      <div className="mt-10 space-y-6 text-sm leading-relaxed">
        {sections.map((key) => (
          <Section
            key={key}
            heading={t(`terms.${key}.heading`)}
            body={t(`terms.${key}.body`)}
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

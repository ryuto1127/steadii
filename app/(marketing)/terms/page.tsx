import { getTranslations } from "next-intl/server";

export default async function TermsPage() {
  const t = await getTranslations();
  return (
    <main className="mx-auto max-w-2xl px-6 py-20">
      <h1 className="font-serif text-4xl">{t("legal.terms_title")}</h1>
      <p className="mt-8 text-[hsl(var(--muted-foreground))]">{t("legal.placeholder")}</p>
    </main>
  );
}

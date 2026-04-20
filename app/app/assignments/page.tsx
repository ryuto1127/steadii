import { getTranslations } from "next-intl/server";

export default async function AssignmentsPage() {
  const t = await getTranslations("nav");
  const empty = await getTranslations("app");
  return (
    <div>
      <h1 className="font-serif text-3xl">{t("assignments")}</h1>
      <p className="mt-4 text-[hsl(var(--muted-foreground))]">{empty("empty_state")}</p>
    </div>
  );
}

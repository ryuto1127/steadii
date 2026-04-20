import Link from "next/link";
import { getTranslations } from "next-intl/server";

export default async function SettingsPage() {
  const t = await getTranslations("nav");
  return (
    <div className="max-w-xl">
      <h1 className="font-serif text-3xl">{t("settings")}</h1>
      <ul className="mt-8 divide-y divide-[hsl(var(--border))] rounded-xl bg-[hsl(var(--surface))]">
        <li>
          <Link
            href="/app/settings/connections"
            className="flex items-center justify-between px-6 py-4 text-sm transition hover:bg-[hsl(var(--surface-raised))]"
          >
            <span>Connections</span>
            <span className="text-[hsl(var(--muted-foreground))]">→</span>
          </Link>
        </li>
        <li>
          <Link
            href="/app/resources"
            className="flex items-center justify-between px-6 py-4 text-sm transition hover:bg-[hsl(var(--surface-raised))]"
          >
            <span>Registered Resources</span>
            <span className="text-[hsl(var(--muted-foreground))]">→</span>
          </Link>
        </li>
      </ul>
    </div>
  );
}

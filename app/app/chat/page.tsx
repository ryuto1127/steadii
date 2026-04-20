import { getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth/config";

export default async function ChatPage() {
  const session = await auth();
  const t = await getTranslations();
  const name = session?.user?.name ?? session?.user?.email ?? "";

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-serif text-3xl text-[hsl(var(--foreground))]">
        {t("app.welcome", { name })}
      </h1>
      <p className="mt-4 text-[hsl(var(--muted-foreground))]">{t("app.empty_state")}</p>
    </div>
  );
}

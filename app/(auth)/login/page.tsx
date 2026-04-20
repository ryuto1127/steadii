import { getTranslations } from "next-intl/server";
import { signIn, auth } from "@/lib/auth/config";
import { redirect } from "next/navigation";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const session = await auth();
  const { from } = await searchParams;
  const target = from && from.startsWith("/app") ? from : "/app/chat";

  if (session?.user) {
    redirect(target);
  }

  const t = await getTranslations();

  async function signInAction() {
    "use server";
    await signIn("google", { redirectTo: target });
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-20">
      <h1 className="font-serif text-4xl">{t("login.title")}</h1>
      <p className="mt-3 text-[hsl(var(--muted-foreground))]">{t("login.subtitle")}</p>
      <form action={signInAction} className="mt-10">
        <button
          type="submit"
          className="w-full rounded-lg bg-[hsl(var(--primary))] px-5 py-3 font-medium text-[hsl(var(--primary-foreground))] shadow-sm transition hover:opacity-90"
        >
          {t("login.button")}
        </button>
      </form>
    </main>
  );
}

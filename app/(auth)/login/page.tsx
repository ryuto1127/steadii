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
  const target = from && from.startsWith("/app") ? from : "/app";

  if (session?.user) {
    redirect(target);
  }

  const t = await getTranslations();

  async function signInAction() {
    "use server";
    await signIn("google", { redirectTo: target });
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <p className="font-mono text-[11px] uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
        Steadii
      </p>
      <h1 className="mt-3 font-display text-[hsl(var(--foreground))]">
        {t("brand.tagline")}
      </h1>
      <p className="mt-2 text-small text-[hsl(var(--muted-foreground))]">
        {t("login.subtitle")}
      </p>
      <form action={signInAction} className="mt-8">
        <button
          type="submit"
          className="w-full rounded-md bg-[hsl(var(--primary))] px-4 py-2 text-body font-medium text-[hsl(var(--primary-foreground))] transition-hover hover:opacity-90"
        >
          {t("login.button")}
        </button>
      </form>
    </main>
  );
}

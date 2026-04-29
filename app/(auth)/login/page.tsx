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
    <div className="landing-light relative min-h-screen overflow-hidden bg-[#FAFAF9]">
      <style>{`
        html { background-color: #FAFAF9; color-scheme: light; }
        body { background-color: #FAFAF9; }
      `}</style>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
      >
        <div
          className="steadii-mesh absolute -inset-[10%] opacity-60"
          style={{
            background: `
              radial-gradient(circle at 20% 30%, rgba(6, 182, 212, 0.50) 0%, transparent 45%),
              radial-gradient(circle at 80% 25%, rgba(217, 70, 239, 0.45) 0%, transparent 48%),
              radial-gradient(circle at 50% 80%, rgba(190, 242, 100, 0.40) 0%, transparent 50%),
              radial-gradient(circle at 85% 80%, rgba(59, 130, 246, 0.40) 0%, transparent 46%)
            `,
          }}
        />
      </div>
      <main className="relative mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
        <p className="font-mono text-[11px] uppercase tracking-widest text-[#7C3AED]">
          Steadii
        </p>
        <h1 className="mt-3 text-[40px] font-semibold leading-[1.1] tracking-[-0.02em] text-[#1A1814]">
          {t("brand.tagline")}
        </h1>
        <p className="mt-3 text-[15px] text-[#1A1814]/65">
          {t("login.subtitle")}
        </p>
        <form action={signInAction} className="mt-8">
          <button
            type="submit"
            className="w-full rounded-full bg-[#0A0A0A] px-6 py-3 text-[15px] font-medium text-white shadow-[0_8px_24px_rgba(0,0,0,0.18)] transition-hover hover:scale-[1.02]"
          >
            {t("login.button")}
          </button>
        </form>
      </main>
    </div>
  );
}

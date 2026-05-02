import { getTranslations } from "next-intl/server";

export default async function AppLoading() {
  const t = await getTranslations("app");
  return (
    <div
      role="status"
      aria-label={t("loading_aria")}
      className="mx-auto flex min-h-[calc(100vh-8rem)] max-w-6xl flex-col gap-10 py-2"
    >
      <div className="flex flex-col gap-3">
        <div className="h-9 w-64 animate-pulse rounded-md bg-[hsl(var(--surface-raised))]" />
        <div className="h-5 w-80 animate-pulse rounded-md bg-[hsl(var(--surface-raised))]" />
      </div>
      <div className="grid gap-6 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="flex h-52 animate-pulse flex-col gap-4 rounded-3xl border border-[hsl(var(--border)/0.6)] bg-[hsl(var(--surface-raised))] p-6"
          >
            <div className="h-10 w-10 rounded-2xl bg-[hsl(var(--border)/0.5)]" />
            <div className="h-3 w-24 rounded bg-[hsl(var(--border)/0.5)]" />
            <div className="mt-auto flex flex-col gap-2">
              <div className="h-3 w-full rounded bg-[hsl(var(--border)/0.4)]" />
              <div className="h-3 w-2/3 rounded bg-[hsl(var(--border)/0.4)]" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

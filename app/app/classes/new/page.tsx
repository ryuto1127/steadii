import { auth } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { createClass, classSaveSchema } from "@/lib/classes/save";

export const dynamic = "force-dynamic";

const COLORS = [
  { value: "blue", hex: "#3B82F6" },
  { value: "green", hex: "#10B981" },
  { value: "orange", hex: "#F97316" },
  { value: "purple", hex: "#8B5CF6" },
  { value: "red", hex: "#EF4444" },
  { value: "gray", hex: "#6B7280" },
  { value: "brown", hex: "#92400E" },
  { value: "pink", hex: "#EC4899" },
] as const;

async function createClassAction(formData: FormData): Promise<void> {
  "use server";
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;

  const raw = {
    name: String(formData.get("name") ?? "").trim(),
    code: stringOrNull(formData.get("code")),
    term: stringOrNull(formData.get("term")),
    professor: stringOrNull(formData.get("professor")),
    color: stringOrNull(formData.get("color")),
  };

  const parsed = classSaveSchema.safeParse(raw);
  if (!parsed.success) {
    redirect(`/app/classes/new?error=${encodeURIComponent(parsed.error.message)}`);
  }

  const { id } = await createClass({ userId, input: parsed.data });
  redirect(`/app/classes/${id}`);
}

function stringOrNull(v: FormDataEntryValue | null): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export default async function NewClassPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const t = await getTranslations("class_form");

  const sp = await searchParams;
  const error = sp.error;

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 py-6">
      <div>
        <Link
          href="/app/classes"
          className="inline-flex items-center gap-1 text-small text-[hsl(var(--muted-foreground))] transition-hover hover:text-[hsl(var(--foreground))]"
        >
          <ArrowLeft size={14} strokeWidth={1.75} />
          {t("back")}
        </Link>
      </div>

      <h1 className="text-h1 text-[hsl(var(--foreground))]">{t("title")}</h1>

      {error ? (
        <div className="rounded-md border border-[hsl(var(--destructive))] bg-[hsl(var(--destructive)/0.08)] px-3 py-2 text-small text-[hsl(var(--destructive))]">
          {error}
        </div>
      ) : null}

      <form action={createClassAction} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="name"
            className="text-small font-medium text-[hsl(var(--foreground))]"
          >
            {t("name_label")} <span className="text-[hsl(var(--destructive))]">*</span>
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            maxLength={200}
            placeholder={t("name_placeholder")}
            className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-2 text-body text-[hsl(var(--foreground))] focus:border-[hsl(var(--primary))] focus:outline-none"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="code"
            className="text-small font-medium text-[hsl(var(--foreground))]"
          >
            {t("code_label")}{" "}
            <span className="text-[hsl(var(--muted-foreground))]">{t("optional_indicator")}</span>
          </label>
          <input
            id="code"
            name="code"
            type="text"
            maxLength={50}
            placeholder={t("code_placeholder")}
            className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-2 text-body text-[hsl(var(--foreground))] focus:border-[hsl(var(--primary))] focus:outline-none"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="term"
            className="text-small font-medium text-[hsl(var(--foreground))]"
          >
            {t("term_label")}{" "}
            <span className="text-[hsl(var(--muted-foreground))]">{t("optional_indicator")}</span>
          </label>
          <input
            id="term"
            name="term"
            type="text"
            maxLength={100}
            placeholder={t("term_placeholder")}
            className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-2 text-body text-[hsl(var(--foreground))] focus:border-[hsl(var(--primary))] focus:outline-none"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-small font-medium text-[hsl(var(--foreground))]">
            {t("color_label")}{" "}
            <span className="text-[hsl(var(--muted-foreground))]">{t("optional_indicator")}</span>
          </label>
          <div
            role="radiogroup"
            aria-label={t("color_aria")}
            className="flex flex-wrap items-center gap-2"
          >
            {COLORS.map((c, idx) => (
              <label
                key={c.value}
                className="relative cursor-pointer"
                title={c.value}
              >
                <input
                  type="radio"
                  name="color"
                  value={c.value}
                  defaultChecked={idx === 0}
                  className="peer sr-only"
                />
                <span
                  className="block h-6 w-6 rounded-full ring-2 ring-transparent ring-offset-2 ring-offset-[hsl(var(--surface))] peer-checked:ring-[hsl(var(--foreground))]"
                  style={{ backgroundColor: c.hex }}
                />
              </label>
            ))}
          </div>
        </div>

        <div className="mt-2 flex items-center gap-2">
          <button
            type="submit"
            className="rounded-md bg-[hsl(var(--primary))] px-4 py-2 text-small font-medium text-[hsl(var(--primary-foreground))] transition-hover hover:opacity-90"
          >
            {t("submit")}
          </button>
          <Link
            href="/app/classes"
            className="rounded-md border border-[hsl(var(--border))] px-4 py-2 text-small text-[hsl(var(--muted-foreground))] transition-hover hover:text-[hsl(var(--foreground))]"
          >
            {t("cancel")}
          </Link>
        </div>
      </form>
    </div>
  );
}

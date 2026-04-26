import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requestAccessAction } from "./actions";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ error?: string }>;

export default async function RequestAccessPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const t = await getTranslations();
  const { error } = await searchParams;

  let errorMessage: string | null = null;
  if (error === "invalid_email") {
    errorMessage = t("request_access.error_invalid_email");
  } else if (error === "rate_limited") {
    errorMessage = t("request_access.error_rate_limited");
  }

  return (
    <div className="min-h-screen bg-[hsl(var(--background))] text-[hsl(var(--foreground))]">
      <nav className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <Link href="/" className="text-[15px] font-semibold tracking-tight">
          Steadii
        </Link>
        <Link
          href="/login"
          className="text-small text-[hsl(var(--muted-foreground))] transition-hover hover:text-[hsl(var(--foreground))]"
        >
          {t("landing.cta_already_approved")}
        </Link>
      </nav>

      <main className="mx-auto max-w-lg px-6 pt-8 pb-16">
        <p className="font-mono text-[11px] uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
          {t("landing.alpha")}
        </p>
        <h1 className="mt-4 font-display text-[32px] leading-tight tracking-tight md:text-[40px]">
          {t("request_access.title")}
        </h1>
        <p className="mt-3 text-body text-[hsl(var(--muted-foreground))]">
          {t("request_access.subtitle")}
        </p>

        {errorMessage ? (
          <div
            role="alert"
            className="mt-6 rounded-md border border-[hsl(var(--destructive))] bg-[hsl(var(--destructive)/0.08)] px-3 py-2 text-small text-[hsl(var(--destructive))]"
          >
            {errorMessage}
          </div>
        ) : null}

        <form action={requestAccessAction} className="mt-8 flex flex-col gap-5">
          <Field
            name="email"
            type="email"
            label={t("request_access.email_label")}
            required
            autoComplete="email"
          />
          <Field
            name="name"
            type="text"
            label={t("request_access.name_label")}
            autoComplete="name"
          />
          <Field
            name="university"
            type="text"
            label={t("request_access.university_label")}
            autoComplete="organization"
          />
          <TextareaField
            name="reason"
            label={t("request_access.reason_label")}
            placeholder={t("request_access.reason_placeholder")}
          />

          <button
            type="submit"
            className="mt-2 inline-flex h-10 items-center justify-center rounded-md bg-[hsl(var(--primary))] px-4 text-body font-medium text-[hsl(var(--primary-foreground))] transition-hover hover:opacity-90"
          >
            {t("request_access.submit")}
          </button>
        </form>

        <p className="mt-8 text-small text-[hsl(var(--muted-foreground))]">
          <Link
            href="/"
            className="transition-hover hover:text-[hsl(var(--foreground))]"
          >
            {t("request_access.back_to_landing")}
          </Link>
        </p>
      </main>
    </div>
  );
}

function Field({
  name,
  type,
  label,
  required,
  autoComplete,
}: {
  name: string;
  type: "email" | "text";
  label: string;
  required?: boolean;
  autoComplete?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-small">
      <span className="text-[hsl(var(--muted-foreground))]">{label}</span>
      <input
        name={name}
        type={type}
        required={required}
        autoComplete={autoComplete}
        maxLength={320}
        className="h-10 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 text-body text-[hsl(var(--foreground))] outline-none transition focus:border-[hsl(var(--primary))]"
      />
    </label>
  );
}

function TextareaField({
  name,
  label,
  placeholder,
}: {
  name: string;
  label: string;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-small">
      <span className="text-[hsl(var(--muted-foreground))]">{label}</span>
      <textarea
        name={name}
        rows={4}
        maxLength={1000}
        placeholder={placeholder}
        className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-2 text-body text-[hsl(var(--foreground))] outline-none transition focus:border-[hsl(var(--primary))]"
      />
    </label>
  );
}

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
    <div className="min-h-screen">
      <nav className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <Link href="/" className="text-[17px] font-semibold tracking-tight text-[#1A1814]">
          Steadii
        </Link>
        <Link
          href="/login"
          className="text-small text-[#1A1814]/70 transition-hover hover:text-[#8579A8]"
        >
          {t("landing.cta_already_approved")}
        </Link>
      </nav>

      <main className="mx-auto max-w-lg px-6 pt-8 pb-16">
        <p className="font-mono text-[11px] uppercase tracking-widest text-[#8579A8]">
          {t("landing.alpha")}
        </p>
        <h1 className="mt-4 text-[32px] font-semibold leading-[1.1] tracking-[-0.02em] text-[#1A1814] md:text-[44px]">
          {t("request_access.title")}
        </h1>
        <p className="mt-4 text-[17px] leading-[1.55] text-[#1A1814]/70 md:text-[18px]">
          {t("request_access.subtitle")}
        </p>

        {errorMessage ? (
          <div
            role="alert"
            className="mt-6 rounded-[8px] border border-red-300 bg-red-50 px-3 py-2 text-small text-red-700"
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
            className="mt-2 inline-flex h-11 items-center justify-center rounded-full bg-[#0A0A0A] px-6 text-[15px] font-medium text-white shadow-[0_8px_24px_rgba(0,0,0,0.18)] transition-hover hover:scale-[1.02]"
          >
            {t("request_access.submit")}
          </button>
        </form>

        <p className="mt-8 text-small text-[#1A1814]/60">
          <Link
            href="/"
            className="transition-hover hover:text-[#8579A8]"
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
      <span className="text-[#1A1814]/65">{label}</span>
      <input
        name={name}
        type={type}
        required={required}
        autoComplete={autoComplete}
        maxLength={320}
        className="h-11 rounded-[8px] border border-black/[0.10] bg-white px-3 text-[15px] text-[#1A1814] outline-none transition focus:border-[#8579A8] focus:ring-2 focus:ring-[#8579A8]/20"
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
      <span className="text-[#1A1814]/65">{label}</span>
      <textarea
        name={name}
        rows={4}
        maxLength={1000}
        placeholder={placeholder}
        className="rounded-[8px] border border-black/[0.10] bg-white px-3 py-2 text-[15px] text-[#1A1814] outline-none transition focus:border-[#8579A8] focus:ring-2 focus:ring-[#8579A8]/20"
      />
    </label>
  );
}

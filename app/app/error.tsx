"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { useTranslations } from "next-intl";
import { Button, LinkButton } from "@/components/ui/button";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("error_page");
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <p className="font-mono text-[11px] uppercase tracking-widest text-[hsl(var(--destructive))]">
        {t("badge")}
      </p>
      <h1 className="mt-4 text-h1 text-[hsl(var(--foreground))]">
        {t("heading")}
      </h1>
      <p className="mt-3 text-small text-[hsl(var(--muted-foreground))]">
        {t("body_with_id")}{" "}
        <span className="font-mono">{error.digest ?? t("fallback_id")}</span>.
      </p>
      <div className="mt-6 flex gap-2">
        <Button onClick={() => reset()}>{t("retry")}</Button>
        <LinkButton href="/app" variant="secondary">
          {t("back_home")}
        </LinkButton>
      </div>
    </div>
  );
}

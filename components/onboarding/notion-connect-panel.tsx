"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils/cn";

export function NotionConnectPanel({ connected }: { connected: boolean }) {
  const t = useTranslations("notion_connect_panel");
  const [ackd, setAckd] = useState(false);

  if (connected) {
    return (
      <p className="text-small text-[hsl(var(--muted-foreground))]">{t("connected")}</p>
    );
  }

  if (!ackd) {
    return (
      <div className="space-y-3 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] p-4 text-left">
        <h3 className="text-h3 text-[hsl(var(--foreground))]">
          {t("one_thing_first")}
        </h3>
        <p className="text-small text-[hsl(var(--muted-foreground))]">
          {t("permission_screen_prefix")}{" "}
          <span className="font-semibold text-[hsl(var(--foreground))]">
            {t("permission_screen_quoted")}
          </span>
          {t("permission_screen_suffix")}
        </p>
        <ul className="ml-5 list-disc space-y-1 text-small text-[hsl(var(--muted-foreground))]">
          <li>{t("bullet_only_steadii")}</li>
          <li>
            {t("bullet_single_page")}
          </li>
        </ul>
        <button
          type="button"
          onClick={() => setAckd(true)}
          className={cn(
            "inline-flex items-center rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-1.5 text-small font-medium text-[hsl(var(--foreground))] transition-hover hover:bg-[hsl(var(--surface-raised))]"
          )}
        >
          {t("got_it")}
        </button>
      </div>
    );
  }

  return (
    <a
      href="/api/integrations/notion/connect"
      className="inline-flex items-center justify-center rounded-md bg-[hsl(var(--primary))] px-3.5 py-2 text-body font-medium text-[hsl(var(--primary-foreground))] transition-hover hover:opacity-90"
    >
      {t("connect_notion")}
    </a>
  );
}

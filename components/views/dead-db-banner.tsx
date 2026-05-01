import { AlertTriangle } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { repairSetupAction } from "@/app/(auth)/onboarding/actions";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkButton } from "@/components/ui/button";

export async function DeadDbBanner({
  title,
  reason,
}: {
  title: string;
  reason: "not_connected" | "not_set_up" | "deleted";
}) {
  const t = await getTranslations("views.dead_db_banner");
  const messages: Record<typeof reason, string> = {
    not_connected: t("message_not_connected"),
    not_set_up: t("message_not_set_up"),
    deleted: t("message_deleted"),
  };

  const heading =
    reason === "not_connected"
      ? t("heading_not_connected")
      : reason === "not_set_up"
      ? t("heading_not_set_up")
      : t("heading_deleted");

  return (
    <div className="mx-auto max-w-3xl py-6">
      <h1 className="text-h1 text-[hsl(var(--foreground))]">{title}</h1>
      <div className="mt-6">
        <EmptyState
          tone="warn"
          icon={<AlertTriangle size={18} strokeWidth={1.5} />}
          title={heading}
          description={
            <>
              {messages[reason]}
              <div className="mt-1 text-[hsl(var(--muted-foreground))]">
                {t("data_safe")}
              </div>
            </>
          }
        />
        <div className="mt-3 flex justify-center">
          {reason === "not_connected" ? (
            <LinkButton href="/app/settings">{t("reconnect_notion")}</LinkButton>
          ) : (
            <form action={repairSetupAction}>
              <button
                type="submit"
                className="inline-flex items-center justify-center rounded-md bg-[hsl(var(--primary))] px-3.5 py-2 text-body font-medium text-[hsl(var(--primary-foreground))] transition-hover hover:opacity-90"
              >
                {t("resetup_notion")}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

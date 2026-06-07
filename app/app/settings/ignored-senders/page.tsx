import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth/config";
import { listIgnoredSenders } from "@/lib/agent/email/ignored-senders";
import { SubmitButton } from "@/components/ui/submit-button";
import type {
  AgentIgnoredSender,
  IgnoredSenderSource,
} from "@/lib/db/schema";
import { removeIgnoredSenderAction } from "./actions";

// 今後この送信者を無視 — reversibility surface for the per-user sender
// ignore list. Minimal: list + remove ("解除"). Mirrors the agent-tuning
// page's table + form-action layout. No search / pagination at α scope.

export const dynamic = "force-dynamic";

export default async function IgnoredSendersPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;
  const t = await getTranslations("settings.ignored_senders");

  const rows = await listIgnoredSenders(userId);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Link
        href="/app/settings"
        className="mb-4 inline-flex items-center gap-1 text-[12px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
      >
        <ChevronLeft size={12} /> {t("back")}
      </Link>

      <h1 className="mb-2 font-display text-[hsl(var(--foreground))]">
        {t("page_title")}
      </h1>
      <p className="mb-6 text-small text-[hsl(var(--muted-foreground))]">
        {t("page_description")}
      </p>

      <section className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4">
        {rows.length === 0 ? (
          <p className="text-small text-[hsl(var(--muted-foreground))]">
            {t("empty")}
          </p>
        ) : (
          <IgnoredSenderTable rows={rows} t={t} />
        )}
      </section>
    </div>
  );
}

function IgnoredSenderTable({
  rows,
  t,
}: {
  rows: AgentIgnoredSender[];
  t: (key: string) => string;
}) {
  const sourceLabel = (source: IgnoredSenderSource): string => {
    switch (source) {
      case "dismiss_followup":
        return t("source_dismiss_followup");
      case "quick_menu":
        return t("source_quick_menu");
      case "manual":
        return t("source_manual");
      default:
        return source;
    }
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead className="text-left text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
          <tr>
            <th className="py-1 pr-2 font-normal">{t("column_sender")}</th>
            <th className="py-1 pr-2 font-normal">{t("column_source")}</th>
            <th className="py-1 pr-2 font-normal">{t("column_added")}</th>
            <th className="py-1 pr-0 text-right font-normal">
              <span className="sr-only">{t("remove_button")}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const added =
              r.createdAt instanceof Date
                ? r.createdAt.toISOString().slice(0, 10)
                : "";
            return (
              <tr
                key={r.id}
                className="border-t border-[hsl(var(--border))] align-middle"
              >
                <td className="py-2 pr-2 text-[hsl(var(--foreground))]">
                  {r.senderEmail}
                </td>
                <td className="py-2 pr-2 text-[hsl(var(--muted-foreground))]">
                  {sourceLabel(r.source)}
                </td>
                <td className="py-2 pr-2 tabular-nums text-[hsl(var(--muted-foreground))]">
                  {added}
                </td>
                <td className="py-2 pr-0 text-right">
                  <form action={removeIgnoredSenderAction} className="inline-block">
                    <input
                      type="hidden"
                      name="sender_email"
                      value={r.senderEmail}
                    />
                    <SubmitButton
                      pendingLabel={t("remove_pending")}
                      className="inline-flex h-8 items-center rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-2.5 text-[11px] font-medium transition-hover hover:bg-[hsl(var(--surface-raised))]"
                    >
                      {t("remove_button")}
                    </SubmitButton>
                  </form>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

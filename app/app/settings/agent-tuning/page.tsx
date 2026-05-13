import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth/config";
import {
  getMonthlySummary,
  listSenderConfidenceByState,
  listPendingLearningRows,
} from "@/lib/agent/learning/sender-confidence";
import { SubmitButton } from "@/components/ui/submit-button";
import type { SenderConfidenceRow } from "@/lib/db/schema";
import {
  revokePromotionAction,
  forgiveSenderAction,
  resetAllSenderConfidenceAction,
} from "./actions";
import { ResetAllForm } from "./reset-all-form";

// engineer-49 — Trust-tuning page. Surfaces the three states of the
// sender_confidence state machine (auto_send / always_review /
// pending baseline) so the user can see + correct what the agent has
// learned about each sender. Read of the monthly summary block at the
// top is the same shape the proactive monthly-boundary-review card
// summarized; this page IS the detail view that card links to.

export const dynamic = "force-dynamic";

export default async function AgentTuningPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;
  const t = await getTranslations("agent_tuning_page");

  const [summary, autoSendRows, alwaysReviewRows, pendingRows] =
    await Promise.all([
      getMonthlySummary({ userId }),
      listSenderConfidenceByState({ userId, state: "auto_send" }),
      listSenderConfidenceByState({ userId, state: "always_review" }),
      listPendingLearningRows(userId),
    ]);

  const hasAny =
    autoSendRows.length > 0 ||
    alwaysReviewRows.length > 0 ||
    pendingRows.length > 0;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Link
        href="/app/settings"
        className="mb-4 inline-flex items-center gap-1 text-[12px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
      >
        <ChevronLeft size={12} /> {t("settings_back")}
      </Link>

      <h1 className="mb-2 font-display text-[hsl(var(--foreground))]">
        {t("title")}
      </h1>
      <p className="mb-6 text-small text-[hsl(var(--muted-foreground))]">
        {t("description")}
      </p>

      <Section heading={t("monthly_summary_heading")}>
        <div className="flex flex-wrap gap-2">
          <Pill>{t("monthly_approved", { n: summary.approvedThisMonth })}</Pill>
          <Pill>{t("monthly_dismissed", { n: summary.dismissedThisMonth })}</Pill>
          <Pill>{t("monthly_rejected", { n: summary.rejectedThisMonth })}</Pill>
        </div>
      </Section>

      <Section
        heading={t("auto_send_heading")}
        description={t("auto_send_description")}
      >
        {autoSendRows.length === 0 ? (
          <Empty>{t("auto_send_empty")}</Empty>
        ) : (
          <SenderTable
            rows={autoSendRows}
            actionType="revoke"
            actionLabel={t("revoke_button")}
            actionPending={t("revoke_pending")}
            actionFn={revokePromotionAction}
            t={t}
          />
        )}
      </Section>

      <Section
        heading={t("always_review_heading")}
        description={t("always_review_description")}
      >
        {alwaysReviewRows.length === 0 ? (
          <Empty>{t("always_review_empty")}</Empty>
        ) : (
          <SenderTable
            rows={alwaysReviewRows}
            actionType="forgive"
            actionLabel={t("forgive_button")}
            actionPending={t("forgive_pending")}
            actionFn={forgiveSenderAction}
            t={t}
          />
        )}
      </Section>

      <Section
        heading={t("pending_heading")}
        description={t("pending_description")}
      >
        {pendingRows.length === 0 ? (
          <Empty>{t("pending_empty")}</Empty>
        ) : (
          <SenderTable
            rows={pendingRows}
            actionType={null}
            actionLabel=""
            actionPending=""
            actionFn={null}
            t={t}
          />
        )}
      </Section>

      <Section
        heading={t("reset_all_heading")}
        description={t("reset_all_description")}
      >
        <ResetAllForm
          buttonLabel={t("reset_all_button")}
          pendingLabel={t("reset_all_pending")}
          confirmText={t("reset_all_confirm")}
          action={resetAllSenderConfidenceAction}
        />
      </Section>

      {!hasAny ? (
        <div className="mt-8 rounded-lg border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-6 text-center">
          <h3 className="mb-1 text-small font-medium text-[hsl(var(--foreground))]">
            {t("empty_state_title")}
          </h3>
          <p className="text-small text-[hsl(var(--muted-foreground))]">
            {t("empty_state_body")}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function Section({
  heading,
  description,
  children,
}: {
  heading: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4">
      <h2 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
        {heading}
      </h2>
      {description ? (
        <p className="mb-3 text-small text-[hsl(var(--muted-foreground))]">
          {description}
        </p>
      ) : null}
      {children}
    </section>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[hsl(var(--surface-raised))] px-2.5 py-1 text-[12px] text-[hsl(var(--foreground))]">
      {children}
    </span>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-small text-[hsl(var(--muted-foreground))]">{children}</p>
  );
}

function SenderTable({
  rows,
  actionType,
  actionLabel,
  actionPending,
  actionFn,
  t,
}: {
  rows: SenderConfidenceRow[];
  actionType: "revoke" | "forgive" | null;
  actionLabel: string;
  actionPending: string;
  actionFn: ((formData: FormData) => Promise<void>) | null;
  t: (key: string) => string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead className="text-left text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
          <tr>
            <th className="py-1 pr-2 font-normal">{t("column_sender")}</th>
            <th className="py-1 pr-2 font-normal">{t("column_action")}</th>
            <th className="py-1 pr-2 font-normal">{t("column_confidence")}</th>
            <th className="py-1 pr-2 font-normal">{t("column_samples")}</th>
            <th className="py-1 pr-2 font-normal">{t("column_last_event")}</th>
            <th className="py-1 pr-0 font-normal text-right">
              <span className="sr-only">{t("column_actions")}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const samples =
              r.approvedCount +
              r.editedCount +
              r.dismissedCount +
              r.rejectedCount;
            const lastEvent =
              r.updatedAt instanceof Date
                ? r.updatedAt.toISOString().slice(0, 10)
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
                  {r.actionType}
                </td>
                <td className="py-2 pr-2 tabular-nums text-[hsl(var(--muted-foreground))]">
                  {r.learnedConfidence.toFixed(2)}
                </td>
                <td className="py-2 pr-2 tabular-nums text-[hsl(var(--muted-foreground))]">
                  {samples}
                </td>
                <td className="py-2 pr-2 tabular-nums text-[hsl(var(--muted-foreground))]">
                  {lastEvent}
                </td>
                <td className="py-2 pr-0 text-right">
                  {actionType && actionFn ? (
                    <form action={actionFn} className="inline-block">
                      <input
                        type="hidden"
                        name="sender_email"
                        value={r.senderEmail}
                      />
                      <input
                        type="hidden"
                        name="action_type"
                        value={r.actionType}
                      />
                      <SubmitButton
                        pendingLabel={actionPending}
                        className="inline-flex h-8 items-center rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-2.5 text-[11px] font-medium transition-hover hover:bg-[hsl(var(--surface-raised))]"
                      >
                        {actionLabel}
                      </SubmitButton>
                    </form>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

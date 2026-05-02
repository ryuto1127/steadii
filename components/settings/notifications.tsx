"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { saveNotificationSettingsAction } from "@/app/app/settings/notification-actions";
import {
  type NotificationChannel,
  type NotificationTierPrefs,
} from "@/lib/notifications/tier-matrix";
import type { QueueArchetype } from "@/lib/agent/queue/types";

type Props = {
  initial: {
    digestEnabled: boolean;
    digestHourLocal: number;
    undoWindowSeconds: number;
    highRiskNotifyImmediate: boolean;
    notificationTiers: NotificationTierPrefs;
  };
};

const TIER_ORDER: QueueArchetype[] = ["A", "B", "C", "D", "E"];
const CHANNEL_OPTIONS: NotificationChannel[] = ["push", "digest", "in_app"];

export function NotificationSettings({ initial }: Props) {
  const router = useRouter();
  const t = useTranslations("notifications");
  const [digestEnabled, setDigestEnabled] = useState(initial.digestEnabled);
  const [digestHourLocal, setDigestHourLocal] = useState(initial.digestHourLocal);
  const [undoWindowSeconds, setUndoWindowSeconds] = useState(initial.undoWindowSeconds);
  const [highRiskNotifyImmediate, setHighRiskNotifyImmediate] = useState(
    initial.highRiskNotifyImmediate
  );
  const [tiers, setTiers] = useState<NotificationTierPrefs>(
    initial.notificationTiers
  );
  const [isPending, startTransition] = useTransition();

  const onSave = () => {
    startTransition(async () => {
      try {
        await saveNotificationSettingsAction({
          digestEnabled,
          digestHourLocal,
          undoWindowSeconds,
          highRiskNotifyImmediate,
          notificationTiers: tiers,
        });
        toast.success(t("saved_toast"));
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("save_failed"));
      }
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <Row
        label={t("morning_digest_label")}
        hint={t("morning_digest_hint")}
      >
        <label className="inline-flex items-center gap-2 text-small">
          <input
            type="checkbox"
            checked={digestEnabled}
            onChange={(e) => setDigestEnabled(e.target.checked)}
            className="h-4 w-4"
          />
          <span>{t("enabled")}</span>
        </label>
      </Row>

      <Row
        label={t("digest_hour_label")}
        hint={t("digest_hour_hint")}
      >
        <input
          type="range"
          min={0}
          max={23}
          value={digestHourLocal}
          onChange={(e) => setDigestHourLocal(Number(e.target.value))}
          className="h-9 w-32 max-w-full"
        />
        <span className="ml-3 inline-block min-w-[60px] text-right font-mono text-small tabular-nums">
          {digestHourLocal.toString().padStart(2, "0")}:00
        </span>
      </Row>

      <Row
        label={t("undo_window_label")}
        hint={t("undo_window_hint")}
      >
        <input
          type="range"
          min={10}
          max={60}
          step={5}
          value={undoWindowSeconds}
          onChange={(e) => setUndoWindowSeconds(Number(e.target.value))}
          className="h-9 w-32 max-w-full"
        />
        <span className="ml-3 inline-block min-w-[60px] text-right font-mono text-small tabular-nums">
          {undoWindowSeconds}s
        </span>
      </Row>

      <Row
        label={t("high_risk_push_label")}
        hint={t("high_risk_push_hint")}
      >
        <label className="inline-flex items-center gap-2 text-small">
          <input
            type="checkbox"
            checked={highRiskNotifyImmediate}
            onChange={(e) => setHighRiskNotifyImmediate(e.target.checked)}
            className="h-4 w-4"
          />
          <span>{t("notify_immediately")}</span>
        </label>
      </Row>

      <section className="flex flex-col gap-3 border-t border-[hsl(var(--border))] pt-4">
        <header>
          <h3 className="text-body font-semibold text-[hsl(var(--foreground))]">
            {t("tier_matrix_heading")}
          </h3>
          <p className="text-small text-[hsl(var(--muted-foreground))]">
            {t("tier_matrix_caption")}
          </p>
        </header>
        <div className="flex flex-col gap-2">
          {TIER_ORDER.map((arch) => (
            <TierRow
              key={arch}
              archetype={arch}
              value={tiers[arch]}
              onChange={(next) =>
                setTiers((prev) => ({ ...prev, [arch]: next }))
              }
              label={t(`tier_${arch.toLowerCase()}_label`)}
              hint={t(`tier_${arch.toLowerCase()}_hint`)}
              channelLabels={{
                push: t("channel_push"),
                digest: t("channel_digest"),
                in_app: t("channel_in_app"),
              }}
            />
          ))}
        </div>
      </section>

      <div>
        <button
          type="button"
          onClick={onSave}
          disabled={isPending}
          className="inline-flex h-9 items-center rounded-md bg-[hsl(var(--primary))] px-4 text-small font-medium text-[hsl(var(--primary-foreground))] transition-hover hover:opacity-90 disabled:opacity-50"
        >
          {t("save")}
        </button>
      </div>
    </div>
  );
}

function TierRow({
  archetype,
  value,
  onChange,
  label,
  hint,
  channelLabels,
}: {
  archetype: QueueArchetype;
  value: NotificationChannel;
  onChange: (next: NotificationChannel) => void;
  label: string;
  hint: string;
  channelLabels: Record<NotificationChannel, string>;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
          {archetype}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-small font-medium text-[hsl(var(--foreground))]">
            {label}
          </div>
          <div className="text-[12px] text-[hsl(var(--muted-foreground))]">
            {hint}
          </div>
        </div>
      </div>
      <div
        role="radiogroup"
        aria-label={label}
        className="flex shrink-0 items-center gap-1 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] p-0.5 text-[11px]"
      >
        {CHANNEL_OPTIONS.map((opt) => (
          <button
            key={opt}
            type="button"
            role="radio"
            aria-checked={value === opt}
            onClick={() => onChange(opt)}
            data-tier-row={archetype}
            data-channel={opt}
            className={
              value === opt
                ? "rounded-full bg-[hsl(var(--foreground))] px-2.5 py-1 font-medium text-[hsl(var(--surface))]"
                : "rounded-full px-2.5 py-1 text-[hsl(var(--muted-foreground))] transition-hover hover:text-[hsl(var(--foreground))]"
            }
          >
            {channelLabels[opt]}
          </button>
        ))}
      </div>
    </div>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-[hsl(var(--border))] pb-4 last:border-b-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="min-w-0 flex-1">
        <div className="text-body font-medium text-[hsl(var(--foreground))]">
          {label}
        </div>
        <div className="text-small text-[hsl(var(--muted-foreground))]">
          {hint}
        </div>
      </div>
      <div className="flex shrink-0 items-center">{children}</div>
    </div>
  );
}

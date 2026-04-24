"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { saveNotificationSettingsAction } from "@/app/app/settings/notification-actions";

type Props = {
  initial: {
    digestEnabled: boolean;
    digestHourLocal: number;
    undoWindowSeconds: number;
    highRiskNotifyImmediate: boolean;
  };
};

export function NotificationSettings({ initial }: Props) {
  const router = useRouter();
  const [digestEnabled, setDigestEnabled] = useState(initial.digestEnabled);
  const [digestHourLocal, setDigestHourLocal] = useState(initial.digestHourLocal);
  const [undoWindowSeconds, setUndoWindowSeconds] = useState(initial.undoWindowSeconds);
  const [highRiskNotifyImmediate, setHighRiskNotifyImmediate] = useState(
    initial.highRiskNotifyImmediate
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
        });
        toast.success("Notification settings saved");
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <Row
        label="Morning digest"
        hint="One summary email per day with pending drafts. No body previews — you confirm in Steadii."
      >
        <label className="inline-flex items-center gap-2 text-small">
          <input
            type="checkbox"
            checked={digestEnabled}
            onChange={(e) => setDigestEnabled(e.target.checked)}
            className="h-4 w-4"
          />
          <span>Enabled</span>
        </label>
      </Row>

      <Row
        label="Digest hour (local)"
        hint="What time in your timezone to send the digest. Memory-locked default is 7am."
      >
        <input
          type="range"
          min={0}
          max={23}
          value={digestHourLocal}
          onChange={(e) => setDigestHourLocal(Number(e.target.value))}
          className="w-32"
        />
        <span className="ml-3 inline-block min-w-[60px] text-right font-mono text-small tabular-nums">
          {digestHourLocal.toString().padStart(2, "0")}:00
        </span>
      </Row>

      <Row
        label="Undo window"
        hint="Seconds between Send and actual Gmail delivery. 10 feels fast; 60 is forgiving."
      >
        <input
          type="range"
          min={10}
          max={60}
          step={5}
          value={undoWindowSeconds}
          onChange={(e) => setUndoWindowSeconds(Number(e.target.value))}
          className="w-32"
        />
        <span className="ml-3 inline-block min-w-[60px] text-right font-mono text-small tabular-nums">
          {undoWindowSeconds}s
        </span>
      </Row>

      <Row
        label="High-risk push"
        hint="Immediate notification when a high-risk draft lands. Pushes arrive once mobile ships — toggle is saved for later."
      >
        <label className="inline-flex items-center gap-2 text-small">
          <input
            type="checkbox"
            checked={highRiskNotifyImmediate}
            onChange={(e) => setHighRiskNotifyImmediate(e.target.checked)}
            className="h-4 w-4"
          />
          <span>Notify me immediately</span>
        </label>
      </Row>

      <div>
        <button
          type="button"
          onClick={onSave}
          disabled={isPending}
          className="inline-flex items-center rounded-md bg-[hsl(var(--primary))] px-3 py-1.5 text-small font-medium text-[hsl(var(--primary-foreground))] transition-hover hover:opacity-90 disabled:opacity-50"
        >
          Save
        </button>
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
    <div className="flex items-start justify-between gap-4 border-b border-[hsl(var(--border))] pb-4 last:border-b-0 last:pb-0">
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

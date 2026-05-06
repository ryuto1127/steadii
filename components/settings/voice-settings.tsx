"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils/cn";

type TriggerKey = "caps_lock" | "alt_right" | "meta_right";

export function VoiceSettings({
  initial,
  labels,
}: {
  initial: TriggerKey;
  labels: {
    description: string;
    trigger_label: string;
    trigger_caps: string;
    trigger_alt: string;
    trigger_meta: string;
    saved: string;
  };
}) {
  const [value, setValue] = useState<TriggerKey>(initial);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const apply = (next: TriggerKey) => {
    if (next === value) return;
    const previous = value;
    setValue(next);
    startTransition(async () => {
      const res = await fetch("/api/settings/voice-trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ triggerKey: next }),
      });
      if (res.ok) {
        // The Caps-Lock-fallback flag in localStorage is for auto-detection
        // of broken hold events. When the user picks a key explicitly here,
        // that override should win — clear the fallback so subsequent loads
        // honor the new choice.
        try {
          if (typeof window !== "undefined") {
            window.localStorage.removeItem("steadii.voice.fallback_alt_right");
          }
        } catch {
          // ignore
        }
        toast.success(labels.saved);
        router.refresh();
      } else {
        setValue(previous);
      }
    });
  };

  return (
    <div className="space-y-3">
      <p className="text-small text-[hsl(var(--muted-foreground))]">
        {labels.description}
      </p>
      <div
        role="radiogroup"
        aria-label={labels.trigger_label}
        className="flex flex-col gap-2"
      >
        <Option
          checked={value === "caps_lock"}
          disabled={isPending}
          label={labels.trigger_caps}
          onSelect={() => apply("caps_lock")}
        />
        <Option
          checked={value === "alt_right"}
          disabled={isPending}
          label={labels.trigger_alt}
          onSelect={() => apply("alt_right")}
        />
        <Option
          checked={value === "meta_right"}
          disabled={isPending}
          label={labels.trigger_meta}
          onSelect={() => apply("meta_right")}
        />
      </div>
    </div>
  );
}

function Option({
  checked,
  disabled,
  label,
  onSelect,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onSelect: () => void;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 transition-hover",
        checked
          ? "border-[hsl(var(--ring))] bg-[hsl(var(--surface-raised))]"
          : "border-[hsl(var(--border))] hover:bg-[hsl(var(--surface-raised))]"
      )}
    >
      <input
        type="radio"
        name="voice-trigger"
        checked={checked}
        onChange={onSelect}
        disabled={disabled}
        className="h-4 w-4"
      />
      <span className="text-body">{label}</span>
    </label>
  );
}

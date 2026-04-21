"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

const COMMON_ZONES = [
  "America/Vancouver",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Toronto",
  "America/Mexico_City",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Rome",
  "Europe/Amsterdam",
  "Europe/Moscow",
  "Africa/Cairo",
  "Africa/Johannesburg",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Bangkok",
  "Asia/Singapore",
  "Asia/Hong_Kong",
  "Asia/Shanghai",
  "Asia/Taipei",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Australia/Sydney",
  "Pacific/Auckland",
  "UTC",
];

export function TimezoneInput({
  initial,
  labels,
}: {
  initial: string | null;
  labels: { placeholder: string; save: string; detected: string; saved: string; invalid: string };
}) {
  const [value, setValue] = useState(initial ?? "");
  const [detected, setDetected] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "saved" | "invalid">("idle");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    try {
      setDetected(Intl.DateTimeFormat().resolvedOptions().timeZone || null);
    } catch {
      setDetected(null);
    }
  }, []);

  const options = useMemo(() => {
    const set = new Set(COMMON_ZONES);
    if (detected) set.add(detected);
    if (initial) set.add(initial);
    return Array.from(set).sort();
  }, [detected, initial]);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const tz = value.trim();
    if (!tz) return;
    setStatus("idle");
    startTransition(async () => {
      const res = await fetch("/api/user/timezone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timezone: tz, source: "manual" }),
      });
      if (res.ok) {
        setStatus("saved");
        router.refresh();
      } else {
        setStatus("invalid");
      }
    });
  };

  const useDetected = () => {
    if (!detected) return;
    setValue(detected);
    setStatus("idle");
  };

  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-2">
      <div className="flex items-center gap-2">
        <input
          list="steadii-tz-options"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setStatus("idle");
          }}
          placeholder={labels.placeholder}
          spellCheck={false}
          autoComplete="off"
          className="flex-1 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-1.5 font-mono text-small focus:outline-none focus:border-[hsl(var(--ring))]"
        />
        <datalist id="steadii-tz-options">
          {options.map((z) => (
            <option key={z} value={z} />
          ))}
        </datalist>
        <button
          type="submit"
          disabled={isPending || value.trim().length === 0}
          className="inline-flex items-center rounded-md bg-[hsl(var(--primary))] px-3 py-1.5 text-small font-medium text-[hsl(var(--primary-foreground))] transition-hover hover:opacity-90 disabled:opacity-60"
        >
          {labels.save}
        </button>
      </div>
      <div className="flex items-center justify-between text-[11px] text-[hsl(var(--muted-foreground))]">
        <span>
          {detected && detected !== value ? (
            <button
              type="button"
              onClick={useDetected}
              className="font-mono underline-offset-2 hover:underline"
            >
              {labels.detected}: {detected}
            </button>
          ) : detected ? (
            <span className="font-mono">{labels.detected}: {detected}</span>
          ) : null}
        </span>
        <span
          className={
            status === "invalid"
              ? "text-[hsl(var(--destructive))]"
              : status === "saved"
              ? "text-[hsl(var(--primary))]"
              : ""
          }
        >
          {status === "saved" ? labels.saved : status === "invalid" ? labels.invalid : ""}
        </span>
      </div>
    </form>
  );
}

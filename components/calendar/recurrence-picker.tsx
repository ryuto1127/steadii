"use client";

import { WEEKDAYS, type RecurrenceKind, type Weekday } from "@/lib/calendar/events";

type Props = {
  value: RecurrenceKind;
  onChange: (v: RecurrenceKind) => void;
};

type Preset = "none" | "daily" | "weekly" | "monthly" | "custom";

function toPreset(v: RecurrenceKind): Preset | "advanced" {
  if (v.kind === "none") return "none";
  if (v.kind === "daily") return "daily";
  if (v.kind === "weekly") return "weekly";
  if (v.kind === "monthly") return "monthly";
  if (v.kind === "custom") return "custom";
  return "advanced";
}

export function RecurrencePicker({ value, onChange }: Props) {
  const preset = toPreset(value);
  const advanced = preset === "advanced";

  const handlePresetChange = (p: Preset) => {
    if (p === "none") onChange({ kind: "none" });
    else if (p === "daily") onChange({ kind: "daily" });
    else if (p === "weekly") onChange({ kind: "weekly" });
    else if (p === "monthly") onChange({ kind: "monthly" });
    else onChange({ kind: "custom", byDay: [], end: { kind: "never" } });
  };

  if (advanced && value.kind === "advanced") {
    return (
      <div className="space-y-1.5">
        <div className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-3 py-2">
          <div className="text-small text-[hsl(var(--foreground))]">Custom (advanced)</div>
          <div className="mt-1 break-all font-mono text-[11px] text-[hsl(var(--muted-foreground))]">
            {value.raw.join("\n")}
          </div>
        </div>
        <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
          Editing this rule isn&apos;t supported in the UI yet — other fields are
          still editable.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <select
        value={preset}
        onChange={(e) => handlePresetChange(e.target.value as Preset)}
        className="block w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-2 text-small text-[hsl(var(--foreground))] outline-none focus:border-[hsl(var(--primary))]"
      >
        <option value="none">Does not repeat</option>
        <option value="daily">Daily</option>
        <option value="weekly">Weekly</option>
        <option value="monthly">Monthly</option>
        <option value="custom">Custom weekly…</option>
      </select>

      {value.kind === "custom" && (
        <CustomEditor value={value} onChange={onChange} />
      )}
    </div>
  );
}

function CustomEditor({
  value,
  onChange,
}: {
  value: Extract<RecurrenceKind, { kind: "custom" }>;
  onChange: (v: RecurrenceKind) => void;
}) {
  const toggleDay = (d: Weekday) => {
    const next = value.byDay.includes(d)
      ? value.byDay.filter((x) => x !== d)
      : [...value.byDay, d];
    onChange({ ...value, byDay: next });
  };

  const setEndKind = (k: "never" | "until" | "count") => {
    if (k === "never") onChange({ ...value, end: { kind: "never" } });
    else if (k === "until")
      onChange({
        ...value,
        end: {
          kind: "until",
          date: value.end.kind === "until" ? value.end.date : defaultUntilDate(),
        },
      });
    else
      onChange({
        ...value,
        end: { kind: "count", count: value.end.kind === "count" ? value.end.count : 10 },
      });
  };

  return (
    <div className="space-y-2 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] p-2">
      <div className="flex flex-wrap gap-1">
        {WEEKDAYS.map((d) => {
          const on = value.byDay.includes(d);
          return (
            <button
              key={d}
              onClick={() => toggleDay(d)}
              className={
                "h-7 w-8 rounded text-[11px] font-medium transition-hover " +
                (on
                  ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                  : "border border-[hsl(var(--border))] bg-[hsl(var(--surface))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]")
              }
            >
              {d.slice(0, 2)}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-2 pt-1">
        <select
          value={value.end.kind}
          onChange={(e) => setEndKind(e.target.value as "never" | "until" | "count")}
          className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-2 py-1 text-[12px]"
        >
          <option value="never">No end</option>
          <option value="until">Ends on</option>
          <option value="count">Ends after</option>
        </select>
        {value.end.kind === "until" && (
          <input
            type="date"
            value={value.end.date}
            onChange={(e) =>
              onChange({ ...value, end: { kind: "until", date: e.target.value } })
            }
            className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-2 py-1 text-[12px]"
          />
        )}
        {value.end.kind === "count" && (
          <>
            <input
              type="number"
              min={1}
              max={999}
              value={value.end.count}
              onChange={(e) =>
                onChange({
                  ...value,
                  end: { kind: "count", count: Math.max(1, Number(e.target.value) || 1) },
                })
              }
              className="w-16 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-2 py-1 text-[12px]"
            />
            <span className="text-[12px] text-[hsl(var(--muted-foreground))]">
              occurrences
            </span>
          </>
        )}
      </div>
    </div>
  );
}

function defaultUntilDate(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 3);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

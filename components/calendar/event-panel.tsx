"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { RecurrencePicker } from "./recurrence-picker";
import {
  formatDateInput,
  formatDateTimeLocalInput,
  localDateTimeToRfc3339,
  parseEventStart,
  parseRecurrence,
  formatRecurrence,
  type CalendarEvent,
  type RecurrenceKind,
} from "@/lib/calendar/events";
import {
  type CalendarEventInput,
  type CalendarEventPatch,
} from "@/lib/agent/calendar-actions";

export type PanelState =
  | { state: "closed" }
  | { state: "edit"; event: CalendarEvent }
  | {
      state: "create";
      prefill: { start: string; end: string; allDay: boolean };
    };

type Props = {
  state: Exclude<PanelState, { state: "closed" }>;
  onClose: () => void;
  onCreate: (input: CalendarEventInput) => void | Promise<void>;
  onUpdate: (patch: CalendarEventPatch) => void | Promise<void>;
  onDelete: (eventId: string) => void | Promise<void>;
};

type FormState = {
  summary: string;
  allDay: boolean;
  start: string;
  end: string;
  location: string;
  description: string;
  recurrence: RecurrenceKind;
  reminderMinutes: number | null;
};

const DEFAULT_REMINDER = 10;

function shiftDays(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + delta);
  return formatDateInput(dt);
}

function initFromEvent(ev: CalendarEvent): FormState {
  return {
    summary: ev.summary,
    allDay: ev.allDay,
    start: ev.allDay
      ? ev.start
      : formatDateTimeLocalInput(parseEventStart({ start: ev.start, allDay: false })),
    end: ev.allDay
      ? shiftDays(ev.end, -1) // Google stores end-exclusive for all-day.
      : formatDateTimeLocalInput(new Date(ev.end)),
    location: ev.location ?? "",
    description: ev.description ?? "",
    recurrence: parseRecurrence(ev.recurrence),
    reminderMinutes: ev.reminders?.minutes ?? null,
  };
}

function initFromPrefill(prefill: {
  start: string;
  end: string;
  allDay: boolean;
}): FormState {
  return {
    summary: "",
    allDay: prefill.allDay,
    start: prefill.start,
    end: prefill.allDay ? shiftDays(prefill.end, -1) : prefill.end,
    location: "",
    description: "",
    recurrence: { kind: "none" },
    reminderMinutes: DEFAULT_REMINDER,
  };
}

export function EventPanel({
  state,
  onClose,
  onCreate,
  onUpdate,
  onDelete,
}: Props) {
  const editing = state.state === "edit";
  const isSeriesInstance =
    editing && Boolean(state.event.recurringEventId);
  const [form, setForm] = useState<FormState>(() =>
    editing ? initFromEvent(state.event) : initFromPrefill(state.prefill),
  );
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setForm(
      state.state === "edit"
        ? initFromEvent(state.event)
        : initFromPrefill(state.prefill),
    );
  }, [state]);

  const setField = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const toggleAllDay = (next: boolean) => {
    setForm((f) => {
      if (next === f.allDay) return f;
      if (next) {
        // datetime -> date
        const sDate = f.start.slice(0, 10);
        const eDate = f.end.slice(0, 10) || sDate;
        return { ...f, allDay: true, start: sDate, end: eDate };
      }
      // date -> datetime (default 09:00-10:00 on that day)
      const s = `${f.start}T09:00`;
      const eBase = f.end || f.start;
      const e = `${eBase}T10:00`;
      return { ...f, allDay: false, start: s, end: e };
    });
  };

  const handleSubmit = async () => {
    if (!form.summary.trim()) return;
    setSubmitting(true);
    try {
      const recurrence = formatRecurrence(form.recurrence);
      const reminders =
        form.reminderMinutes === null ? null : { minutes: form.reminderMinutes };
      const start = form.allDay ? form.start : localDateTimeToRfc3339(form.start);
      const end = form.allDay
        ? shiftDays(form.end, 1) // back to end-exclusive
        : localDateTimeToRfc3339(form.end);
      const base = {
        summary: form.summary.trim(),
        start,
        end,
        description: form.description || undefined,
        location: form.location || undefined,
        recurrence: recurrence.length > 0 ? recurrence : undefined,
        reminders,
      };
      if (state.state === "edit") {
        await onUpdate({ eventId: state.event.id, ...base });
      } else {
        await onCreate(base);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (state.state !== "edit") return;
    if (!confirm("Delete this event?")) return;
    setSubmitting(true);
    try {
      await onDelete(state.event.id);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <aside className="flex w-[360px] shrink-0 flex-col overflow-hidden rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))]">
      <header className="flex items-center justify-between border-b border-[hsl(var(--border))] px-4 py-3">
        <h2 className="text-h3">{editing ? "Edit event" : "New event"}</h2>
        <button
          onClick={onClose}
          aria-label="Close"
          className="h-7 w-7 rounded-md text-[hsl(var(--muted-foreground))] transition-hover hover:bg-[hsl(var(--surface-raised))] hover:text-[hsl(var(--foreground))]"
        >
          ×
        </button>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <Field label="Title">
          <input
            type="text"
            value={form.summary}
            onChange={(e) => setField("summary", e.target.value)}
            placeholder="Add a title"
            autoFocus
            className={inputCls}
          />
        </Field>

        <div className="flex items-center justify-between">
          <label className="text-small text-[hsl(var(--foreground))]">All-day</label>
          <Toggle
            on={form.allDay}
            onChange={toggleAllDay}
            ariaLabel="All-day"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Start">
            <input
              type={form.allDay ? "date" : "datetime-local"}
              value={form.start}
              onChange={(e) => setField("start", e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="End">
            <input
              type={form.allDay ? "date" : "datetime-local"}
              value={form.end}
              onChange={(e) => setField("end", e.target.value)}
              className={inputCls}
            />
          </Field>
        </div>

        <Field label="Recurrence">
          {isSeriesInstance ? (
            <div className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-3 py-2 text-small text-[hsl(var(--muted-foreground))]">
              Part of a series — editing this instance only.
            </div>
          ) : (
            <RecurrencePicker
              value={form.recurrence}
              onChange={(r) => setField("recurrence", r)}
            />
          )}
        </Field>

        <Field label="Location">
          <input
            type="text"
            value={form.location}
            onChange={(e) => setField("location", e.target.value)}
            placeholder="Add location"
            className={inputCls}
          />
        </Field>

        <Field label="Description">
          <textarea
            value={form.description}
            onChange={(e) => setField("description", e.target.value)}
            placeholder="Notes, links, agenda…"
            rows={4}
            className={`${inputCls} resize-y`}
          />
        </Field>

        <Field label="Reminder">
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={40320}
              value={form.reminderMinutes ?? ""}
              onChange={(e) =>
                setField(
                  "reminderMinutes",
                  e.target.value === "" ? null : Number(e.target.value),
                )
              }
              className={`${inputCls} w-24`}
            />
            <span className="text-small text-[hsl(var(--muted-foreground))]">
              minutes before
            </span>
          </div>
        </Field>
      </div>

      <footer className="flex items-center justify-between gap-2 border-t border-[hsl(var(--border))] px-4 py-3">
        {editing ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDelete}
            disabled={submitting}
            className="text-[hsl(var(--destructive))]"
          >
            Delete
          </Button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={submitting || !form.summary.trim()}
          >
            {editing ? "Save" : "Create"}
          </Button>
        </div>
      </footer>
    </aside>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
        {label}
      </span>
      {children}
    </label>
  );
}

function Toggle({
  on,
  onChange,
  ariaLabel,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={ariaLabel}
      onClick={() => onChange(!on)}
      className={
        "relative h-5 w-9 rounded-full border transition-colors " +
        (on
          ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))]"
          : "border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))]")
      }
    >
      <span
        className={
          "absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow transition-transform " +
          (on ? "translate-x-4" : "translate-x-0.5")
        }
      />
    </button>
  );
}

const inputCls =
  "block w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-2 text-small text-[hsl(var(--foreground))] outline-none focus:border-[hsl(var(--primary))]";

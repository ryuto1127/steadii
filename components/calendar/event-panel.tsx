"use client";

import { useEffect, useRef, useState } from "react";
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
  type CalendarTask,
  type RecurrenceKind,
} from "@/lib/calendar/events";
import {
  type CalendarEventInput,
  type CalendarEventPatch,
} from "@/lib/agent/calendar-actions";
import { type TaskInput, type TaskPatch } from "@/lib/agent/tasks-actions";

export type PanelState =
  | { state: "closed" }
  | { state: "edit"; kind: "event"; event: CalendarEvent }
  | { state: "edit"; kind: "task"; task: CalendarTask }
  | {
      state: "create";
      kind: "event";
      prefill: { start: string; end: string; allDay: boolean };
    }
  | {
      state: "create";
      kind: "task";
      prefill: { due: string };
    };

type Props = {
  state: Exclude<PanelState, { state: "closed" }>;
  onClose: () => void;
  onCreateEvent: (input: CalendarEventInput) => void | Promise<void>;
  onUpdateEvent: (patch: CalendarEventPatch) => void | Promise<void>;
  onDeleteEvent: (eventId: string) => void | Promise<void>;
  onCreateTask: (input: TaskInput) => void | Promise<void>;
  onUpdateTask: (patch: TaskPatch) => void | Promise<void>;
  onDeleteTask: (task: CalendarTask) => void | Promise<void>;
  onToggleTaskComplete: (task: CalendarTask) => void | Promise<void>;
};

export function EventPanel(props: Props) {
  if (props.state.kind === "event") {
    return <EventModePanel {...props} state={props.state} />;
  }
  return <TaskModePanel {...props} state={props.state} />;
}

// ---------------- Event mode ----------------

type EventFormState = {
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

function initFromEvent(ev: CalendarEvent): EventFormState {
  return {
    summary: ev.summary,
    allDay: ev.allDay,
    start: ev.allDay
      ? ev.start
      : formatDateTimeLocalInput(parseEventStart({ start: ev.start, allDay: false })),
    end: ev.allDay
      ? shiftDays(ev.end, -1)
      : formatDateTimeLocalInput(new Date(ev.end)),
    location: ev.location ?? "",
    description: ev.description ?? "",
    recurrence: parseRecurrence(ev.recurrence),
    reminderMinutes: ev.reminders?.minutes ?? null,
  };
}

function initFromEventPrefill(prefill: {
  start: string;
  end: string;
  allDay: boolean;
}): EventFormState {
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

type EventPanelState =
  | { state: "edit"; kind: "event"; event: CalendarEvent }
  | {
      state: "create";
      kind: "event";
      prefill: { start: string; end: string; allDay: boolean };
    };

function EventModePanel({
  state,
  onClose,
  onCreateEvent,
  onUpdateEvent,
  onDeleteEvent,
}: Props & { state: EventPanelState }) {
  const editing = state.state === "edit";
  const isSeriesInstance =
    state.state === "edit" && Boolean(state.event.recurringEventId);
  const [form, setForm] = useState<EventFormState>(() =>
    state.state === "edit"
      ? initFromEvent(state.event)
      : initFromEventPrefill(state.prefill),
  );
  const [submitting, setSubmitting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setForm(
      state.state === "edit"
        ? initFromEvent(state.event)
        : initFromEventPrefill(state.prefill),
    );
    setConfirmingDelete(false);
    if (confirmTimerRef.current) {
      clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = null;
    }
  }, [state]);

  useEffect(() => {
    return () => {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    };
  }, []);

  const setField = <K extends keyof EventFormState>(k: K, v: EventFormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const toggleAllDay = (next: boolean) => {
    setForm((f) => {
      if (next === f.allDay) return f;
      if (next) {
        const sDate = f.start.slice(0, 10);
        const eDate = f.end.slice(0, 10) || sDate;
        return { ...f, allDay: true, start: sDate, end: eDate };
      }
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
        ? shiftDays(form.end, 1)
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
        await onUpdateEvent({ eventId: state.event.id, ...base });
      } else {
        await onCreateEvent(base);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const beginDelete = () => {
    if (state.state !== "edit") return;
    setConfirmingDelete(true);
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    confirmTimerRef.current = setTimeout(() => {
      setConfirmingDelete(false);
      confirmTimerRef.current = null;
    }, 5000);
  };

  const cancelDelete = () => {
    setConfirmingDelete(false);
    if (confirmTimerRef.current) {
      clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = null;
    }
  };

  const confirmDelete = async () => {
    if (state.state !== "edit") return;
    if (confirmTimerRef.current) {
      clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = null;
    }
    setSubmitting(true);
    try {
      await onDeleteEvent(state.event.id);
    } finally {
      setSubmitting(false);
      setConfirmingDelete(false);
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
          confirmingDelete ? (
            <div className="flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                onClick={cancelDelete}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={confirmDelete}
                disabled={submitting}
                className="bg-[hsl(var(--destructive))] text-white hover:bg-[hsl(var(--destructive))]/90"
              >
                Confirm delete
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={beginDelete}
              disabled={submitting}
              className="text-[hsl(var(--destructive))]"
            >
              Delete
            </Button>
          )
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
            disabled={submitting || !form.summary.trim() || confirmingDelete}
          >
            {editing ? "Save" : "Create"}
          </Button>
        </div>
      </footer>
    </aside>
  );
}

// ---------------- Task mode ----------------

type TaskFormState = {
  title: string;
  due: string;
  notes: string;
  completed: boolean;
};

type TaskPanelState =
  | { state: "edit"; kind: "task"; task: CalendarTask }
  | { state: "create"; kind: "task"; prefill: { due: string } };

function initFromTask(t: CalendarTask): TaskFormState {
  return {
    title: t.title,
    due: t.due,
    notes: t.notes ?? "",
    completed: t.completed,
  };
}

function initFromTaskPrefill(prefill: { due: string }): TaskFormState {
  return {
    title: "",
    due: prefill.due,
    notes: "",
    completed: false,
  };
}

function TaskModePanel({
  state,
  onClose,
  onCreateTask,
  onUpdateTask,
  onDeleteTask,
  onToggleTaskComplete,
}: Props & { state: TaskPanelState }) {
  const editing = state.state === "edit";
  const [form, setForm] = useState<TaskFormState>(() =>
    state.state === "edit"
      ? initFromTask(state.task)
      : initFromTaskPrefill(state.prefill),
  );
  const [submitting, setSubmitting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setForm(
      state.state === "edit"
        ? initFromTask(state.task)
        : initFromTaskPrefill(state.prefill),
    );
    setConfirmingDelete(false);
    if (confirmTimerRef.current) {
      clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = null;
    }
  }, [state]);

  useEffect(() => {
    return () => {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    };
  }, []);

  const setField = <K extends keyof TaskFormState>(k: K, v: TaskFormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async () => {
    if (!form.title.trim()) return;
    setSubmitting(true);
    try {
      if (state.state === "edit") {
        await onUpdateTask({
          taskId: state.task.id,
          taskListId: state.task.taskListId,
          title: form.title.trim(),
          notes: form.notes.trim() ? form.notes : null,
          due: form.due || null,
        });
      } else {
        await onCreateTask({
          title: form.title.trim(),
          notes: form.notes.trim() || undefined,
          due: form.due || undefined,
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const toggleCompleted = async () => {
    if (state.state !== "edit") {
      setForm((f) => ({ ...f, completed: !f.completed }));
      return;
    }
    const next = !form.completed;
    setForm((f) => ({ ...f, completed: next }));
    await onToggleTaskComplete(state.task);
  };

  const beginDelete = () => {
    if (state.state !== "edit") return;
    setConfirmingDelete(true);
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    confirmTimerRef.current = setTimeout(() => {
      setConfirmingDelete(false);
      confirmTimerRef.current = null;
    }, 5000);
  };

  const cancelDelete = () => {
    setConfirmingDelete(false);
    if (confirmTimerRef.current) {
      clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = null;
    }
  };

  const confirmDelete = async () => {
    if (state.state !== "edit") return;
    if (confirmTimerRef.current) {
      clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = null;
    }
    setSubmitting(true);
    try {
      await onDeleteTask(state.task);
    } finally {
      setSubmitting(false);
      setConfirmingDelete(false);
    }
  };

  return (
    <aside className="flex w-[360px] shrink-0 flex-col overflow-hidden rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))]">
      <header className="flex items-center justify-between border-b border-[hsl(var(--border))] px-4 py-3">
        <h2 className="text-h3">{editing ? "Edit task" : "New task"}</h2>
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
            value={form.title}
            onChange={(e) => setField("title", e.target.value)}
            placeholder="Add a title"
            autoFocus
            className={inputCls}
          />
        </Field>

        <Field label="Due">
          <input
            type="date"
            value={form.due}
            onChange={(e) => setField("due", e.target.value)}
            className={inputCls}
          />
        </Field>

        <Field label="Notes">
          <textarea
            value={form.notes}
            onChange={(e) => setField("notes", e.target.value)}
            placeholder="Notes, links…"
            rows={4}
            className={`${inputCls} resize-y`}
          />
        </Field>

        {editing && (
          <div className="flex items-center justify-between">
            <label className="text-small text-[hsl(var(--foreground))]">
              Completed
            </label>
            <Toggle
              on={form.completed}
              onChange={toggleCompleted}
              ariaLabel="Completed"
            />
          </div>
        )}
      </div>

      <footer className="flex items-center justify-between gap-2 border-t border-[hsl(var(--border))] px-4 py-3">
        {editing ? (
          confirmingDelete ? (
            <div className="flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                onClick={cancelDelete}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={confirmDelete}
                disabled={submitting}
                className="bg-[hsl(var(--destructive))] text-white hover:bg-[hsl(var(--destructive))]/90"
              >
                Confirm delete
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={beginDelete}
              disabled={submitting}
              className="text-[hsl(var(--destructive))]"
            >
              Delete
            </Button>
          )
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
            disabled={submitting || !form.title.trim() || confirmingDelete}
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

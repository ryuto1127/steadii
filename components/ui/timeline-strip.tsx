"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { CLASS_COLOR_HEX, normalizeClassColor, type ClassColor } from "./class-color";
import { cn } from "@/lib/utils/cn";

export type TimelineEvent = {
  start: Date;
  end: Date;
  title: string;
  color?: ClassColor | string | null;
};

export type TimelineDay = {
  label: string;
  events: TimelineEvent[];
};

const DAY_START_HOUR = 7;
const DAY_END_HOUR = 22;
const TOTAL_HOURS = DAY_END_HOUR - DAY_START_HOUR;

function positionPct(date: Date): number {
  const hours = date.getHours() + date.getMinutes() / 60;
  return Math.max(0, Math.min(100, ((hours - DAY_START_HOUR) / TOTAL_HOURS) * 100));
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function TimelineStrip({ days }: { days: TimelineDay[] }) {
  const t = useTranslations("timeline_strip");
  return (
    <div className="flex flex-col gap-2" role="list" aria-label={t("aria_label")}>
      {days.map((d) => (
        <TimelineRow key={d.label} day={d} />
      ))}
    </div>
  );
}

function TimelineRow({ day }: { day: TimelineDay }) {
  const t = useTranslations("timeline_strip");
  const [hovered, setHovered] = useState<number | null>(null);
  return (
    <div className="flex items-center gap-3 sm:gap-4" role="listitem">
      <div className="w-14 shrink-0 text-small text-[hsl(var(--muted-foreground))] sm:w-20">
        {day.label}
      </div>
      <div className="relative h-6 min-w-0 flex-1 rounded-sm bg-[hsl(var(--surface-raised))]">
        {day.events.map((ev, i) => {
          const left = positionPct(ev.start);
          const right = positionPct(ev.end);
          const width = Math.max(2, right - left);
          const color = CLASS_COLOR_HEX[normalizeClassColor(ev.color ?? null)];
          const isHovered = hovered === i;
          return (
            <button
              key={i}
              type="button"
              aria-label={t("event_aria", {
                title: ev.title,
                start: formatTime(ev.start),
                end: formatTime(ev.end),
              })}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(i)}
              onBlur={() => setHovered(null)}
              className={cn(
                "absolute top-1 bottom-1 flex items-center overflow-hidden rounded-[3px] px-1.5 text-[10px] font-medium text-white transition-default sm:text-[11px]",
                "hover:brightness-110"
              )}
              style={{
                left: `${left}%`,
                width: `${width}%`,
                backgroundColor: color,
              }}
            >
              <span className="truncate">{ev.title}</span>
              {isHovered ? (
                <span
                  role="tooltip"
                  className="pointer-events-none absolute bottom-full left-0 mb-1 whitespace-nowrap rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-2 py-1 text-[11px] text-[hsl(var(--foreground))] shadow-sm"
                >
                  {ev.title} · {formatTime(ev.start)}–{formatTime(ev.end)}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

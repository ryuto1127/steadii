import { describe, it, expect } from "vitest";
import { parseDueDate } from "@/lib/assignments/parse-due";

const TZ = "America/Vancouver";

describe("parseDueDate", () => {
  it("parses an ISO date-only string and pins to EOD local", () => {
    const r = parseDueDate("2026-06-15", { timezone: TZ });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.hadTime).toBe(false);
    // Date should be in 2026-06-15 (UTC may roll back to 06-16 from
    // Vancouver EOD — we accept either flavor).
    const iso = r.date.toISOString();
    expect(iso.startsWith("2026-06-15") || iso.startsWith("2026-06-16")).toBe(true);
  });

  it("parses a full ISO with time and preserves it", () => {
    const r = parseDueDate("2026-06-15T17:00:00Z", { timezone: TZ });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.hadTime).toBe(true);
    expect(r.date.toISOString()).toBe("2026-06-15T17:00:00.000Z");
  });

  it("parses 'today'", () => {
    const now = new Date("2026-05-12T18:00:00Z");
    const r = parseDueDate("today", { timezone: TZ, now });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Should be later today (EOD local)
    expect(r.date.getTime()).toBeGreaterThan(now.getTime());
    // Within ~24h
    expect(r.date.getTime() - now.getTime()).toBeLessThan(24 * 3600 * 1000);
  });

  it("parses 'tomorrow'", () => {
    const now = new Date("2026-05-12T18:00:00Z");
    const r = parseDueDate("tomorrow", { timezone: TZ, now });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const delta = r.date.getTime() - now.getTime();
    expect(delta).toBeGreaterThan(12 * 3600 * 1000);
    expect(delta).toBeLessThan(48 * 3600 * 1000);
  });

  it("parses '明日'", () => {
    const now = new Date("2026-05-12T18:00:00Z");
    const r = parseDueDate("明日", { timezone: TZ, now });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const delta = r.date.getTime() - now.getTime();
    expect(delta).toBeGreaterThan(12 * 3600 * 1000);
    expect(delta).toBeLessThan(48 * 3600 * 1000);
  });

  it("parses 'in 3 days'", () => {
    const now = new Date("2026-05-12T18:00:00Z");
    const r = parseDueDate("in 3 days", { timezone: TZ, now });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const deltaDays = (r.date.getTime() - now.getTime()) / (86400 * 1000);
    expect(deltaDays).toBeGreaterThan(2.5);
    expect(deltaDays).toBeLessThan(4);
  });

  it("parses '3日後'", () => {
    const now = new Date("2026-05-12T18:00:00Z");
    const r = parseDueDate("3日後", { timezone: TZ, now });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const deltaDays = (r.date.getTime() - now.getTime()) / (86400 * 1000);
    expect(deltaDays).toBeGreaterThan(2.5);
    expect(deltaDays).toBeLessThan(4);
  });

  it("parses '12月5日' as upcoming December 5", () => {
    const now = new Date("2026-05-12T18:00:00Z");
    const r = parseDueDate("12月5日", { timezone: TZ, now });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.date.toISOString().startsWith("2026-12-")).toBe(true);
  });

  it("parses '12/5' as upcoming December 5", () => {
    const now = new Date("2026-05-12T18:00:00Z");
    const r = parseDueDate("12/5", { timezone: TZ, now });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.date.toISOString().startsWith("2026-12-")).toBe(true);
  });

  it("rolls month/day into next year when already passed", () => {
    const now = new Date("2026-10-01T00:00:00Z");
    const r = parseDueDate("3/15", { timezone: TZ, now });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.date.toISOString().startsWith("2027-03-")).toBe(true);
  });

  it("parses 'next Friday' as a future Friday", () => {
    // 2026-05-12 = Tuesday
    const now = new Date("2026-05-12T18:00:00Z");
    const r = parseDueDate("next Friday", { timezone: TZ, now });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.date.getTime()).toBeGreaterThan(now.getTime());
    const deltaDays = (r.date.getTime() - now.getTime()) / (86400 * 1000);
    // "next Friday" said on Tuesday → following-week Friday = ~10 days out
    expect(deltaDays).toBeGreaterThan(8);
    expect(deltaDays).toBeLessThan(12);
  });

  it("parses '来週水曜'", () => {
    const now = new Date("2026-05-12T18:00:00Z");
    const r = parseDueDate("来週水曜", { timezone: TZ, now });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.date.getTime()).toBeGreaterThan(now.getTime());
  });

  it("returns ok=false for gibberish", () => {
    const r = parseDueDate("purple monkey dishwasher", { timezone: TZ });
    expect(r.ok).toBe(false);
  });

  it("returns ok=false for empty input", () => {
    const r = parseDueDate("", { timezone: TZ });
    expect(r.ok).toBe(false);
  });
});

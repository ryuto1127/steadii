import { describe, it, expect } from "vitest";
import {
  bucketForDate,
  CHAT_RECENCY_BUCKET_ORDER,
  groupByBucket,
} from "@/lib/utils/chat-recency-buckets";

const NOW = new Date(2026, 4, 13, 14, 30, 0); // 2026-05-13 14:30 local

describe("bucketForDate", () => {
  it("classifies same-day timestamps as 'today'", () => {
    const sameDayMorning = new Date(2026, 4, 13, 8, 15, 0);
    const sameDayLate = new Date(2026, 4, 13, 23, 59, 0);
    expect(bucketForDate(sameDayMorning, NOW)).toBe("today");
    expect(bucketForDate(sameDayLate, NOW)).toBe("today");
  });

  it("classifies yesterday's timestamps as 'yesterday'", () => {
    const yesterday = new Date(2026, 4, 12, 18, 0, 0);
    expect(bucketForDate(yesterday, NOW)).toBe("yesterday");
  });

  it("classifies 2–6 day-old timestamps as 'week'", () => {
    expect(bucketForDate(new Date(2026, 4, 11, 12, 0, 0), NOW)).toBe("week");
    expect(bucketForDate(new Date(2026, 4, 7, 9, 0, 0), NOW)).toBe("week");
  });

  it("classifies 7+ day-old timestamps as 'earlier'", () => {
    expect(bucketForDate(new Date(2026, 4, 6, 12, 0, 0), NOW)).toBe("earlier");
    expect(bucketForDate(new Date(2025, 11, 1, 9, 0, 0), NOW)).toBe("earlier");
  });

  it("treats a future timestamp (clock drift) as 'today' instead of crashing", () => {
    const future = new Date(2026, 4, 13, 23, 59, 0);
    expect(bucketForDate(future, NOW)).toBe("today");
  });
});

describe("groupByBucket", () => {
  it("groups rows into the canonical four buckets in input order", () => {
    type Row = { id: string; t: Date };
    const rows: Row[] = [
      { id: "a", t: new Date(2026, 4, 13, 10, 0) },
      { id: "b", t: new Date(2026, 4, 13, 9, 0) },
      { id: "c", t: new Date(2026, 4, 12, 9, 0) },
      { id: "d", t: new Date(2026, 4, 10, 9, 0) },
      { id: "e", t: new Date(2026, 3, 1, 9, 0) },
    ];
    const grouped = groupByBucket(rows, (r) => r.t, NOW);
    expect(grouped.today.map((r) => r.id)).toEqual(["a", "b"]);
    expect(grouped.yesterday.map((r) => r.id)).toEqual(["c"]);
    expect(grouped.week.map((r) => r.id)).toEqual(["d"]);
    expect(grouped.earlier.map((r) => r.id)).toEqual(["e"]);
  });

  it("returns empty arrays for absent buckets so callers can map safely", () => {
    const grouped = groupByBucket<{ t: Date }>([], (r) => r.t, NOW);
    for (const k of CHAT_RECENCY_BUCKET_ORDER) {
      expect(grouped[k]).toEqual([]);
    }
  });
});

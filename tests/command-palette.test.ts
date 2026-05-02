import { describe, expect, it } from "vitest";
import {
  RECENTS_KEY,
  RECENTS_MAX,
  persistRecents,
  pushRecent,
  readRecents,
} from "@/lib/utils/command-palette-recents";
import { detectTutorScope } from "@/lib/chat/scope-detection";

// Wave 2 command palette tests — vitest is node-only (no jsdom; see
// `vitest.config.ts`), so we cover the palette behaviour through the
// extracted pure helpers:
//
//   - `readRecents` / `pushRecent` / `persistRecents` (recent-commands
//     localStorage round-trip; per-device only)
//   - `detectTutorScope` (tutor-handoff path; full coverage already in
//     `tests/chat-scope-detection.test.ts` — this file just confirms
//     the palette uses the right contract)

class FakeStorage {
  store = new Map<string, string>();
  getItem(k: string): string | null {
    return this.store.has(k) ? this.store.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.store.set(k, v);
  }
  removeItem(k: string): void {
    this.store.delete(k);
  }
}

describe("command-palette recents storage", () => {
  it("returns an empty list when nothing has been stored", () => {
    expect(readRecents(new FakeStorage())).toEqual([]);
  });

  it("round-trips a list of recent commands", () => {
    const s = new FakeStorage();
    persistRecents(s, ["draft an extension email", "move friday meeting"]);
    expect(readRecents(s)).toEqual([
      "draft an extension email",
      "move friday meeting",
    ]);
  });

  it("clamps writes to RECENTS_MAX entries", () => {
    const s = new FakeStorage();
    const overflow = ["a", "b", "c", "d", "e", "f", "g", "h"];
    persistRecents(s, overflow);
    const stored = readRecents(s);
    expect(stored).toHaveLength(RECENTS_MAX);
    expect(stored).toEqual(overflow.slice(0, RECENTS_MAX));
  });

  it("pushRecent dedupes existing entries and bumps to the front", () => {
    const list = ["check group project", "draft extension", "move friday"];
    const next = pushRecent(list, "draft extension");
    expect(next).toEqual([
      "draft extension",
      "check group project",
      "move friday",
    ]);
  });

  it("pushRecent ignores empty / whitespace-only commands", () => {
    expect(pushRecent(["x"], "")).toEqual(["x"]);
    expect(pushRecent(["x"], "   ")).toEqual(["x"]);
  });

  it("pushRecent caps the list at RECENTS_MAX", () => {
    let list: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      list = pushRecent(list, `cmd ${i}`);
    }
    expect(list).toHaveLength(RECENTS_MAX);
    expect(list[0]).toBe("cmd 11");
  });

  it("survives a corrupt blob by clearing it and returning empty", () => {
    const s = new FakeStorage();
    s.setItem(RECENTS_KEY, "{not-json[");
    expect(readRecents(s)).toEqual([]);
    expect(s.getItem(RECENTS_KEY)).toBeNull();
  });
});

describe("command-palette tutor handoff trigger", () => {
  it("flags pure-knowledge questions for ChatGPT handoff", () => {
    expect(detectTutorScope("what is matrix multiplication?").isTutor).toBe(
      true
    );
    expect(detectTutorScope("explain photosynthesis").isTutor).toBe(true);
  });

  it("does NOT flag user-context lookups (palette stays in Steadii)", () => {
    // These queries should pass through to the orchestrator — the
    // palette must never block a real secretary lookup with the
    // handoff offer.
    expect(detectTutorScope("show me my MAT223 syllabus").isTutor).toBe(
      false
    );
    expect(detectTutorScope("draft an extension email").isTutor).toBe(false);
    expect(detectTutorScope("what's due this week?").isTutor).toBe(false);
  });
});

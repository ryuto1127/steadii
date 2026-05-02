// Per-device recent-commands storage for the Wave 2 command palette.
// Pure helpers so we can unit-test the round-trip without mounting a
// React tree.

export const RECENTS_KEY = "steadii.command_palette.recents.v1";
export const RECENTS_MAX = 5;

type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export function readRecents(storage: StorageLike): string[] {
  try {
    const raw = storage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((s): s is string => typeof s === "string")
      .slice(0, RECENTS_MAX);
  } catch {
    storage.removeItem(RECENTS_KEY);
    return [];
  }
}

// Insert `next` at the head and dedupe (case-sensitive — repeated
// invocations with the same content collapse). The input list is
// preserved in order otherwise.
export function pushRecent(current: string[], next: string): string[] {
  const trimmed = next.trim();
  if (trimmed.length === 0) return current;
  const filtered = current.filter((r) => r !== trimmed);
  return [trimmed, ...filtered].slice(0, RECENTS_MAX);
}

export function persistRecents(
  storage: StorageLike,
  list: string[]
): void {
  try {
    storage.setItem(RECENTS_KEY, JSON.stringify(list.slice(0, RECENTS_MAX)));
  } catch {
    // Quota exhausted — recents are best-effort.
  }
}

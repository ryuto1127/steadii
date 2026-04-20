import { describe, expect, it, beforeEach, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  env: () => ({
    DATABASE_URL: "postgres://test",
    AUTH_GOOGLE_ID: "id",
    AUTH_GOOGLE_SECRET: "sec",
  }),
}));

const rows: Array<{ id: string; preferences: Record<string, unknown> }> = [];

vi.mock("@/lib/db/client", () => {
  const chain = (result: unknown) => {
    const resolved = Promise.resolve(result);
    const c: Record<string, unknown> = {
      from: () => c,
      where: () => c,
      limit: () => c,
      then: resolved.then.bind(resolved),
      catch: resolved.catch.bind(resolved),
      finally: resolved.finally.bind(resolved),
    };
    return c;
  };
  const update = (_table: unknown) => ({
    set: (patch: { preferences?: Record<string, unknown> }) => ({
      where: async () => {
        const target = rows[0];
        if (target && patch.preferences) {
          target.preferences = {
            ...target.preferences,
            ...patch.preferences,
          };
        }
      },
    }),
  });
  return {
    db: {
      select: () => chain(rows.map((r) => ({ preferences: r.preferences }))),
      update,
    },
  };
});

import {
  getUserThemePreference,
  setUserThemePreference,
} from "@/lib/theme/get-preference";

describe("theme preference persistence", () => {
  beforeEach(() => {
    rows.length = 0;
    rows.push({ id: "u1", preferences: {} });
  });

  it("returns 'system' by default when no theme saved", async () => {
    const t = await getUserThemePreference("u1");
    expect(t).toBe("system");
  });

  it("round-trips an explicit theme value", async () => {
    await setUserThemePreference("u1", "dark");
    expect(rows[0].preferences).toMatchObject({ theme: "dark" });
    const t = await getUserThemePreference("u1");
    expect(t).toBe("dark");
  });

  it("accepts 'light' as a valid theme", async () => {
    await setUserThemePreference("u1", "light");
    const t = await getUserThemePreference("u1");
    expect(t).toBe("light");
  });

  it("accepts 'system' as a valid theme and persists it", async () => {
    await setUserThemePreference("u1", "system");
    const t = await getUserThemePreference("u1");
    expect(t).toBe("system");
  });

  it("treats unknown stored values as 'system'", async () => {
    rows[0].preferences = { theme: "hologram" };
    const t = await getUserThemePreference("u1");
    expect(t).toBe("system");
  });

  it("preserves other preferences when updating theme", async () => {
    rows[0].preferences = { locale: "ja", agentConfirmationMode: "destructive_only" };
    await setUserThemePreference("u1", "dark");
    expect(rows[0].preferences).toEqual({
      locale: "ja",
      agentConfirmationMode: "destructive_only",
      theme: "dark",
    });
  });
});

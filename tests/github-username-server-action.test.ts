import { beforeEach, describe, expect, it, vi } from "vitest";

// engineer-33 — `setGithubUsernameAction` server action tests. We mock
// auth + redirect + revalidatePath + the DB so we can drive the action
// without booting Next.

vi.mock("server-only", () => ({}));

vi.mock("@/lib/auth/config", () => ({
  auth: async () => ({ user: { id: "user-gh" } }),
  signIn: async () => undefined,
}));

const redirectMock = vi.fn((url: string): never => {
  // Mirror Next's behavior: redirect throws an opaque error. Re-throw
  // so the action's control flow exits at the redirect site.
  throw Object.assign(new Error("NEXT_REDIRECT"), { redirectUrl: url });
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));

const revalidateMock = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => revalidateMock(p),
}));

// Capture the value passed to db.update(...).set(...) so we can inspect
// the jsonb-merge SQL expression. The expression is opaque (sql`...`)
// so we don't introspect its internals — we just verify that an
// expression is produced and the update was issued against the right
// user.
let lastSetValue: Record<string, unknown> | null = null;
let lastWherePredicate: unknown = null;

const dbMock = {
  update(_table: unknown) {
    void _table;
    return {
      set(value: Record<string, unknown>) {
        lastSetValue = value;
        return {
          where(predicate: unknown) {
            lastWherePredicate = predicate;
            return Promise.resolve(undefined);
          },
        };
      },
    };
  },
};
vi.mock("@/lib/db/client", () => ({ db: dbMock }));

// Schema: only the symbols `users` is destructured for; we don't need
// the real columns since we never run the SQL.
vi.mock("@/lib/db/schema", () => ({
  users: { id: { _name: "id" }, preferences: { _name: "preferences" } },
  accounts: {},
  icalSubscriptions: {},
  events: {},
}));

// Stub iCal + notion deps that connections/actions imports at module
// scope but our test never invokes.
vi.mock("@/lib/integrations/notion/import-to-postgres", () => ({
  importNotionWorkspace: async () => ({}),
}));
vi.mock("@/lib/integrations/ical/subscribe", () => ({
  IcalSubscribeError: class extends Error {},
  subscribeToIcal: async () => undefined,
}));

beforeEach(() => {
  redirectMock.mockClear();
  revalidateMock.mockClear();
  lastSetValue = null;
  lastWherePredicate = null;
});

describe("setGithubUsernameAction", () => {
  it("writes a valid username and redirects with ?github=saved", async () => {
    const { setGithubUsernameAction } = await import(
      "@/app/app/settings/connections/actions"
    );
    const fd = new FormData();
    fd.set("username", "ryuto1127");

    await expect(setGithubUsernameAction(fd)).rejects.toThrow(
      "NEXT_REDIRECT"
    );

    expect(lastSetValue).not.toBeNull();
    expect(lastSetValue).toHaveProperty("preferences");
    expect(lastSetValue).toHaveProperty("updatedAt");
    expect(lastWherePredicate).not.toBeNull();
    expect(redirectMock).toHaveBeenCalledWith(
      "/app/settings/connections?github=saved"
    );
    expect(revalidateMock).toHaveBeenCalledWith(
      "/app/settings/connections"
    );
  });

  it("drops the key on empty input and redirects with ?github=cleared", async () => {
    const { setGithubUsernameAction } = await import(
      "@/app/app/settings/connections/actions"
    );
    const fd = new FormData();
    fd.set("username", "   ");

    await expect(setGithubUsernameAction(fd)).rejects.toThrow(
      "NEXT_REDIRECT"
    );

    // Update still issued — empty input drops the key via jsonb minus.
    expect(lastSetValue).not.toBeNull();
    expect(lastSetValue).toHaveProperty("preferences");
    expect(redirectMock).toHaveBeenCalledWith(
      "/app/settings/connections?github=cleared"
    );
  });

  it("rejects an invalid username (leading dash) and does not write", async () => {
    const { setGithubUsernameAction } = await import(
      "@/app/app/settings/connections/actions"
    );
    const fd = new FormData();
    fd.set("username", "-bad-name");

    await expect(setGithubUsernameAction(fd)).rejects.toThrow(
      "NEXT_REDIRECT"
    );

    // Invalid format → no DB write, redirect to ?github=invalid.
    expect(lastSetValue).toBeNull();
    expect(redirectMock).toHaveBeenCalledWith(
      "/app/settings/connections?github=invalid"
    );
  });

  it("rejects a username longer than 39 chars and does not write", async () => {
    const { setGithubUsernameAction } = await import(
      "@/app/app/settings/connections/actions"
    );
    const fd = new FormData();
    fd.set("username", "a".repeat(40));

    await expect(setGithubUsernameAction(fd)).rejects.toThrow(
      "NEXT_REDIRECT"
    );

    expect(lastSetValue).toBeNull();
    expect(redirectMock).toHaveBeenCalledWith(
      "/app/settings/connections?github=invalid"
    );
  });
});

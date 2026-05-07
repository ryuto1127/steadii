import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Codifies the 2026-05-07 fix (Sentry digest 873235542): the QStash
// publish-side client must receive a region-specific baseUrl when
// QSTASH_URL is set, otherwise the package defaults to a global router
// that lands on eu-central-1 and 404s for accounts in other regions.

const ClientCtorSpy = vi.fn();
vi.mock("@upstash/qstash", () => ({
  Client: class {
    constructor(args: { token: string; baseUrl?: string }) {
      ClientCtorSpy(args);
    }
  },
}));

const envValues: { QSTASH_TOKEN: string; QSTASH_URL: string } = {
  QSTASH_TOKEN: "",
  QSTASH_URL: "",
};
vi.mock("@/lib/env", () => ({
  env: () => envValues,
}));

beforeEach(() => {
  ClientCtorSpy.mockClear();
  envValues.QSTASH_TOKEN = "";
  envValues.QSTASH_URL = "";
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("qstash() factory — region URL plumbing", () => {
  it("passes baseUrl when QSTASH_URL is set", async () => {
    envValues.QSTASH_TOKEN = "tok-prod";
    envValues.QSTASH_URL = "https://qstash-us-east-1.upstash.io";

    const { qstash, __resetQStashClientForTests } = await import(
      "@/lib/integrations/qstash/client"
    );
    __resetQStashClientForTests();
    qstash();

    expect(ClientCtorSpy).toHaveBeenCalledTimes(1);
    expect(ClientCtorSpy).toHaveBeenCalledWith({
      token: "tok-prod",
      baseUrl: "https://qstash-us-east-1.upstash.io",
    });
  });

  it("omits baseUrl when QSTASH_URL is empty (preserves package default)", async () => {
    envValues.QSTASH_TOKEN = "tok-dev";
    envValues.QSTASH_URL = "";

    const { qstash, __resetQStashClientForTests } = await import(
      "@/lib/integrations/qstash/client"
    );
    __resetQStashClientForTests();
    qstash();

    expect(ClientCtorSpy).toHaveBeenCalledTimes(1);
    expect(ClientCtorSpy).toHaveBeenCalledWith({ token: "tok-dev" });
  });

  it("throws when QSTASH_TOKEN is empty regardless of QSTASH_URL", async () => {
    envValues.QSTASH_TOKEN = "";
    envValues.QSTASH_URL = "https://qstash-us-east-1.upstash.io";

    const { qstash, __resetQStashClientForTests, QStashTokenMissingError } =
      await import("@/lib/integrations/qstash/client");
    __resetQStashClientForTests();

    expect(() => qstash()).toThrow(QStashTokenMissingError);
    expect(ClientCtorSpy).not.toHaveBeenCalled();
  });
});

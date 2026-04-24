import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Verifier should: short-circuit true in dev when no keys are set,
// reject in prod when keys are missing, reject when signature header is
// absent, delegate to Upstash Receiver when keys + header are present.

const verifyMock = vi.fn();
vi.mock("@upstash/qstash", () => ({
  Receiver: class {
    constructor(_opts: unknown) {}
    verify = verifyMock;
  },
}));
vi.mock("server-only", () => ({}));

beforeEach(() => {
  verifyMock.mockReset();
  vi.unstubAllEnvs();
  vi.stubEnv("QSTASH_CURRENT_SIGNING_KEY", "");
  vi.stubEnv("QSTASH_NEXT_SIGNING_KEY", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function loadVerify() {
  vi.resetModules();
  const mod = await import("@/lib/integrations/qstash/verify");
  return mod.verifyQStashSignature;
}

function makeReq(headers: Record<string, string> = {}): Request {
  return new Request("https://example.com/api/cron/digest", {
    method: "POST",
    headers,
    body: "",
  });
}

describe("verifyQStashSignature", () => {
  it("dev with no keys: returns true (bypass)", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const verify = await loadVerify();
    expect(await verify(makeReq(), "")).toBe(true);
  });

  it("prod with no keys: returns false (closed by default)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const verify = await loadVerify();
    expect(await verify(makeReq(), "")).toBe(false);
  });

  it("missing upstash-signature header: returns false", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("QSTASH_CURRENT_SIGNING_KEY", "k1");
    vi.stubEnv("QSTASH_NEXT_SIGNING_KEY", "k2");
    const verify = await loadVerify();
    expect(await verify(makeReq(), "{}")).toBe(false);
  });

  it("valid signature: delegates to Receiver, returns true", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("QSTASH_CURRENT_SIGNING_KEY", "k1");
    vi.stubEnv("QSTASH_NEXT_SIGNING_KEY", "k2");
    verifyMock.mockResolvedValue(true);
    const verify = await loadVerify();
    const ok = await verify(
      makeReq({ "upstash-signature": "abc" }),
      "raw-body"
    );
    expect(ok).toBe(true);
    expect(verifyMock).toHaveBeenCalledWith({
      signature: "abc",
      body: "raw-body",
    });
  });

  it("invalid signature: Receiver throws, returns false", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("QSTASH_CURRENT_SIGNING_KEY", "k1");
    vi.stubEnv("QSTASH_NEXT_SIGNING_KEY", "k2");
    verifyMock.mockRejectedValue(new Error("bad sig"));
    const verify = await loadVerify();
    expect(
      await verify(makeReq({ "upstash-signature": "bad" }), "raw")
    ).toBe(false);
  });
});

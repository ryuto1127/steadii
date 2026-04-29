import { describe, expect, it } from "vitest";
import { evaluateApiRequest } from "@/proxy";

// CSRF guard for /api/* state-changing routes (polish-13c). Pure-function
// tests that exercise every decision branch without constructing a full
// NextRequest. Anything observable from the route handler's perspective
// goes through `evaluateApiRequest`.

const HOST = "mysteadii.xyz";

function evaluate(overrides: {
  method?: string;
  pathname?: string;
  host?: string;
  secFetchSite?: string | null;
  origin?: string | null;
}) {
  return evaluateApiRequest({
    method: overrides.method ?? "POST",
    pathname: overrides.pathname ?? "/api/settings/wipe-counts",
    host: overrides.host ?? HOST,
    secFetchSite:
      overrides.secFetchSite === undefined ? "same-origin" : overrides.secFetchSite,
    origin:
      overrides.origin === undefined ? `https://${HOST}` : overrides.origin,
  });
}

describe("evaluateApiRequest — scope", () => {
  it("passes non-API routes through", () => {
    expect(
      evaluate({ pathname: "/dashboard", secFetchSite: "cross-site" })
    ).toEqual({ kind: "allow" });
  });

  it("passes API GETs through (read-only)", () => {
    expect(
      evaluate({ method: "GET", secFetchSite: "cross-site" })
    ).toEqual({ kind: "allow" });
  });

  it("passes API HEAD through", () => {
    expect(
      evaluate({ method: "HEAD", secFetchSite: "cross-site" })
    ).toEqual({ kind: "allow" });
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])(
    "guards %s on /api/* routes",
    (method) => {
      const res = evaluate({ method, secFetchSite: "cross-site" });
      expect(res.kind).toBe("block");
    }
  );
});

describe("evaluateApiRequest — webhook bypass", () => {
  it("allows cross-site POST to Stripe webhook (signature gates the handler)", () => {
    expect(
      evaluate({
        pathname: "/api/stripe/webhook",
        secFetchSite: "cross-site",
        origin: "https://stripe.com",
      })
    ).toEqual({ kind: "allow" });
  });

  it("allows cross-site POST to QStash cron endpoints", () => {
    for (const path of [
      "/api/cron/digest",
      "/api/cron/scanner",
      "/api/cron/send-queue",
      "/api/cron/ical-sync",
      "/api/cron/ingest-sweep",
    ]) {
      expect(
        evaluate({
          pathname: path,
          secFetchSite: "cross-site",
          origin: "https://upstash.com",
        }).kind
      ).toBe("allow");
    }
  });
});

describe("evaluateApiRequest — Sec-Fetch-Site primary", () => {
  it("allows same-origin", () => {
    expect(evaluate({ secFetchSite: "same-origin" })).toEqual({ kind: "allow" });
  });

  it("allows same-site (subdomains)", () => {
    expect(evaluate({ secFetchSite: "same-site" })).toEqual({ kind: "allow" });
  });

  it("allows direct navigation (Sec-Fetch-Site: none — Postman/curl/manual)", () => {
    expect(evaluate({ secFetchSite: "none", origin: null })).toEqual({
      kind: "allow",
    });
  });

  it("blocks cross-site", () => {
    const res = evaluate({ secFetchSite: "cross-site" });
    expect(res.kind).toBe("block");
    if (res.kind === "block") expect(res.reason).toMatch(/cross-site/i);
  });
});

describe("evaluateApiRequest — Origin fallback (no Sec-Fetch-Site header)", () => {
  it("allows when Origin matches host", () => {
    expect(
      evaluate({ secFetchSite: null, origin: `https://${HOST}` })
    ).toEqual({ kind: "allow" });
  });

  it("blocks when Origin host differs", () => {
    const res = evaluate({
      secFetchSite: null,
      origin: "https://attacker.example.com",
    });
    expect(res.kind).toBe("block");
    if (res.kind === "block") expect(res.reason).toMatch(/origin/i);
  });

  it("allows when neither Sec-Fetch-Site nor Origin is present (legacy or non-browser)", () => {
    expect(evaluate({ secFetchSite: null, origin: null })).toEqual({
      kind: "allow",
    });
  });

  it("blocks malformed Origin header", () => {
    const res = evaluate({ secFetchSite: null, origin: "not-a-url" });
    expect(res.kind).toBe("block");
  });

  it("blocks Origin host mismatch even when port differs", () => {
    const res = evaluate({
      secFetchSite: null,
      origin: `https://${HOST}:9999`,
    });
    expect(res.kind).toBe("block");
  });
});

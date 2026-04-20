import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const envMock = vi.hoisted(() => ({
  env: () => ({
    NOTION_CLIENT_ID: "nid",
    NOTION_CLIENT_SECRET: "nsec",
    APP_URL: "http://localhost:3000",
  }),
}));

vi.mock("@/lib/env", () => envMock);

import { buildNotionAuthorizeUrl, exchangeNotionCode } from "@/lib/integrations/notion/oauth";

describe("Notion OAuth URL", () => {
  it("includes client_id, redirect_uri, state, response_type=code, owner=user", () => {
    const url = buildNotionAuthorizeUrl("state-abc");
    const u = new URL(url);
    expect(u.host).toBe("api.notion.com");
    expect(u.pathname).toBe("/v1/oauth/authorize");
    expect(u.searchParams.get("client_id")).toBe("nid");
    expect(u.searchParams.get("state")).toBe("state-abc");
    expect(u.searchParams.get("owner")).toBe("user");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3000/api/integrations/notion/callback"
    );
  });
});

describe("exchangeNotionCode", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("POSTs to Notion with Basic auth and returns the parsed body", async () => {
    const body = {
      access_token: "tok",
      bot_id: "bot",
      workspace_id: "ws",
      workspace_name: "My WS",
      workspace_icon: null,
      owner: { type: "user" },
      token_type: "bearer",
    };
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify(body), { status: 200 })
    );

    const result = await exchangeNotionCode("auth-code-xyz");
    expect(result.access_token).toBe("tok");

    const call = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("https://api.notion.com/v1/oauth/token");
    const init = call[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^Basic /);
    const sent = JSON.parse(init.body as string);
    expect(sent.grant_type).toBe("authorization_code");
    expect(sent.code).toBe("auth-code-xyz");
    expect(sent.redirect_uri).toBe(
      "http://localhost:3000/api/integrations/notion/callback"
    );
  });

  it("throws when Notion rejects the exchange", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response("bad", { status: 400 })
    );
    await expect(exchangeNotionCode("bad")).rejects.toThrow(/Notion token exchange failed/);
  });
});

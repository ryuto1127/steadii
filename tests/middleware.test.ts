import { describe, expect, it } from "vitest";
import { middleware } from "@/middleware";
import { NextRequest } from "next/server";

function request(url: string, cookies: Record<string, string> = {}) {
  const req = new NextRequest(new Request(url));
  for (const [k, v] of Object.entries(cookies)) {
    req.cookies.set(k, v);
  }
  return req;
}

describe("middleware — /app auth gate", () => {
  it("redirects unauthenticated visit to /app/chat → /login", () => {
    const res = middleware(request("http://localhost:3000/app/chat"));
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    const location = res.headers.get("location");
    expect(location).toBeTruthy();
    const url = new URL(location!);
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("from")).toBe("/app/chat");
  });

  it("lets authenticated request through when session cookie present", () => {
    const res = middleware(
      request("http://localhost:3000/app/settings", {
        "authjs.session-token": "some-token",
      })
    );
    expect(res.headers.get("location")).toBeNull();
  });

  it("does not redirect marketing pages", () => {
    const res = middleware(request("http://localhost:3000/privacy"));
    expect(res.headers.get("location")).toBeNull();
  });
});

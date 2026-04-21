import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async (host: string) => {
    const table: Record<string, Array<{ address: string; family: number }>> = {
      "example.com": [{ address: "93.184.216.34", family: 4 }],
      "evil-rebind.test": [{ address: "169.254.169.254", family: 4 }],
      "dual-stack.test": [
        { address: "8.8.8.8", family: 4 },
        { address: "::1", family: 6 },
      ],
      "bad-ipv6.test": [{ address: "fd00::1", family: 6 }],
      "public.test": [{ address: "1.1.1.1", family: 4 }],
    };
    const rows = table[host];
    if (!rows) throw new Error(`no mock for ${host}`);
    return rows;
  }),
}));

import {
  BlockedUrlError,
  ResponseTooLargeError,
  assertPublicUrl,
  isBlockedIp,
  safeFetch,
} from "@/lib/utils/ssrf-guard";

describe("isBlockedIp", () => {
  it("blocks loopback", () => {
    expect(isBlockedIp("127.0.0.1")).toBe(true);
    expect(isBlockedIp("127.1.2.3")).toBe(true);
    expect(isBlockedIp("::1")).toBe(true);
  });

  it("blocks link-local (incl. AWS metadata)", () => {
    expect(isBlockedIp("169.254.169.254")).toBe(true);
    expect(isBlockedIp("fe80::1")).toBe(true);
  });

  it("blocks RFC1918 private", () => {
    expect(isBlockedIp("10.0.0.1")).toBe(true);
    expect(isBlockedIp("172.16.0.1")).toBe(true);
    expect(isBlockedIp("172.31.255.254")).toBe(true);
    expect(isBlockedIp("192.168.1.1")).toBe(true);
  });

  it("blocks unspecified + IPv6 ULA", () => {
    expect(isBlockedIp("0.0.0.0")).toBe(true);
    expect(isBlockedIp("::")).toBe(true);
    expect(isBlockedIp("fc00::1")).toBe(true);
    expect(isBlockedIp("fd12:3456:789a::1")).toBe(true);
  });

  it("blocks IPv4-mapped IPv6 loopback", () => {
    expect(isBlockedIp("::ffff:127.0.0.1")).toBe(true);
  });

  it("allows public IPs", () => {
    expect(isBlockedIp("8.8.8.8")).toBe(false);
    expect(isBlockedIp("1.1.1.1")).toBe(false);
    expect(isBlockedIp("2606:4700:4700::1111")).toBe(false);
  });
});

describe("assertPublicUrl", () => {
  it("rejects file://", async () => {
    await expect(assertPublicUrl("file:///etc/passwd")).rejects.toBeInstanceOf(
      BlockedUrlError
    );
  });

  it("rejects gopher://", async () => {
    await expect(
      assertPublicUrl("gopher://example.com/")
    ).rejects.toBeInstanceOf(BlockedUrlError);
  });

  it("rejects the literal `localhost` hostname", async () => {
    await expect(assertPublicUrl("http://localhost:5432/")).rejects.toBeInstanceOf(
      BlockedUrlError
    );
  });

  it("rejects direct loopback IP", async () => {
    await expect(assertPublicUrl("http://127.0.0.1/")).rejects.toBeInstanceOf(
      BlockedUrlError
    );
  });

  it("rejects link-local IP", async () => {
    await expect(
      assertPublicUrl("http://169.254.169.254/latest/meta-data/")
    ).rejects.toBeInstanceOf(BlockedUrlError);
  });

  it("rejects a hostname that resolves to a private IP (DNS rebinding)", async () => {
    await expect(
      assertPublicUrl("http://evil-rebind.test/")
    ).rejects.toBeInstanceOf(BlockedUrlError);
  });

  it("rejects dual-stack hostname if ANY address is private", async () => {
    await expect(assertPublicUrl("http://dual-stack.test/")).rejects.toBeInstanceOf(
      BlockedUrlError
    );
  });

  it("rejects hostname that resolves to an IPv6 ULA", async () => {
    await expect(assertPublicUrl("http://bad-ipv6.test/")).rejects.toBeInstanceOf(
      BlockedUrlError
    );
  });

  it("accepts a normal public hostname", async () => {
    const parsed = await assertPublicUrl("https://example.com/syllabus.html");
    expect(parsed.hostname).toBe("example.com");
  });

  it("accepts a public IP literal", async () => {
    const parsed = await assertPublicUrl("https://1.1.1.1/");
    expect(parsed.hostname).toBe("1.1.1.1");
  });
});

describe("safeFetch size limit", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => {
      const chunks: Uint8Array[] = [
        new Uint8Array(1024),
        new Uint8Array(1024),
        new Uint8Array(1024),
      ];
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const c of chunks) controller.enqueue(c);
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    }) as typeof fetch;
  });

  it("throws ResponseTooLargeError when the body exceeds maxBytes", async () => {
    await expect(
      safeFetch("https://public.test/huge", { maxBytes: 2048 })
    ).rejects.toBeInstanceOf(ResponseTooLargeError);
  });

  it("returns bytes when under the limit", async () => {
    const res = await safeFetch("https://public.test/ok", { maxBytes: 10_000 });
    expect(res.bytes.byteLength).toBe(3072);
    expect(res.status).toBe(200);
  });
});

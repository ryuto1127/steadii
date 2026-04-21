import "server-only";
import { lookup } from "node:dns/promises";
import { isIP, isIPv4, isIPv6 } from "node:net";

export class BlockedUrlError extends Error {
  code = "BLOCKED_URL" as const;
  constructor(message: string) {
    super(message);
  }
}

export class ResponseTooLargeError extends Error {
  code = "RESPONSE_TOO_LARGE" as const;
  constructor(public readonly limitBytes: number) {
    super(`Response exceeded ${limitBytes} bytes.`);
  }
}

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
]);

export function isBlockedIp(ip: string): boolean {
  if (isIPv4(ip)) return isBlockedIPv4(ip);
  if (isIPv6(ip)) return isBlockedIPv6(ip);
  return true;
}

function isBlockedIPv4(ip: string): boolean {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8 unspecified
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local (includes AWS metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // private
  if (a === 192 && b === 0 && parts[2] === 0) return true; // 192.0.0.0/24 reserved
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function isBlockedIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fe80:")) return true; // link-local
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // ULA fc00::/7
  if (normalized.startsWith("ff")) return true; // multicast
  if (normalized.startsWith("::ffff:")) {
    // IPv4-mapped IPv6; check the embedded v4.
    const v4 = normalized.slice("::ffff:".length);
    if (isIPv4(v4)) return isBlockedIPv4(v4);
  }
  return false;
}

export async function assertPublicUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new BlockedUrlError("Invalid URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new BlockedUrlError(
      `Only http(s) URLs are allowed (got ${parsed.protocol}).`
    );
  }

  const host = parsed.hostname.toLowerCase();
  if (!host) throw new BlockedUrlError("URL is missing a hostname.");
  if (BLOCKED_HOSTNAMES.has(host)) {
    throw new BlockedUrlError(`Hostname "${host}" is not reachable.`);
  }

  // If the host is already a literal IP, check it directly without DNS.
  if (isIP(host)) {
    if (isBlockedIp(host)) {
      throw new BlockedUrlError(`IP "${host}" is in a blocked range.`);
    }
    return parsed;
  }

  // Resolve every address for the hostname and reject if any is private.
  // Rejecting the whole hostname (not just filtering) is what closes the
  // DNS-rebinding / dual-stack class of SSRF.
  const addresses = await lookup(host, { all: true });
  if (addresses.length === 0) {
    throw new BlockedUrlError(`Could not resolve "${host}".`);
  }
  for (const addr of addresses) {
    if (isBlockedIp(addr.address)) {
      throw new BlockedUrlError(
        `Hostname "${host}" resolves to a blocked address (${addr.address}).`
      );
    }
  }

  return parsed;
}

export type SafeFetchOptions = {
  timeoutMs?: number;
  maxBytes?: number;
  headers?: Record<string, string>;
};

export type SafeFetchResponse = {
  status: number;
  ok: boolean;
  headers: Headers;
  bytes: Buffer;
  contentType: string;
};

export async function safeFetch(
  rawUrl: string,
  opts: SafeFetchOptions = {}
): Promise<SafeFetchResponse> {
  const { timeoutMs = 15_000, maxBytes = 10 * 1024 * 1024, headers } = opts;
  await assertPublicUrl(rawUrl);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(rawUrl, {
      headers,
      signal: controller.signal,
      redirect: "manual",
    });

    // Manual redirect handling: if we followed automatically, the redirect
    // target's DNS resolution would bypass assertPublicUrl. Re-guard it.
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) {
        throw new BlockedUrlError(
          `Redirect without a Location header (status ${res.status}).`
        );
      }
      const next = new URL(location, rawUrl).toString();
      return await safeFetch(next, opts);
    }

    if (!res.body) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength > maxBytes) throw new ResponseTooLargeError(maxBytes);
      return {
        status: res.status,
        ok: res.ok,
        headers: res.headers,
        bytes: buf,
        contentType: res.headers.get("content-type") ?? "",
      };
    }

    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new ResponseTooLargeError(maxBytes);
      }
      chunks.push(value);
    }
    const bytes = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    return {
      status: res.status,
      ok: res.ok,
      headers: res.headers,
      bytes,
      contentType: res.headers.get("content-type") ?? "",
    };
  } finally {
    clearTimeout(timeout);
  }
}

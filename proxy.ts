import { NextResponse, type NextRequest } from "next/server";

// CSRF guard for /api/* state-changing routes (polish-13c). Next.js Server
// Actions get Origin-based CSRF protection from the framework; raw route
// handlers do not, so we add the check here.
//
// Strategy: trust browser-set Sec-Fetch-Site (Chromium / Firefox / Safari
// all send it), with an Origin-header fallback for any client that omits
// it. Webhooks (Stripe + QStash crons) are legitimately cross-origin and
// authenticate via signed payloads — they're allow-listed below.

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Routes that MUST accept cross-origin requests because they're called by
// external services. Each has its own signature-based authentication that
// runs as the very first thing in the handler.
const CROSS_ORIGIN_ALLOWED: RegExp[] = [
  /^\/api\/stripe\/webhook$/, // Stripe constructEvent verifies stripe-signature
  /^\/api\/cron\//, // QStash verifyQStashSignature on every cron endpoint
];

type Decision =
  | { kind: "allow" }
  | { kind: "block"; reason: string };

export function evaluateApiRequest(input: {
  method: string;
  pathname: string;
  host: string;
  secFetchSite: string | null;
  origin: string | null;
}): Decision {
  if (!input.pathname.startsWith("/api/")) return { kind: "allow" };
  if (!STATE_CHANGING_METHODS.has(input.method)) return { kind: "allow" };
  if (CROSS_ORIGIN_ALLOWED.some((re) => re.test(input.pathname))) {
    return { kind: "allow" };
  }

  // Sec-Fetch-Site is the modern signal. Browsers set it automatically on
  // every fetch:
  //   - "same-origin": same scheme + host + port → allow
  //   - "same-site": registrable-domain match (subdomain) → allow; we
  //     don't have hostile subdomains in our zone
  //   - "none": user-typed URL or non-browser tool (curl, Postman); the
  //     route's own auth() session check still gates these
  //   - "cross-site": came from another site's page → block
  if (input.secFetchSite === "cross-site") {
    return { kind: "block", reason: "cross-site request blocked" };
  }
  if (
    input.secFetchSite === "same-origin" ||
    input.secFetchSite === "same-site" ||
    input.secFetchSite === "none"
  ) {
    return { kind: "allow" };
  }

  // Fallback for clients that don't send Sec-Fetch-Site: verify Origin
  // matches our host. If neither header is present, defer to the route's
  // session check.
  if (input.origin) {
    let originUrl: URL;
    try {
      originUrl = new URL(input.origin);
    } catch {
      return { kind: "block", reason: "malformed origin" };
    }
    if (originUrl.host !== input.host) {
      return { kind: "block", reason: "origin mismatch" };
    }
  }
  return { kind: "allow" };
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/api/")) {
    const decision = evaluateApiRequest({
      method: request.method,
      pathname,
      host: request.nextUrl.host,
      secFetchSite: request.headers.get("sec-fetch-site"),
      origin: request.headers.get("origin"),
    });
    if (decision.kind === "block") {
      return new NextResponse(decision.reason, { status: 403 });
    }
    return NextResponse.next();
  }

  if (pathname.startsWith("/app")) {
    const sessionCookie =
      request.cookies.get("authjs.session-token") ??
      request.cookies.get("__Secure-authjs.session-token");

    if (!sessionCookie) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("from", pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/app/:path*", "/api/:path*"],
};

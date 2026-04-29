# Polish-13c — CSRF middleware + fanout soft-delete filter

Two small fixes from the multi-agent audit. Bundled into one PR because they're each ~30 lines, both touch security/data-integrity surfaces, and shipping them together avoids a third short review cycle.

This PR depends on polish-13b being on main first.

## Setup

```
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
git status   # clean
git log --oneline -5
```

Branch: `polish-13c-csrf-fanout`. Don't push without Ryuto's explicit authorization.

---

## Issue 1 — CSRF middleware for `/api/*` state-changing routes

### Current state

Next.js Server Actions inherit Origin-based CSRF protection automatically (Next.js verifies `Origin` matches `Host` for any POST). Custom `/api/*` route handlers do NOT inherit this — they're plain HTTP handlers.

The audit identified that any state-changing `/api/*` POST/PATCH/DELETE route is exploitable: an attacker-controlled site can issue a fetch with `credentials: "include"`, the user's session cookie rides along (because cookies are scoped by domain, not by referrer), and the request executes server-side as the legitimate user. Most damaging: `POST /api/settings/wipe-data` would obliterate the victim's data.

### Fix — Origin-check middleware

Add a middleware that runs on every `/api/*` POST/PATCH/DELETE request and verifies the request originated from the same origin (the user clicking a button on `mysteadii.xyz`, not a hostile page on the open web).

**Implementation outline:**

1. **Edit (or create) `middleware.ts` at the repo root.** Next.js automatically picks this up.

2. **Match all state-changing `/api/*` requests** EXCEPT webhooks (Stripe, QStash) which are legitimately cross-origin and have their own signature-based authentication:
   ```ts
   // middleware.ts (sketch — adapt to existing middleware shape if one exists)
   import { NextResponse, type NextRequest } from "next/server";

   const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

   // Routes that MUST accept cross-origin requests (signed by other means)
   const CROSS_ORIGIN_ALLOWED = [
     /^\/api\/stripe\/webhook$/,
     /^\/api\/cron\//,            // QStash signs cron deliveries
     /^\/api\/gmail\/webhook$/,    // if Gmail Pub/Sub webhook exists
     /^\/api\/microsoft\/webhook$/,// if Microsoft Graph webhook exists
   ];

   export function middleware(req: NextRequest) {
     const { pathname } = req.nextUrl;
     if (!pathname.startsWith("/api/")) return NextResponse.next();
     if (!STATE_CHANGING_METHODS.has(req.method)) return NextResponse.next();
     if (CROSS_ORIGIN_ALLOWED.some((re) => re.test(pathname))) {
       return NextResponse.next();
     }

     // Same-origin enforcement.
     // Sec-Fetch-Site is set by all modern browsers automatically.
     // - "same-origin" → request from our own page, allow
     // - "same-site" → from a subdomain, allow (we don't have hostile subdomains)
     // - "none" → direct navigation (unusual for state-changing requests but
     //            tools like Postman fall here — let it pass; the auth() check
     //            in the route still gates them)
     // - "cross-site" → from somewhere else, block
     const fetchSite = req.headers.get("sec-fetch-site");
     if (fetchSite === "cross-site") {
       return new NextResponse("Cross-site request blocked", { status: 403 });
     }

     // Fallback for old browsers that don't send Sec-Fetch-Site:
     // verify the Origin header matches our host, OR the request is missing
     // an Origin (older browsers + same-origin GET-like POST submissions).
     if (fetchSite === null) {
       const origin = req.headers.get("origin");
       if (origin) {
         const originUrl = new URL(origin);
         if (originUrl.host !== req.nextUrl.host) {
           return new NextResponse("Origin mismatch", { status: 403 });
         }
       }
       // No Origin and no Sec-Fetch-Site — pass; route's auth() does the heavy lifting
     }

     return NextResponse.next();
   }

   export const config = {
     matcher: ["/api/:path*"],
   };
   ```

3. **Verify webhook signatures still work** — Stripe + QStash webhooks need to bypass the same-origin check (they're cross-site by definition) but their existing signature verification is unaffected. Confirm by tracing each webhook route's handler — the signature check should be the very first thing in the route, before any DB write.

4. **Don't break server actions** — server actions go through Next.js's own pipeline, not `/api/*`, so this middleware doesn't touch them. Their existing Origin check stays.

### Verification

- Unit test or manual: from the dev server, send a `POST /api/settings/wipe-counts` (read-only is fine to test with) with `Sec-Fetch-Site: cross-site` and assert 403
- Manual smoke: confirm the webhook for Stripe (test mode) still posts successfully (it should — it's in `CROSS_ORIGIN_ALLOWED`)
- Manual smoke: confirm normal in-app actions (kebab → delete syllabus, etc.) all still work — they should, because the browser sends `Sec-Fetch-Site: same-origin` automatically

---

## Issue 2 — `lib/agent/email/fanout.ts:183` missing soft-delete filter

### Current state

The fanout module joins `inbox_items.classId → classes.id` to surface class metadata in agent reasoning provenance. The query at `lib/agent/email/fanout.ts:~180-184` does NOT filter `classes.deletedAt IS NULL`. Result: if a user soft-deletes a class via polish-12's class-delete UI, fanout still pulls the soft-deleted class's name into agent provenance, surfacing a "ghost" class in the UI.

### Fix

Add the missing filter:

```ts
// Before
.where(eq(classes.id, classId))

// After
.where(and(eq(classes.id, classId), isNull(classes.deletedAt)))
```

Confirm the import of `isNull` exists in the file. Confirm there are no other fanout queries that join `classes` without this filter — search the file for all `classes.id` joins and add the filter consistently.

### Verification

- Unit test: soft-delete a class, run fanout, assert the class metadata is null/absent rather than the deleted class's name
- Manual smoke: in the dev DB, soft-delete a class, then trigger the agent (any draft in the email pipeline) and check the agent's reasoning panel — the deleted class shouldn't appear

---

## Out of scope

- Adding CSRF tokens beyond the Origin check (Origin-only is the modern recommendation; full token-based CSRF is overkill for our threat model)
- Audit / fix every soft-delete filter gap across the entire codebase — only the fanout site was identified by the audit. Other gaps will surface in α observation
- Converting `/api/*` POST routes to server actions wholesale — that was an alternative considered, but middleware is faster (no per-route refactor) and works equally well

---

## Constraints

- Don't break webhook delivery — Stripe + QStash + any other signed-cross-origin endpoint must stay reachable. Each must be in `CROSS_ORIGIN_ALLOWED`
- Don't break the public marketing site — `/` and `/(marketing)/*` are not API routes and don't need this guard, but verify the matcher excludes them (`matcher: ["/api/:path*"]` does, by being explicit)
- Pre-commit hooks must pass; no `--no-verify`
- Conversation Japanese; commits + PR body English
- Don't push without Ryuto's explicit authorization

---

## Context files

- `middleware.ts` (root, may not exist yet — create if so) — primary edit site for Issue 1
- `lib/agent/email/fanout.ts` — primary edit site for Issue 2
- `app/api/stripe/webhook/route.ts`, `app/api/cron/*` — confirm they're in the allow-list
- `lib/db/schema.ts` — verify `classes.deletedAt` shape

---

## Verification plan

1. `pnpm typecheck` — clean
2. `pnpm test` — green; add unit tests for the middleware + fanout fix
3. `pnpm build` — clean
4. Manual smoke for both issues per the per-issue verification sections above

---

## When done

Report back with:
- Branch + final commit hash
- Verification log
- Confirmation that:
  - Webhooks (Stripe at minimum) still deliver successfully
  - Normal in-app state changes (delete a syllabus, wipe-data flow) still work
  - Soft-deleted class no longer appears in fanout provenance
- Any deviations from the brief + 1-line reason each

This is the last polish-13 PR. After this lands, demo recording and α invite send are the next moves.

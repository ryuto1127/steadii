# Feat — Admin bell notification for new waitlist requests + Stripe promo bugfix

Two related changes bundled into one PR:

1. **Admin bell notification**: when a new waitlist request lands (status `pending`), admin users see a bell entry under "Needs review". Click → `/app/admin/waitlist?tab=pending`.
2. **Stripe Promotion Code generation bug** (PROD bug surfaced 2026-04-29): the literal `STEADII-α-{SLUG}` contains a Greek `α` character that Stripe rejects, and the collision detector swallows the resulting error as a duplicate-code retry → loops 50 times → throws "Could not create a unique Stripe Promotion Code". Approval flow blocked end-to-end.

## Setup

```
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
git status
git log --oneline -5
```

Branch: `feat-admin-bell-notification`. Don't push without Ryuto's explicit authorization.

---

## Fix 1 — Stripe Promotion Code generation bug

### Root cause

`lib/waitlist/promotion-code.ts:32`:

```ts
const baseCode = `STEADII-α-${baseSlug}`;
```

The Greek lowercase `α` (U+03B1) is not in Stripe's allowed character set for Promotion Code strings (Stripe accepts alphanumeric + hyphen + underscore). Every `promotionCodes.create` returns a `StripeInvalidRequestError` with `param: "code"`.

`isPromotionCodeCollision` at `lib/waitlist/promotion-code.ts:75-86` matches ANY `StripeInvalidRequestError` with `param: "code"` as a collision and continues the retry loop. The character-validation error is indistinguishable from a real "already exists" collision, so we burn through all 50 attempts and throw the catch-all.

Sentry trace from prod: `Error: Could not create a unique Stripe Promotion Code for admin-alt@example.com after 50 attempts.`

### Fix — two layers

**Layer 1 (the actual bug): replace `α` with ASCII.** Pick the cleanest substitute:

- Option A — drop entirely: `STEADII-{SLUG}` (e.g. `STEADII-SAMPLE`)
- Option B — `STEADII-A-{SLUG}` (visual mnemonic for "alpha")
- Option C — `STEADII-ALPHA-{SLUG}` (verbose but explicit)

Pick **Option A** (drop entirely). Reasons:
- shortest, cleanest typeable code
- "α" was branding flair; it doesn't survive the production naming constraint
- α-cohort context is already implicit via the `waitlist` source metadata + the time window

`lib/waitlist/promotion-code.ts:32`:

```ts
const baseCode = `STEADII-${baseSlug}`;
```

**Layer 2 (defense in depth): tighten collision detection.** Check the error message text, not just `param: "code"`:

`lib/waitlist/promotion-code.ts:75-86`:

```ts
function isPromotionCodeCollision(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as {
    type?: string;
    code?: string;
    message?: string;
  };
  if (e.type !== "StripeInvalidRequestError") return false;
  // Stripe's "promotion code already exists" message has stable text
  // ("Promotion code already exists." or similar). Match on that string;
  // do NOT treat all `param: 'code'` errors as collisions because
  // character-validation errors share that param.
  return (
    typeof e.message === "string" &&
    /already exist|already in use|duplicate/i.test(e.message)
  );
}
```

Verify Stripe's exact "already exists" message string before locking in the regex (curl Stripe API or check Stripe SDK source); adjust if their wording differs.

### Verify

- Approve the existing pending `admin-alt@example.com` row → Stripe Promotion Code created (visible in Stripe dashboard → Coupons → STEADII_FRIEND_3MO → Promotion codes), Resend email fires, `/invite/STEADII-SAMPLE` resolves.
- Try approving twice (refresh, click again on already-approved row) → second call hits the real collision path, increments to `STEADII-SAMPLE-2`, succeeds.
- Try approving an email with non-ASCII chars like `田中@example.com` → slug normalization strips them, code lands as `STEADII-EXAMPLE` or `STEADII-FRIEND` (fallback), no character-rejection error.

### Memory update needed

`project_decisions.md` lines mentioning `STEADII-α-{NAME}` naming → update to `STEADII-{NAME}` (drop the `α`). Also `feedback_role_split.md` if it mentions the pattern. Sweep with `grep -rn "STEADII-α" ~/.claude/projects/-Users-ryuto-Documents-steadii/memory/`.

---

## Fix 2 — Admin bell notification for new waitlist requests

### Spec (sparring decisions confirmed 2026-04-29)

**Q1 → (a) merge under "Needs review"** — admin sees admin work + own draft reviews in one cognitive bucket
**Q2 → (a) one entry per request** (max 5 cap, "+N more" overflow)
**Q3 → YES** auto-clear when request status flips from `pending` to `approved` or `denied`

### Implementation

#### Storage

The bell already pulls from `agent_proposals` per PR #93 Fix 5 (or `lib/agent/proactive/auto-action-feed.ts` — verify which path). Extend the same query to include admin-only entries.

Suggested approach: introduce a new `kind` value (e.g. `admin_waitlist_pending`) and write a row when a new waitlist request lands. The bell query for admin users adds: `WHERE kind = 'admin_waitlist_pending' AND dismissed_at IS NULL`. For non-admin users, the kind is filtered out (existing query unchanged).

#### Trigger

`app/(marketing)/request-access/actions.ts` — after the successful `waitlistRequests` insert (around line 46-56), enqueue an admin notification record. Use `recordAutoActionLog` or whatever the bell-feeding helper is named (per PR #93 Fix 5 implementation).

Record shape:
- `kind: "admin_waitlist_pending"`
- `summary`: `New waitlist request from ${email}`
- `source_refs`: `[{ kind: "waitlist_request", id: requestId }]`
- `target_user_id`: ALL admin users (or sentinel "admin"; the bell query filters by `is_admin = true OR target_user_id = current_user_id`)

If the existing schema doesn't easily support multi-target records, the simplest path is: write one row per admin user. At α scale, admin count is 1 (Ryuto), so this is trivial.

#### Bell UI

`components/layout/notification-bell-client.tsx` — under "Needs review" section, after the existing high-risk drafts, append admin-waitlist entries. Format:

```
"Needs review"
  ⚠ Draft pending: re: midterm extension (3h ago)
  ⚠ Draft pending: lab make-up (5h ago)
  📋 Waitlist request from tester@example.com (2m ago)    ← new
  📋 Waitlist request from another@example.com (1h ago)    ← new
```

Click on a waitlist entry → navigate to `/app/admin/waitlist?tab=pending` (no row-level highlight needed at α; if Ryuto wants it later, add `&focus=<request-id>` and scroll-to in the page).

Visual: small distinct icon (clipboard / list emoji or Lucide icon) to distinguish from draft items. Same row density as existing draft rows.

#### Auto-clear trigger

When admin clicks Approve or Deny on a waitlist row in `/app/admin/waitlist`, the corresponding `admin_waitlist_pending` bell record gets `dismissed_at = now()`. Hook into the existing `approveWaitlistAction` / `denyWaitlistAction` server actions.

If the request is auto-denied via the rate-limit / spam path (no admin action), the record should also auto-dismiss within 24h (existing bell auto-clear policy applies).

#### Cap + overflow

Bell query for admin user fetches max 5 most recent `admin_waitlist_pending` entries. If pending count > 5, append a "+N more — view all" row that links to `/app/admin/waitlist`.

### Verify

- (After Fix 1 lands) submit a new waitlist request via incognito + different Google account
- Sign in as Ryuto → bell badge increments → dropdown shows "📋 Waitlist request from {email}" under "Needs review"
- Click the entry → land on `/app/admin/waitlist?tab=pending` → row visible
- Approve the row → bell entry disappears (or marks read), badge decrements
- Deny a different row → same auto-clear behavior
- Submit 6+ test requests → bell shows 5 + "+N more" link

### Out of scope

- Web push notifications (browser Notification API) — α scope is in-app bell only
- Per-row admin notes / context preview in bell — admin clicks through to see details on the waitlist page

---

## Constraints

- Locked decisions in `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/` are sacred — `project_decisions.md`'s `STEADII-α-{NAME}` naming is being changed to `STEADII-{NAME}` by this PR (sparring decision 2026-04-29)
- Pre-commit hooks must pass; no `--no-verify`
- Conversation Japanese; commits + PR body English
- Don't push without Ryuto's explicit authorization

## Verification plan

After implementing both fixes:

1. `pnpm typecheck` — clean
2. `pnpm test` — green (add or update tests for the fixed promo code generator + the new admin notification path)
3. Manual end-to-end:
   - Submit waitlist request → bell entry appears
   - Approve → Stripe code created (no Greek α failure) → Resend email sent → bell entry dismissed
   - Click invite link → Stripe Checkout at $0 → Google sign-in → land on `/app`

## When done

Per AGENTS.md §12, your final report MUST include "Memory entries to update":

- `project_decisions.md` — `STEADII-α-{NAME}` → `STEADII-{NAME}` (remove Greek α). Sweep all references.
- `project_agent_model.md` "Auto-action notification surface" section — extend to mention admin-targeted notifications (waitlist pending) flow through the same bell + dismiss-on-resolution pattern.

Plus standard report bits.

The next work unit after this is Phase 6 dogfood completion (Ryuto manual smoke per the dogfood handbook).

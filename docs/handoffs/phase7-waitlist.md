# Phase 7 W-Waitlist — α Access Control (Waitlist + Admin Approval + Auto-Email)

Engineer-side handoff for the α access-control flow. Implements the
locked launch design from `memory/project_decisions.md` ("α access
control flow", revised 2026-04-26).

---

## Goal

After this work unit, the entire α gate flow works end-to-end:

1. Random user visits `mysteadii.xyz` → sees "Request α access" CTA
2. Submits form → `waitlist_requests` row with `status='pending'` →
   redirected to `/access-pending`
3. Ryuto opens `/app/admin/waitlist` → bulk-approves selected rows,
   copies emails for paste into Google Cloud Console test users list,
   clicks "完了 mark"
4. Each approved user automatically receives a Resend email with a
   personalized `/invite/{code}` URL
5. User clicks the URL → Google sign-in → callback verifies waitlist
   approval → proceeds to onboarding → \$0 / 3-month Pro via existing
   Friend Code mechanism → `founding_member=true` auto-set on first
   paid webhook (no change to existing billing logic)

---

## Setup

```
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
git status   # clean
git log --oneline -5
```

Expected (recent → older):

```
683863a Polish (Inbox detail bug + pending UI)
9eef315 docs(deploy): refresh DEPLOY.md
c0836a5 W-Integrations
9cc6206 W-Notes docs
0557ee8 W-Notes UI
```

If main isn't at `683863a` or later, **STOP**.

Branch: `phase7-waitlist`. Don't push without Ryuto's explicit
authorization.

---

## Locked decisions (sparring → 2026-04-26)

Treat as canonical; do **not** re-litigate.

- **Q1** Public intake — anyone can request access. Admin gates
  approval.
- **Q2** Auto-email on approval via Resend (not manual Ryuto-sent).
- **Q3** Stripe Friend Code auto-generated per approval. Existing
  `STEADII_FRIEND_3MO` coupon, `max_redemptions=1`, naming
  `STEADII-α-{NAME}`.
- **Q4** Founding-member status uses the existing webhook path. The
  waitlist gate is access-only, not billing-related.
- **Q5** Sign-in enforcement only in `NODE_ENV=production`. Dev /
  preview accept any Google account for engineer convenience.
  `is_admin=true` users bypass the check entirely.
- **Q6** Bot prevention = per-IP 10 / hour rate limit on the public
  form. No CAPTCHA at α scale.
- **Q7** Tiered auto-approval (`.edu` / `.ac.jp` auto-pass) → post-α.

---

## Existing infrastructure to reuse

- `lib/auth/config.ts` — extend the existing `signIn` callback with
  the waitlist check
- `lib/integrations/resend/client.ts` — existing Resend integration
  for digest. Reuse the client; add a new template under
  `lib/integrations/resend/templates/` (or wherever the existing
  pattern lives)
- `app/api/invite/[code]/route.ts` — existing invite-code redemption
  flow. Auto-generated codes from this work unit feed into it
- `lib/billing/redemption.ts` (or similar) — the path that maps
  invite code → Stripe Checkout → founding-member grant. Don't fork;
  just feed it the auto-generated codes
- `lib/utils/rate-limit.ts` (if it exists) — for the public form
  limit. Otherwise add a small implementation
- `app/app/admin/` — existing admin layout / route gate. Mirror it
  for the new waitlist page

---

## Greenfield work

### Schema (Drizzle migration)

```typescript
export const waitlistRequests = pgTable("waitlist_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),  // lowercased on write
  name: text("name"),
  university: text("university"),
  reason: text("reason"),

  status: text("status")
    .$type<"pending" | "approved" | "denied">()
    .notNull()
    .default("pending"),

  requestedAt: timestamp("requested_at").notNull().defaultNow(),
  approvedAt: timestamp("approved_at"),
  emailSentAt: timestamp("email_sent_at"),
  googleTestUserAddedAt: timestamp("google_test_user_added_at"),
  signedInAt: timestamp("signed_in_at"),

  approvedBy: uuid("approved_by").references(() => users.id),
  notes: text("notes"),

  stripePromotionCode: text("stripe_promotion_code"),
  inviteUrl: text("invite_url"),
}, (t) => ({
  emailUniqueIdx: uniqueIndex("waitlist_requests_email_unique_idx")
    .on(t.email),
  statusIdx: index("waitlist_requests_status_idx").on(t.status),
}));
```

### Pages / routes

#### `app/(marketing)/request-access/page.tsx`

- Form fields: email (required) + name (optional) + university
  (optional) + reason (optional, free text)
- Server action submits → inserts row with `status='pending'` →
  redirects to `/access-pending`
- Email validation: RFC syntax. No domain whitelist.
- Rate limit: per-IP 10 / hour. Use `lib/utils/rate-limit.ts` or add
  a small in-memory + DB-backed counter
- i18n: bilingual EN + JA per existing translation pattern

#### `app/access-pending/page.tsx`

Static-friendly page:

```
ありがとうございます。
承認されたら ご記入の email にお知らせします。
通常 24 時間以内に確認します。

──

Thanks. We'll notify you by email when approved
(usually within 24h).
```

#### `app/access-denied/page.tsx`

Static page (shown when `signIn` callback redirects with
unauthorized email):

```
α は招待制です。
ご利用希望の方は hello@mysteadii.xyz までご連絡ください。

──

α is invite-only.
Contact hello@mysteadii.xyz for access.
```

#### `app/(marketing)/page.tsx` (existing landing)

- Primary CTA changes from "Continue with Google" → "Request α
  access"
- Smaller secondary link below: "既に承認済みの方: Sign in →" / "Already
  approved? Sign in →"
- Approved users follow the invite URL from their email; the URL
  itself doesn't need to bypass the landing page
- i18n update for both keys

#### `app/app/admin/waitlist/page.tsx` (admin only)

Gate by `users.is_admin = true` per the existing admin layout
pattern.

- Tabs: Pending / Approved (not synced) / Approved (synced) / Denied / All
- Pending tab: checkbox per row, "Approve selected" + "Deny
  selected" actions
- Each row shows: email / name / university / reason / requestedAt
- "Google Cloud Sync" card at the top:
  - Lists approved-but-not-yet-synced emails
  - "Copy emails for paste" button → writes
    `email1, email2, ...` to clipboard (comma-space-joined for
    Google Cloud Console's input field)
  - "完了 mark" button → updates `googleTestUserAddedAt` on those
    rows
- i18n: admin-only tool, EN-only is acceptable for v1

### Server actions

**`requestAccessAction(email, name?, university?, reason?)`**

- Validates email syntax
- Lowercase-normalizes email
- Per-IP rate-limit check
- Insert `waitlistRequests` row (`status='pending'`). On
  unique-conflict (already requested), return success silently — no
  need to leak that the email was already submitted
- **On successful new insert** (not on conflict): send an admin
  notification email via Resend to the address in env
  `ADMIN_EMAIL` (default: `hello@mysteadii.xyz`). Failure to send
  the notification must not block the user's submission — log via
  Sentry but return success regardless
- Return `{ ok: true }`

**`approveWaitlistAction(ids: string[])`** (admin only)

For each id:

1. Set `status='approved'`, `approvedAt=now`, `approvedBy=adminUserId`
2. Generate Stripe Promotion Code under `STEADII_FRIEND_3MO`:
   `STEADII-α-{slug}` where slug = first part of email or name,
   uppercased ASCII; on collision append numeric suffix
3. Set `stripePromotionCode` + `inviteUrl` on the row
4. Send Resend email (template below)
5. Set `emailSentAt` on the row
6. Return per-row status with errors

**`denyWaitlistAction(ids: string[])`** (admin only)

- `status='denied'`, `approvedAt=null`. No email sent.

**`markGoogleSyncedAction(ids: string[])`** (admin only)

- `googleTestUserAddedAt=now` on the specified rows.

### Sign-in callback enforcement

`lib/auth/config.ts` — extend the existing callback (don't replace
the existing Google scope-sync block):

```typescript
async signIn({ user, account, profile }) {
  // Existing Google scope sync logic stays as-is...

  if (account?.provider !== "google") return true;
  if (env().NODE_ENV !== "production") return true;  // dev/preview open

  const email = user.email?.toLowerCase();
  if (!email) return false;

  // is_admin bypass
  const [adminCheck] = await db
    .select({ isAdmin: users.isAdmin })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (adminCheck?.isAdmin) return true;

  // Waitlist enforcement
  const [request] = await db
    .select({ status: waitlistRequests.status })
    .from(waitlistRequests)
    .where(eq(waitlistRequests.email, email))
    .limit(1);

  if (!request) return "/access-denied?reason=not-requested";
  if (request.status === "pending")
    return "/access-pending?already-submitted";
  if (request.status === "denied")
    return "/access-denied?reason=denied";

  // status === "approved" → record signedInAt, proceed
  await db
    .update(waitlistRequests)
    .set({ signedInAt: new Date() })
    .where(eq(waitlistRequests.email, email));

  return true;
}
```

### Resend email templates (two)

Both templates use the project domain. From address is the existing
`RESEND_FROM_EMAIL` for the sender identity but the access-approved
email overrides to a more human-touch sub-address.

#### Template 1: `access-approved` — sent to user on approval

File: `lib/integrations/resend/templates/access-approved.tsx` (or
whatever the existing pattern is)

- Bilingual JA + EN, JA primary (α target = JP students)
- Subject: `Steadii: アクセスが承認されました / Your Steadii access is ready`
- **From**: `Steadii <hello@mysteadii.xyz>`
- **Reply-To**: `hello@mysteadii.xyz`
- Body:

```
{name}さん こんにちは、

Steadii の α アクセスが承認されました。
下のリンクからサインインしてください:

{inviteUrl}

上のリンクには 3 ヶ月間 Pro 機能 (¥0) を含みます。
サインイン後 14 日間の trial が始まります。

何か困ったことがあれば、このメールに返信してください。

ありがとうございます。
— Ryuto

────

Hi {name},

Your Steadii α access is approved. Sign in here:

{inviteUrl}

The link includes 3 months of Pro (¥0) and starts your
14-day trial on sign-in. Reply to this email if anything goes
sideways.

Thanks,
— Ryuto
```

If `name` is null / empty, default to a neutral greeting (`こんにちは、` / `Hi,`).

#### Template 2: `admin-new-request` — sent to admin on new submission

File: `lib/integrations/resend/templates/admin-new-request.tsx`

Triggered by `requestAccessAction` after successful new insert (skip
on unique-conflict). Failure to send must NOT block the user
submission — wrap in try/catch + Sentry log, return user success
regardless.

- **From**: `Steadii System <agent@mysteadii.xyz>` (reuse existing
  `RESEND_FROM_EMAIL` default — this is a system notification)
- **To**: env `ADMIN_EMAIL` (default: `hello@mysteadii.xyz`).
  Forwarding to Ryuto's personal Gmail is handled by the inbound
  mail forwarder (improvmx); the engineer doesn't deal with the
  forwarding chain
- **Reply-To**: same as From (this is informational only, replies
  go nowhere meaningful)
- Subject: `[Steadii waitlist] New α access request — {email}`
- Body (EN, terse):

```
New α access request received.

Email:        {email}
Name:         {name or "—"}
University:   {university or "—"}
Reason:       {reason or "—"}
Submitted:    {requestedAt ISO timestamp}

Review and approve at:
  https://mysteadii.xyz/app/admin/waitlist

— Steadii
```

The body is intentionally English-only (admin tool) and structured
so it's also human-readable in plain-text email clients. No HTML
template fanciness needed.

### Env var addition

Add to `.env.example`:

```
# Admin email — receives new-waitlist-request notifications and is
# the contact address shown on /access-denied. Defaults to
# hello@mysteadii.xyz which forwards to Ryuto's personal inbox via
# improvmx (set up separately, not part of this work unit).
ADMIN_EMAIL=hello@mysteadii.xyz
```

Both `requestAccessAction` (notification target) and the
`/access-denied` page copy should read from `ADMIN_EMAIL` (with the
above default fallback) so the address is never hardcoded.

### Rate limit

- Per-IP, 10 requests / 60 minutes for `/request-access` POST
- Postgres-backed counter or in-memory LRU at edge — engineer's call
- Return 429 with friendly "too many requests, try again later"
  message on overflow

### Admin gating

- `is_admin = true` users only access `/app/admin/waitlist`
- Mirror the existing `/app/admin` layout pattern; do not invent a
  new auth check

### i18n keys to add (en.ts + ja.ts)

```
landing.cta.request_access       # "Request α access" / "α アクセスをリクエスト"
landing.cta.already_approved     # "Already approved? Sign in" / "既に承認済の方: サインイン"

request_access.title             # "Request access" / "アクセスをリクエスト"
request_access.email_label       # "Email" / "メールアドレス"
request_access.name_label        # "Name (optional)" / "名前 (任意)"
request_access.university_label  # "University (optional)" / "大学 (任意)"
request_access.reason_label      # "What would you use this for? (optional)" / "何を解決したいですか？ (任意)"
request_access.submit            # "Submit" / "送信"
request_access.success_redirect  # used by /access-pending

access_pending.title             # see Page spec
access_pending.body              # see Page spec
access_pending.already_submitted_hint  # if visited via signIn redirect

access_denied.title              # "α is invite-only" / "α は招待制です"
access_denied.body               # see Page spec
access_denied.contact            # "hello@mysteadii.xyz"
```

---

## PR plan

Single PR, ~2.7 days. Branch: `phase7-waitlist`.

Optional split if reviewer prefers smaller diffs:

- **PR 1** (foundation, ~1 day) — schema + sign-in callback +
  `/access-denied` page + admin route gate. Sign-in enforcement
  live, no public form yet (zero incoming requests until PR 2)
- **PR 2** (~1.7 days) — public form + admin page + Resend template
  + Stripe Promotion Code generation. Full flow live.

Either is fine; engineer chooses.

---

## Out of scope

- Tiered auto-approval (`.edu` / `.ac.jp` auto-pass) — post-α
- CAPTCHA — α scale doesn't need it
- Per-language email-body customization beyond bilingual
- Reminder emails ("you're still waiting") — nice-to-have post-α
- Admin-driven direct add (skipping the form) — bonus, not blocking;
  if there's time, surface a "+ Add manually" button on the admin
  page
- Re-applying for denied users — they email Ryuto per `/access-denied`

---

## Constraints

- Admin route inherits the existing admin gate; do not invent new
  auth
- All locked decisions in `project_decisions.md` and
  `project_pre_launch_redesign.md` are sacred. The waitlist gate
  applies only to access; billing flow / founding-member logic /
  Friend Code mechanism are unchanged
- Pre-commit hooks must pass; do not `--no-verify`
- Conversation Japanese; commits + PR body English
- Don't push without Ryuto's explicit authorization

---

## Context files to read first

- `lib/auth/config.ts` — existing `signIn` callback
- `lib/integrations/resend/client.ts` — existing Resend integration
  (already uses `agent@mysteadii.xyz` as default `from`; the new
  template should override to `hello@mysteadii.xyz` per spec)
- `app/api/invite/[code]/route.ts` — existing invite-code redemption
  flow that auto-generated codes feed into
- `app/(marketing)/page.tsx` — landing page, CTA change
- `app/app/admin/` — existing admin layout for the gate
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_decisions.md`
  — α access control flow (revised 2026-04-26) full UX spec
- `AGENTS.md`, `CLAUDE.md` if present

---

## When done

After PR(s) lands, report back with:

- PR URL(s) + commit hashes
- Verification log:
  - Public form submission → row in `waitlist_requests` with
    `status='pending'`?
  - Admin approval → row updated, Stripe code created, Resend email
    sent (verify in Resend dashboard or test inbox)?
  - Sign-in with non-approved email → `/access-pending` or
    `/access-denied` as appropriate?
  - Sign-in with approved email + invite URL → checkout proceeds at
    \$0 / 3 months → `founding_member` set on `subscription.created`?
  - Rate limit returns 429 after 11 requests in an hour from same IP?
- Deviations from this brief + one-line reason for each
- Open questions for the next work unit (DEPLOY.md walk-through →
  α invite preparation)

The next work unit (Ryuto's operational deploy + first invitee
approvals) picks up from there.

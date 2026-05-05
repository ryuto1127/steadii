# Engineer-33 — OTP/verification time-decay + GitHub username Settings UI

**Read user-memory FIRST** before this doc:

- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_steadii.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_prod_migration_manual.md` — flag the migration so sparring runs `scripts/migrate-prod.ts` post-merge
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_self_capture_verification_screenshots.md`

Reference shipped patterns:

- `lib/agent/email/rules-global.ts` — global predicates + keyword registries (`AUTO_HIGH_KEYWORDS`, `BOT_HOST_HINTS` from engineer-32)
- `lib/agent/email/rules.ts` — L1 classifier callsite
- `lib/agent/email/triage.ts` — entrypoint that orchestrates `buildUserContext → classifyEmail → applyTriageResult`
- `lib/agent/email/auto-archive.ts` — Wave 5 auto-archive sweep pattern
- `app/api/cron/ingest-sweep/route.ts` — existing 5-min cron (extend OR add sibling)
- `app/app/settings/connections/page.tsx` + `app/app/settings/connections/actions.ts` — Settings UI patterns + server actions
- `lib/agent/preferences.ts` — `getUserTimezone` style helper (mirror for `getUserGithubUsername`)

---

## Strategic context

Two independently-scoped wins fold into one PR because they share the user-preferences plumbing engineer-32 introduced:

1. **OTP / verification-code time-decay.** Ryuto's inbox showed a 16h-old `AMD Registration / One-time verification code` still tagged HIGH/重要. Verification codes have a real TTL (5-10 min) — past that they are user-irrelevant noise. Detect-and-decay: when the L1 sees an OTP-shaped email, stamp `inbox_items.urgency_expires_at = now()+10min`. A sweep job past expiry downgrades or auto-archives the row.

2. **GitHub username Settings UI.** Engineer-32 added `users.preferences.githubUsername` for the L1's `@${username}` PR-promotion check, but no UI to set it. Right now the only path is Neon SQL editor. Expose it on the existing Connections page so users can wire their own promotion gate.

**Out of scope** (defer):
- Reclassify-all admin action (separate concern, not blocking)
- Other "What Steadii learned" surfaces
- L2 prompt tuning
- New OTP keyword registries beyond the curated initial set (grow over time as false-negatives surface)

---

## Setup

```bash
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
```

Most recent expected: PR #151 (tasks tz fix) at commit `87c4834` or any sparring inline after this handoff doc lands. If main is behind, **STOP**.

Branch: `engineer-33-otp-decay-and-github-username`. Don't push without Ryuto's explicit authorization.

---

## Feature A — OTP / verification-code time-decay

### Detection

New `OTP_KEYWORDS` registry in `rules-global.ts` (subject + body match):

```ts
// Curated. Match is case-insensitive substring or exact-phrase per row.
export const OTP_KEYWORDS: Array<{ phrase: string; locale: "en" | "ja" }> = [
  { phrase: "verification code", locale: "en" },
  { phrase: "one-time code", locale: "en" },
  { phrase: "one time code", locale: "en" },
  { phrase: "OTP", locale: "en" },
  { phrase: "security code", locale: "en" },
  { phrase: "authentication code", locale: "en" },
  { phrase: "認証コード", locale: "ja" },
  { phrase: "確認コード", locale: "ja" },
  { phrase: "ワンタイムコード", locale: "ja" },
  { phrase: "ワンタイムパスワード", locale: "ja" },
];

// Window — short enough that a forgotten code doesn't linger past its
// real expiry, long enough that a user mid-flow still sees it. Most
// providers expire OTPs at 5 min wire-side; we add a small grace.
export const OTP_DECAY_WINDOW_MS = 10 * 60 * 1000;

export function isOtpUrgency(input: {
  subject: string | null;
  body?: string | null;
}): boolean {
  const haystack = `${input.subject ?? ""} ${input.body ?? ""}`.toLowerCase();
  return OTP_KEYWORDS.some((k) => haystack.includes(k.phrase.toLowerCase()));
}
```

### L1 wire-up

In `rules.ts`, after the existing `AUTO_HIGH` decision branch but **before** `finish(...)`, stamp the urgency expiry on the result:

```ts
// Extend TriageResult in types.ts:
//   urgencyExpiresAt: Date | null;
// L1 returns it; applyTriageResult writes to inbox_items column.
if (isOtpUrgency({ subject: input.subject, body: input.body })) {
  result.urgencyExpiresAt = new Date(Date.now() + OTP_DECAY_WINDOW_MS);
  provenance.push({
    ruleId: "GLOBAL_URGENCY_OTP_DECAY",
    source: "global",
    why: "OTP / verification-code keyword matched. Decays after the window.",
  });
}
```

OTP mail still routes to its natural bucket (typically AUTO_HIGH because of the action verb / "verify"). The decay is additive metadata, not a re-routing.

### Schema migration `0032_inbox_urgency_decay.sql`

```sql
ALTER TABLE inbox_items
  ADD COLUMN urgency_expires_at timestamptz;

-- Partial index — only rows that haven't decayed yet AND haven't been
-- already-archived. The sweep query filters on both, so the index is
-- exactly what gets scanned.
CREATE INDEX inbox_urgency_decay_idx
  ON inbox_items (urgency_expires_at)
  WHERE urgency_expires_at IS NOT NULL AND auto_archived = false;
```

### Sweep job

Extend the existing 5-min `app/api/cron/ingest-sweep/route.ts` rather than introducing a new schedule. Add a `decayUrgentInboxItems(userId)` step that runs alongside the existing per-user fan-out:

```ts
async function decayUrgentInboxItems(userId: string): Promise<number> {
  const expired = await db
    .select({ id: inboxItems.id })
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.userId, userId),
        eq(inboxItems.autoArchived, false),
        sql`${inboxItems.urgencyExpiresAt} < now()`
      )
    );
  if (expired.length === 0) return 0;

  const ids = expired.map((r) => r.id);
  await db
    .update(inboxItems)
    .set({
      bucket: "auto_low",
      riskTier: "low",
      autoArchived: true,
      updatedAt: new Date(),
    })
    .where(inArray(inboxItems.id, ids));

  // Audit log per Wave 5 pattern (auto_archive action). Per-row write
  // so the digest's "Steadii hid" section + activity timeline see the
  // decay events.
  for (const id of ids) {
    await logEmailAudit({
      userId,
      action: "auto_archive",
      result: "success",
      resourceId: id,
      detail: { reason: "urgency_decay" },
    });
  }
  return ids.length;
}
```

Auto-archive (= `autoArchived=true`) chosen over a soft `bucket=auto_low` downgrade because OTPs past expiry are unambiguously useless. The user can still see them via the existing `Hidden ({n})` chip if they need to scrub a recovery code from their history.

### Tests

- `tests/otp-urgency-detection.test.ts` (~6) — `isOtpUrgency` matrix: EN / JA phrases, false-positives ("did you receive my code?" pleasantry), case-insensitive
- `tests/otp-urgency-decay-sweep.test.ts` (~4) — `decayUrgentInboxItems` mocked-db coverage: not-yet-expired skipped, expired flipped to `auto_archived=true`, no-op when zero matches, audit row written per item

---

## Feature B — GitHub username Settings UI

### Server action

New `setGithubUsernameAction(username: string | null)` in `app/app/settings/connections/actions.ts`:

```ts
const GITHUB_USERNAME_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/;

export async function setGithubUsernameAction(username: string | null) {
  const userId = await getUserId();
  const trimmed = username?.trim();
  if (trimmed && !GITHUB_USERNAME_RE.test(trimmed)) {
    throw new Error("Invalid GitHub username format.");
  }
  // jsonb merge — set the field if non-empty, drop it if empty.
  const expr = trimmed
    ? sql`preferences || ${JSON.stringify({ githubUsername: trimmed })}::jsonb`
    : sql`preferences - 'githubUsername'`;
  await db.update(users).set({ preferences: expr, updatedAt: new Date() }).where(eq(users.id, userId));
  revalidatePath("/app/settings/connections");
}
```

GitHub username spec: 1-39 chars, alphanumeric + single dashes between alphanumerics, may not start/end with a dash. Regex above matches that.

### UI

In `app/app/settings/connections/page.tsx`, add a new section between the existing GitHub-irrelevant blocks (engineer chooses placement — after the Microsoft block reads cleanly):

```tsx
<Section title={t("github.title")} description={t("github.description")}>
  <form action={setGithubUsernameAction}>
    <input
      name="username"
      type="text"
      defaultValue={existingGithubUsername ?? ""}
      pattern="[a-zA-Z0-9-]{1,39}"
      maxLength={39}
      placeholder="ryuto1127"
      ...
    />
    <button type="submit">{t("github.save")}</button>
  </form>
  <p className="text-small text-muted">
    {t("github.help_text")}
  </p>
</Section>
```

`existingGithubUsername` is read in the page-level `db.select` from `users.preferences.githubUsername`.

### i18n keys

Add to `lib/i18n/translations/{en,ja}.ts` under the `connections_page` namespace:

| key | EN | JA |
|---|---|---|
| `github.title` | "GitHub username" | "GitHub ユーザー名" |
| `github.description` | "Used to promote PR notifications that mention you out of the auto-low bucket." | "@メンションされた PR 通知を auto-low から昇格させるために使われます。" |
| `github.save` | "Save" | "保存" |
| `github.help_text` | "Find this in github.com/settings/profile. Letters, numbers, and dashes only — max 39 characters." | "github.com/settings/profile で確認できます。英数字とハイフンのみ、最大 39 文字。" |
| `github.invalid` | "Invalid GitHub username format." | "GitHub ユーザー名の形式が無効です。" |

### Tests

- `tests/github-username-server-action.test.ts` (~4) — happy-path set, empty-string drops the field, invalid format throws, jsonb merge preserves other preferences keys

---

## Files

- `lib/agent/email/rules-global.ts` — `OTP_KEYWORDS`, `OTP_DECAY_WINDOW_MS`, `isOtpUrgency`
- `lib/agent/email/types.ts` — `TriageResult.urgencyExpiresAt: Date | null`
- `lib/agent/email/rules.ts` — OTP urgency stamp inside `classifyEmail`
- `lib/agent/email/triage.ts` — `applyTriageResult` writes `urgencyExpiresAt` to inbox_items
- `lib/db/schema.ts` — add `urgencyExpiresAt` column on `inboxItems`
- `lib/db/migrations/0032_inbox_urgency_decay.sql`
- `app/api/cron/ingest-sweep/route.ts` — call `decayUrgentInboxItems(userId)` per user
- `lib/agent/email/urgency-decay.ts` (NEW) — `decayUrgentInboxItems` helper (extracted so tests can target it directly)
- `app/app/settings/connections/actions.ts` — `setGithubUsernameAction`
- `app/app/settings/connections/page.tsx` — GitHub Section component + form wiring
- `lib/i18n/translations/{en,ja}.ts` — 5 new keys under `connections_page.github.*`
- 3 new test files

---

## Tests

Aim: existing 948 stay green, +14 new across 3 files → **962+** total.

---

## Verification

Per AGENTS.md §13 — `preview_screenshot @ 1440×900` EN+JA. Required:

- `/app/settings/connections` showing the new GitHub Section (empty state + filled state)
- `/app/inbox` BEFORE: stale OTP email lingering at HIGH
- `/app/inbox` AFTER: same email auto-archived (visible in `Hidden ({n})` chip)
- `Hidden ({n})` chip click reveals the urgency-decayed row with the standard restore action

Manual dev verification:
- Send an OTP-shaped test email to your dev account, observe `urgency_expires_at` populated in DB
- Wait ≥10 min OR manually `UPDATE inbox_items SET urgency_expires_at = now() - interval '1 minute' WHERE id = 'xxx'` in the dev DB
- Trigger ingest-sweep manually via QStash console "Publish now" → row flips to `auto_archived=true`

---

## Sequence after merge

1. Sparring runs `PROD_DATABASE_URL='<from-Neon>' pnpm tsx scripts/migrate-prod.ts` per `feedback_prod_migration_manual.md`
2. No QStash schedule changes (extends existing ingest-sweep)
3. Monitor Sentry / cron heartbeat for `cron.ingest_sweep.tick` — should keep firing every 5 min, just with the additional sweep step inside
4. After 1-day soak, query `audit_log` for `action='auto_archive' AND detail->>'reason' = 'urgency_decay'` to verify decay events firing

---

## Final report (per AGENTS.md §12)

- Branch / PR: `engineer-33-otp-decay-and-github-username`
- Schema migration filename + columns / indexes added
- Tests added (3 files, +14 tests target)
- **Migration flag**: yes — `lib/db/migrations/0032_inbox_urgency_decay.sql`. Sparring applies post-merge via `scripts/migrate-prod.ts`.
- **Memory entries to update**: `sparring_session_state.md` (sparring updates after merge); `project_decisions.md` if any new locked decision (e.g. OTP_DECAY_WINDOW_MS rationale).
- **Out-of-scope flags**: any reclassify-all needs, additional OTP keyword candidates engineer noticed but didn't add.
- **Open questions**: any judgment calls engineer made on placement (e.g. did the GitHub Section land before or after Microsoft? was OTP_DECAY_WINDOW_MS tuned differently?).

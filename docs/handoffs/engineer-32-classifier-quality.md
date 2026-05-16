# Engineer-32 — Classifier quality pass: bot recognition + GitHub-aware bucket

**Read user-memory FIRST** before this doc:

- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_steadii.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_secretary_pivot.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_self_capture_verification_screenshots.md`

Reference shipped patterns:

- `lib/agent/email/rules-global.ts` — global predicates + keyword registries (`isNoreplySender`, `isPromoSenderDomain`, `isEduDomain`, `AUTO_HIGH_KEYWORDS`, etc.)
- `lib/agent/email/rules.ts` — L1 classifier (the rule pipeline that decides bucket + risk_tier from input)
- `lib/agent/email/triage.ts` — entrypoint that orchestrates buildUserContext → classifyEmail → applyTriageResult
- `lib/agent/email/classify-risk.ts` + `classify-deep.ts` — L2 (deep pass for AUTO_HIGH, expensive)

This PR is **L1-only** — no L2 prompt changes, no migrations.

---

## Strategic context

Ryuto's inbox at the time of dispatch shows 156 pending items where most are bot-relayed notifications mis-classified as 高/重要. Investigation identified two root causes:

1. **Bot detection is too narrow.** `isNoreplySender` only matches local-parts starting with `noreply` / `no-reply` / `donotreply`. It misses `*[bot]@` (vercel[bot], dependabot[bot], github-actions[bot]), `*-bot@`, known SaaS bot hostnames (`notifications.github.com`, `notifications.slack.com`, `noreply.discord.com`, etc.), and the `Auto-Submitted: auto-generated` RFC 3834 header.
2. **GitHub PR notifications get the human-display-name boost.** A PR-comment email arrives with `From: "Sample Sender <notifications@github.com>"` — the L1 sees a human-looking display name and a subject like `Re: [acme/sample] feat(data): citizens.json …` and over-weights it as work-y. The actual sender is a bot relay.

This PR adds:
- A broader `isBotSender(input)` predicate that also reads display-name + headers
- A GitHub-specific routing rule that maps `*@*.github.com` notifications to `auto_low` by default, escalating to `auto_high` only on explicit reviewer-request signals (`@${userId}` mention, "review requested", "merge conflicts", "CI failed").

**Out of scope (defer to engineer-33):**
- OTP / verification-code time-decay (needs `inbox_items.urgency_expires_at` migration + sweep job)
- "What Steadii learned" agent_rules viewer
- L2 prompt tuning

---

## Setup

```bash
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
```

Most recent expected: PR #148 (`exam_conflict` self-match fix) at commit `1a12c2e`. If main is behind, **STOP**.

Branch: `engineer-32-classifier-quality`. Don't push without Ryuto's explicit authorization.

---

## Feature A — Broader bot sender detection

### New helper `isBotSender` in `lib/agent/email/rules-global.ts`

Augments `isNoreplySender` with three additional signals:

```ts
export type BotSenderInput = {
  fromEmail: string;
  fromName: string | null;
  // Optional: pass through the Gmail message headers if available so we
  // can inspect Auto-Submitted / Precedence. Triage already extracts
  // these somewhere — engineer wires the field through ClassifyInput
  // if missing.
  autoSubmittedHeader?: string | null;
  precedenceHeader?: string | null;
};

export function isBotSender(input: BotSenderInput): boolean {
  // 1. Existing noreply local-part check (delegate)
  if (isNoreplySender(input.fromEmail)) return true;

  // 2. [bot] / -bot in display name OR local-part
  const local = input.fromEmail.split("@")[0]?.toLowerCase() ?? "";
  const display = (input.fromName ?? "").toLowerCase();
  if (local.endsWith("[bot]") || display.endsWith("[bot]")) return true;
  if (local.endsWith("-bot") || display.includes("(bot)")) return true;

  // 3. Known SaaS bot hostnames — substring match against the @domain
  //    part. Curated list; grow over time.
  const domain = input.fromEmail.split("@")[1]?.toLowerCase() ?? "";
  if (BOT_HOST_HINTS.some((hint) => domain.includes(hint))) return true;

  // 4. RFC 3834 Auto-Submitted header. "no" means human-sent; anything
  //    else (auto-generated / auto-replied) is bot-flagged.
  const auto = (input.autoSubmittedHeader ?? "").toLowerCase().trim();
  if (auto && auto !== "no") return true;

  // 5. Precedence: bulk / auto_reply (legacy)
  const prec = (input.precedenceHeader ?? "").toLowerCase().trim();
  if (prec === "bulk" || prec === "auto_reply" || prec === "junk") return true;

  return false;
}

// Hostname hints — curated list of bot-relay domains. Substring match
// against the senderDomain. Grow when new false-negatives surface.
export const BOT_HOST_HINTS: string[] = [
  "notifications.github.com",
  "noreply.github.com",
  "noreply.discord.com",
  "notifications.slack.com",
  "mail.figma.com",
  "alerts.bitbucket.com",
  "atlassian.net", // jira
  "linear.app",
  "circleci.com",
  "vercel.com", // status / deploy
  "stripe.com",
];
```

### Wire into L1 (`lib/agent/email/rules.ts`)

The existing `isNoreplySender` call at line 100 expands into an `isBotSender` call. Same `containsActionVerb` guard so OTP / password-reset bot mail still surfaces:

```ts
if (isBotSender(input) && !containsActionVerb(haystack)) {
  provenance.push({
    ruleId: "GLOBAL_IGNORE_BOT_SENDER",
    source: "global",
    why: "Detected automated sender (bot, noreply, or auto-submitted) without action-required language.",
  });
  return finish("ignore", 1.0);
}
```

`isNoreplySender` stays exported for back-compat but the L1 callsite uses `isBotSender`. The new ruleId `GLOBAL_IGNORE_BOT_SENDER` replaces `GLOBAL_IGNORE_NOREPLY_NO_ACTION` for new classifications.

---

## Feature B — GitHub-specific routing (auto_low default, gated escalation)

### New helper in `rules-global.ts`

```ts
export function isGithubNotificationDomain(senderDomain: string): boolean {
  const d = senderDomain.toLowerCase();
  return d === "notifications.github.com" || d.endsWith(".github.com");
}

// Subject signals that justify promoting a GitHub notification out of
// the auto_low default. The user's own login is appended at runtime by
// the L1 (so "@ryuto1127" matches when the row was reviewed-requested).
export const GITHUB_HIGH_SIGNALS: RegExp[] = [
  /\breview\s+requested\b/i,
  /\bmerge\s+conflict\b/i,
  /\bci\s+failed\b/i,
  /\btests?\s+failed\b/i,
  /\bdeployment\s+failed\b/i,
  /\bsecurity\s+alert\b/i,
];
```

### Wire into L1

Inserted **after** the bot-sender ignore check and **before** the AUTO_HIGH section. Short-circuits the display-name-based escalation that was wrongly firing:

```ts
if (isGithubNotificationDomain(input.fromDomain)) {
  // Default for GitHub notifications: auto_low. The display name
  // ("Sample Sender" etc.) shadows the actual sender, so role-based
  // escalation must not apply. The first-time-domain heuristic is also
  // disabled here because every PR comment is from a "first-time"
  // collaborator pseudonym.
  const haystackForGh = haystack;
  const userLoginPattern = ctx.githubUsername
    ? new RegExp(`@${escapeRegExp(ctx.githubUsername)}\\b`, "i")
    : null;
  const promote =
    GITHUB_HIGH_SIGNALS.some((re) => re.test(haystackForGh)) ||
    (userLoginPattern && userLoginPattern.test(haystackForGh));
  if (promote) {
    provenance.push({
      ruleId: "GLOBAL_AUTO_HIGH_GITHUB_REVIEW_REQUESTED",
      source: "global",
      why: "GitHub notification with reviewer-request / CI-failure / merge-conflict signal.",
    });
    return finish("auto_high", 0.92);
  }
  provenance.push({
    ruleId: "GLOBAL_AUTO_LOW_GITHUB_NOTIFICATION",
    source: "global",
    why: "GitHub notification (default routing — bot relay despite human display name).",
  });
  return finish("auto_low", 0.95);
}
```

### `ctx.githubUsername` source

Add `githubUsername: string | null` to `UserContext` (`lib/agent/email/types.ts`). Read from `users.preferences.githubUsername` if present (already a `jsonb` column). Add a new key in user preferences without a migration. Default to `null` if absent — gates the @-mention promote.

The Settings page UI for entering this username is **out of scope for this PR** — engineer-33 candidate. For now, the column read suffices; users without a configured username just don't get @-mention escalation (still get keyword-based escalation).

---

## Files

- `lib/agent/email/rules-global.ts` — new exports `isBotSender` / `BOT_HOST_HINTS` / `isGithubNotificationDomain` / `GITHUB_HIGH_SIGNALS`
- `lib/agent/email/rules.ts` — replace noreply check with bot check; insert GitHub branch
- `lib/agent/email/types.ts` — extend `UserContext` and `ClassifyInput` (header pass-through)
- `lib/agent/email/triage.ts` — populate `githubUsername` in `buildUserContext`; pass `Auto-Submitted` / `Precedence` headers through to `ClassifyInput` from gmail message headers (already extracted in `body-extract.ts` / similar — engineer wires)

No migrations.

---

## Tests

Aim: existing 929 stay green, +12 new across 2 files → **941+**.

- `tests/bot-sender-detection.test.ts` (~7)
  - noreply local-part still flagged (back-compat with `isNoreplySender`)
  - `vercel[bot]@somewhere.com` → bot
  - `notifications@github.com` → bot
  - human-display-name + bot-domain → bot
  - `Auto-Submitted: auto-generated` → bot
  - `Precedence: bulk` → bot
  - regular human sender → not bot
- `tests/github-notifications-routing.test.ts` (~5)
  - default: auto_low at 0.95 confidence
  - "review requested" subject → auto_high
  - `@${ctx.githubUsername}` mention → auto_high
  - first-time-domain heuristic does NOT fire for GitHub
  - role-based escalation does NOT fire for GitHub (display name is bot-relay)

Existing tests covering noreply behavior must keep passing — `isNoreplySender` stays exported.

---

## Verification

Per AGENTS.md §13 — `preview_screenshot @ 1440×900` EN+JA. Required:

- `/app/inbox` BEFORE: 156 pending, GitHub notifications + vercel[bot] showing as 高 / 重要
- `/app/inbox` AFTER: pending count drops to ~30-50; GitHub PR comments visible only via `要対応` chip if `@${ctx.githubUsername}` was mentioned, otherwise auto_low (so no longer in default top sort)
- A trace of one specific GitHub email's provenance (the L1 reasoning chain) showing `GLOBAL_AUTO_LOW_GITHUB_NOTIFICATION` was matched

Manual dev verification path:
- Trigger `pnpm dev` → log in → /app/inbox should already filter (existing emails will get re-classified on next ingest cycle, OR engineer adds a one-shot "reclassify-all" action for verification — out of scope for this PR but useful)
- Verify with `console.log` in the L1 callsite that `isBotSender` matches expected senders

---

## Sequence after merge

1. No prod migration needed
2. **Reclassification trigger**: existing inbox items in prod were classified before the new rules. They keep their old buckets. Two paths:
   - (Default) Wait for natural decay — new emails get the new classification; old emails fade out as the user resolves them.
   - (Aggressive) Add a one-shot admin action `reclassifyAllInboxItemsForUser(userId)` that re-runs `classifyEmail` against every open inbox row. Out of scope for this PR; flag in the final report if Ryuto wants it.
3. Monitor Sentry for new ruleId provenance to confirm rules firing
4. After 1-week soak, review `agent_proposals` / inbox `bucket` distribution — should see GitHub notification share dropping out of `auto_high` into `auto_low`

---

## Final report (per AGENTS.md §12)

- Branch / PR: `engineer-32-classifier-quality`
- New ruleId provenance entries documented
- Tests added (2 files, +12 tests target)
- **Migration flag**: NO — pure classifier change, no schema impact
- **Memory entries to update**: `project_decisions.md` if a new locked decision (e.g. github_username gathering UX). `sparring_session_state.md` updated by sparring after merge.
- **Out-of-scope flags**: OTP time-decay (engineer-33), GitHub username Settings UI (engineer-33), L2 prompt tuning (separate cycle), reclassify-all admin action (separate flag).
- **Open questions**: was the Auto-Submitted header already plumbed from gmail.ts to ClassifyInput? If not, list the specific files engineer touched to wire it through, so reviewer can audit.

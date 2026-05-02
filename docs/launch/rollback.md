# Rollback procedure — pre-public launch

When error budget breaches (`docs/launch/error-budget.md`) or a user
report indicates broken core flow, the default response is **revert,
not hotfix**. Hotfix only when the regression is a one-line obvious
typo.

## Vercel deployment rollback

1. **Identify the last good deployment** in the Vercel dashboard:
   - Project → Deployments → filter by "Production"
   - Cross-reference the SHA against `git log` to know what code shipped.
2. **Promote previous deployment**:
   - Click the deployment row → "Promote to production"
   - Promotion is instant; users on the next request hit the older
     bundle. No DB change.
3. **Confirm** error rate dropped via Sentry within 5 minutes. If
   not, check if the regression is on a path that's read from DB
   (schema migration) — see "DB rollback" below.

## Code revert (preferred for tracked SHA)

```bash
git fetch origin
git checkout main
git revert <bad SHA> --no-edit
git push origin main
```

Vercel auto-deploys the revert commit. Monitor the build (`gh run
list -L 1` or the dashboard) — if it passes, the next traffic hits
the reverted code.

## DB migration rollback

Neon doesn't auto-rollback Drizzle migrations; we handle it manually.

For Wave 5's migration (`0029_wave_5_launch_prep.sql`):

- All ADD COLUMN steps are non-destructive — no rollback needed if we
  revert the code; columns stay around but are unread.
- The `cron_heartbeats` table is greenfield — DROP TABLE is safe if we
  revert past 0029 (the schema doesn't reference it elsewhere).

If a future migration adds destructive change (DROP COLUMN / DROP
TABLE / NOT NULL on existing column), the migration handoff must
include explicit rollback SQL and that SQL must be tested against a
PITR branch before merge. No exceptions.

## Last 7 days of PRs (live list)

Sparring keeps a manual roster of "last 7 days" merged PRs in the
launch-checklist note. The roster is the canonical "what could be
the regression" lookup at incident time. Format:

```
PR #N · <title> · <SHA> · ships <date> · risk: low/med/high · revert: clean/needs-coord
```

A PR is `clean` to revert if it doesn't depend on a sibling PR's
schema change; `needs-coord` if reverting requires also reverting
something else. Wave 5 itself is `needs-coord` because it ships
auto-archive (default off) plus the schema columns at once — a
revert of 0029 also reverts the engineer-side gating logic.

## Communication template

For α: post in `#steadii-alpha`:

```
:warning: Steadii is investigating an issue (started ~ HH:MM PT).
Auto-actions are paused while we triage. We'll update here within 15 minutes.
```

For public (post-launch): post on the status page (TBD) + pinned tweet
from `@steadiiapp` if available.

## Post-incident

Within 48h of resolution, write a short retro note to
`docs/launch/incidents/YYYY-MM-DD-<slug>.md`. Format: trigger →
detection latency → mitigation taken → root cause (suspected, may
revise) → corrective action. Sparring helps draft the retro; Ryuto
publishes.

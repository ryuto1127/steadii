# Error budget — public launch readiness

**Owner**: Ryuto. **Source of truth at launch**: this doc. **Last updated**: 2026-05-02 (Wave 5).

## Targets

| Window | Max error rate | What counts |
|---|---|---|
| 24h rolling | 1.0% | 5xx on any user-facing API route, **excluding** webhook + cron |
| 1h rolling | 3.0% | Same scope as above |
| 24h rolling | 0.5% | Stripe webhook 5xx (idempotent — must converge to 0 over retries) |
| 24h rolling | 5.0% | Cron-tick 5xx (one tick can fail without user-visible impact) |

The 1h target is the early-warning floor. Crossing it triggers the
incident-response procedure (`docs/launch/rollback.md`); crossing the
24h floor triggers automatic feature gating per Wave 5 spec.

## How error rate is computed

Source: Sentry events tagged `level=error`, divided by total request
count from Vercel logs over the same window.

We don't have a unified counter today — at α we manually pull these
from the two dashboards. Post-launch the OTel span counts emitted
inside `Sentry.startSpan` (each cron + the chat orchestrator) become
the canonical denominator.

## What to do when budget is breached

1. **Acknowledge in Sentry** — silences alert noise, names an owner.
2. **Identify the regression** — `git log origin/main..HEAD` since
   the last clean window; correlate Sentry breadcrumbs to release SHA.
3. **Decide**: revert or hotfix. Default = revert. Use the rollback
   playbook (`rollback.md`).
4. **Disable the broken surface** — every feature flag we ship to
   public must have a kill-switch path documented in its handoff doc
   (no exceptions). Wave 5's auto-archive defaults to off via
   `AUTO_ARCHIVE_DEFAULT_ENABLED`; the broader chat / inbox / queue
   path requires a code revert today.
5. **Notify α users** — if user-visible, post in the α Discord
   (channel: `#steadii-alpha`) and pin the message until resolution.

## Post-launch automation (post-α)

After public launch, codify the budget in monitoring rather than this
doc:

- Sentry alert rules (`docs/launch/sentry-alerts.md`) cover the
  immediate-response paths.
- A weekly review summarizes: error rate by route, slowest 95p, Sentry
  events broken down by tag.
- A separate doc owns the rollback decision tree once we've absorbed
  the first month of public-traffic shape.

# Sentry alert configuration — pre-public launch

Sentry alert rules are configured in the Sentry dashboard, not in
code. This doc is the reference for what to configure (and what to
verify is configured before public launch).

The shape was tuned for Wave 5: conservative thresholds during the α
2-week safety ramp, tighter thresholds at public launch.

## Alert rules to configure

Configure each as a "Metric Alert" in Sentry → Alerts → Create.

### A1 — Hourly error rate ceiling on user-facing routes

- **When**: error count from `tags.feature ∈ {chat, inbox, settings, queue}`
- **Threshold**: > 10 events per hour
- **Window**: 1 hour
- **Frequency**: Every 30 min
- **Notify**: Email Ryuto + post to Slack (if Sentry-Slack integration is on)

Tuned to start conservative — α has ~10-30 daily active users so 10
events in an hour means materially degraded experience. Tighten to
3-5 events/hr at public launch (1000+ DAU).

### A2 — Cron-tick consecutive failure

- **When**: error count from `tags.feature ∈ {digest_cron, ingest_sweep_cron, pre_brief_cron, scanner_cron, send_queue_cron, groups_cron, ical_sync_cron}`
- **Threshold**: ≥ 3 events from the same `tags.feature` value
- **Window**: 30 min
- **Notify**: Email Ryuto

A single failed tick is normal (transient network blip). Three in 30
minutes means the cron is broken at the code level. The mirror signal
is `/api/health` — see `cron-heartbeat.md`.

### A3 — Stripe webhook rejection

- **When**: error count from `tags.feature = "stripe_webhook"`
- **Threshold**: > 0 events not converging within 1 hour
- **Window**: 1 hour
- **Notify**: Email Ryuto immediately

Stripe retries failed webhooks for ~3 days, but a persistent failure
means new subscriptions aren't reflected — money flow is broken. The
"converging" check is manual today — the webhook idempotency ledger
(`processed_stripe_events`) tells you if Stripe stopped retrying.

### A4 — invalid_grant / Gmail token death

- **When**: error count from `tags.feature ∈ {gmail, email_ingest}` AND
  message contains `invalid_grant`
- **Threshold**: > 5 distinct users affected in 6 hours
- **Window**: 6 hours
- **Notify**: Email Ryuto

A few users will revoke Gmail access organically and that's fine —
Wave 5's revoked banner handles them. A spike means our app
verification or scope set broke; investigate before more users hit
the wall.

### A5 — Auto-archive false-positive proxy

- **When**: count of `auto_archive_restored` audit log rows
- **Threshold**: > 5% of total `auto_archive` rows in the same 24h
  window
- **Window**: 24 hours
- **Notify**: Email Ryuto

This is the safety-ramp tripwire. Per `project_wave_5_design.md`:
"if ≥5% of users report incidents → tune threshold up to 0.97 or
pause flip." Sparring tracks this manually during the 2-week ramp;
post-launch, codify as a Sentry metric backed by the audit-log
counts.

This rule fires from Sentry's "Issues" dashboard query rather than
event count. A SQL-flavored query against the audit log works:

```sql
WITH last_24h AS (
  SELECT
    sum(CASE WHEN action = 'auto_archive' THEN 1 ELSE 0 END) AS archived,
    sum(CASE WHEN action = 'auto_archive_restored' THEN 1 ELSE 0 END) AS restored
  FROM audit_log
  WHERE created_at > now() - interval '24 hours'
)
SELECT restored::float / NULLIF(archived, 0) AS false_positive_rate FROM last_24h;
```

Run this manually (or via a scheduled task) during the 2-week ramp.

## Alert escalation

α: All alerts go to Ryuto's email. No on-call rotation; Steadii is
solo-dev.

Public: TBD. The post-launch on-call shape is parked until we have
α-window data on what alerts actually fire.

## Verifying alerts are configured

Pre-launch checklist (run once, ~30 min before flipping CASA-verified):

1. Open Sentry → Alerts → confirm A1–A5 are present and "active."
2. For each, click "Edit" → confirm the threshold matches above.
3. Test fire one alert (lower threshold to 1 for 5 min, manually
   trigger an error in dev, restore the threshold).

If any alert is missing or misconfigured, public launch is blocked.

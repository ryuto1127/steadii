# HYPOTHESES — unverified beliefs, quarantined

Nothing in this file may be relied on without verifying first. If you verify
one, PROMOTE it: move it to [LEARNINGS.md](./LEARNINGS.md) with the evidence,
in the same PR/report that did the verification. If you refute one, delete it
(tombstone in the PR description). Protocol: [README.md](./README.md).

### vitest-zombie-and-parallel-flake — suite instability under load, root cause unknown
- **Hypothesis**: Vitest in this repo can (a) zombie/hang requiring `pkill -9 -f vitest`, and (b) flake a handful of tests under heavy parallel load (4 unrelated `l2-orchestrator` timeouts observed once while three agent sessions ran concurrently; clean on re-run). Suspected resource contention near the machine's limit, possibly worker-pool related.
- **Basis**: "vitest can zombie" was copied across 6 pre-role-split handoffs without a root cause; the parallel flake was observed once (2026-06-09). Neither has been reproduced deliberately.
- **To verify**: reproduce under controlled load (run the suite with `--maxWorkers` variations while a parallel build runs); if worker contention confirms, pin `maxWorkers` in vitest.config and promote with the config as evidence.
- **Logged**: 2026-06-10 · **Review by**: next flake occurrence.

### stripe-concurrent-delivery-race-self-heals — believed safe, never observed live
- **Hypothesis**: Two near-simultaneous deliveries of the same Stripe event can both pass the processing-gate and run handlers concurrently; the race loser 500s on the downstream unique index and Stripe's retry then acks cleanly — no duplicate fulfillment, no lost side effect.
- **Basis**: Code-path analysis during PR #344 review (unique indexes on `stripe_invoice_id` / `stripe_subscription_id` verified present). The actual concurrent delivery has never been observed in prod; founding-member grant is documented-racy (worst case one extra grant).
- **To verify**: watch Sentry for the loser-500 signature after α launch; or add a 23505 catch in `recordPaidInvoice`/`upsertSubscription` and promote the hardened version as a learning.
- **Logged**: 2026-06-09 · **Review by**: first month of paid traffic.

### digest-every-morning-is-desirable — the send-gate widening is a feature, not spam
- **Hypothesis**: Users with calendar events but zero email activity WANT the daily digest every morning (it's the "morning briefing" the product sells); the PR #346 send-gate widening (non-empty Today section alone triggers a send) will read as value, not noise.
- **Basis**: Product reasoning + evaluator judgment, 2026-06-10. Zero user feedback yet; Ryuto's dogfood pending.
- **To verify**: Ryuto dogfood + first α-user feedback. If it reads as spam: suppress when the only content is an all-day recurring event with no tasks, or add a frequency preference.
- **Logged**: 2026-06-10 · **Review by**: post-dogfood, then first α cohort feedback.

### master-sweep-scale-ceiling — serial fan-out breaks somewhere past ~100 users
- **Hypothesis**: master-sweep's serial per-user iteration + full 24h Gmail window re-list every 15 min (~96 redundant scans/user/day, dedup only at insert time) will exceed the 300s maxDuration somewhere beyond the α cohort size; digests (last in the sweep) fail first.
- **Basis**: Code-shape analysis (design review 2026-06-09). Never load-tested; current α scale shows ~11s ticks (prod /api/health, 2026-06-10).
- **To verify**: watch `lastDurationMs` on master-sweep in /api/health as the cohort grows; if it trends past ~120s, ship the documented cheap fixes (dedup pre-filter before body fetch, bounded concurrency).
- **Logged**: 2026-06-10 · **Review by**: cohort > 50 users, or any health duration spike.

### prod-migrations-arrived-via-unknown-channel — 0036/0037 history is unexplained
- **Hypothesis**: Migrations 0036/0037 (and possibly others in that range) reached the prod schema without an explicit migrate-prod run — suspected `db:push` during early development, but the actual channel was never identified.
- **Basis**: `migrate-prod.ts` header note (2026-05-12) recording the observation; recovery used `--journal-only` after direct schema verification.
- **To verify**: not directly verifiable retroactively; treat as closed history UNLESS prod schema drift reappears — then audit `__drizzle_migrations` against `information_schema` first and document the channel.
- **Logged**: 2026-06-10 · **Review by**: any future prod schema-drift incident.

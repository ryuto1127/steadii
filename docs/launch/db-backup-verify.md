# DB backup verification — Neon point-in-time recovery

Steadii's primary database is Neon Postgres. Neon ships built-in
point-in-time recovery (PITR) but we verify it actually works at
launch to avoid the "we discovered restore was broken when we needed
it" failure mode.

## Pre-launch verification (one-time)

1. **Pick a recovery point** — any timestamp in the last 7 days that
   you remember the data state of. Default: an hour before your most
   recent dogfood session.
2. **Branch from PITR** in the Neon console:
   - Console → Branches → "Create branch"
   - Source = `main` at the chosen timestamp (Neon UI has a time
     picker)
   - Name = `pitr-verify-YYYY-MM-DD`
3. **Compare row counts** to validate the branch reflects the chosen
   point in time:
   ```sql
   -- Run on the new branch
   SELECT
     (SELECT count(*) FROM users WHERE deleted_at IS NULL) AS users_total,
     (SELECT count(*) FROM inbox_items WHERE deleted_at IS NULL) AS inbox_total,
     (SELECT count(*) FROM agent_drafts) AS drafts_total,
     (SELECT count(*) FROM audit_log WHERE created_at > now() - interval '24h') AS audit_24h;
   ```
   These should reflect the past state, not "now".
4. **Smoke test the app against the branch** (optional):
   - Set a local `DATABASE_URL=<branch URL>` in `.env.local`
   - `pnpm dev`, sign in, walk through Inbox + Settings
   - Confirm the app loads without schema mismatch errors
5. **Delete the verification branch** once you've confirmed.

## Retention policy (locked)

- Neon retention window: **14 days** (covers a full sprint plus the
  weekend buffer).
- This is set in Neon project settings → "PITR retention."
- Do not lower below 14 days without sparring confirmation — the
  rollback decision tree assumes "I can restore yesterday afternoon."

## At-launch artifact

Store the verification timestamp + the row-count proof above in a
project root note (e.g. paste the SQL output into the launch checklist
in Notion). The next CASA review may ask for evidence of restore
testing — having it written down beats reconstructing from memory.

## When to re-verify

- Quarterly (every 90 days) post-launch — calendar invite owned by Ryuto.
- After any schema migration that changes >1 table (the migration
  itself is fine; we verify that PITR still produces a usable shape).
- If the Neon plan changes (e.g. moving from Free → Launch tier
  affects retention defaults).

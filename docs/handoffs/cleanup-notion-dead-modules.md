# Cleanup — delete 3 dead Notion modules (post-pivot residue)

Post Notion → Postgres pivot (2026-04-25), three Notion modules are confirmed dead by the read-only audit performed in PR #83 (see `docs/handoffs/hotfix-syllabus-chat-flow.md` "Notion-residual audit"). All three are explicitly self-marked `@deprecated` with "no live consumers" comments and only test-file imports.

Single small PR. Low risk. Defer until W-Integrations Settings polish (`docs/handoffs/polish-w-integrations-settings.md`) is merged.

## Setup

```
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
git status   # clean
```

Branch: `cleanup-notion-dead-modules`. Don't push without Ryuto's explicit authorization.

---

## What to delete

| File | Why |
|---|---|
| `lib/integrations/notion/probe.ts` | `databaseStillExists` was the health probe behind `lib/views/notion-health.ts`. That view is itself dead. Probe has no other callers outside its own test. |
| `lib/views/notion-health.ts` | `@deprecated` self-marker says "No live consumers; kept for rollback safety only." Confirmed: only `tests/notion-health.test.ts` imports it. |
| `lib/views/notion-list.ts` | `@deprecated` self-marker says "No live consumers." Confirmed: only test files import. |
| Their tests | `tests/notion-health.test.ts`, any `tests/notion-list*.test.ts`-style files, plus any test that imports `probe.ts`. Run a final grep before deleting. |

---

## Steps

1. Re-run the verification grep to confirm no NEW callers have appeared since the audit:
   ```
   grep -rn "notion/probe\|notion-health\|notion-list\|databaseStillExists" \
     lib/ app/ components/ --include="*.ts" --include="*.tsx"
   ```
   If any non-test file imports them, **STOP** and report — the audit assumption is broken.

2. Delete the source files: `lib/integrations/notion/probe.ts`, `lib/views/notion-health.ts`, `lib/views/notion-list.ts`.

3. Delete their test files. Run `grep -rn "notion-health\|notion-list\|notion/probe" tests/` to find them.

4. `pnpm typecheck` — should be clean. If anything errors, you missed an import.

5. `pnpm test` — should be all green. If a test fails because it depended on one of these modules, that test is also dead — delete it.

---

## Verify

- `grep -rn "probe.ts\|notion-health\|notion-list" .` returns no matches outside maybe `git history` references in old handoffs (those are fine to leave).
- Build still succeeds (`pnpm build`).
- No production behavior changed — Settings → Connections (post-W-Integrations-polish) and onboarding still work.

---

## Constraints

- Pre-commit hooks must pass; no `--no-verify`
- Commits + PR body English
- Don't push without Ryuto's explicit authorization
- Do not delete other Notion modules — `lib/integrations/notion/{client,data-source,discovery,ensure-setup,setup}.ts` and `lib/integrations/notion/import-to-postgres.ts` and `lib/agent/tools/notion.ts` are all live (per the audit). Only the 3 listed above.

---

## When done

Report back with:

- Branch name + final commit hash
- Verification log (grep / typecheck / tests / build)
- **Memory entries to update**: likely "none" — these modules were never named in memory; they were called out only in the audit doc which itself is historical record.

The next work unit is α launch ops (Stripe catalog setup, QStash cron registration, Sentry config, smoke test, invite codes) — Ryuto-side, not engineer-side.

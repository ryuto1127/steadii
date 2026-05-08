# Engineer-39 — Secretary quality bump: contact persona memory + action items + pre-send sanity check

**Read user-memory FIRST** before this doc:

- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_steadii.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_secretary_pivot.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_decisions.md` (model routing + tier capability)
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_self_capture_verification_screenshots.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_prod_migration_manual.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_qstash_orphan_schedules.md`

Reference shipped patterns:

- `lib/agent/email/fanout.ts` — multi-source retrieval. The persona block plumbs in alongside senderHistory / similarSent / syllabus / emails / calendar.
- `lib/agent/email/classify-deep.ts` — `runDeepPass` — extracts action items here.
- `lib/agent/email/draft-actions.ts` — `approveAgentDraftAction` is where the pre-send sanity check fires.
- `lib/agent/email/style-learner.ts` — engineer-38's edit-delta extractor. The persona-extractor cron mirrors its shape (per-user batch, GPT-5.4 full, idempotent upsert).
- `lib/db/schema.ts` — agent_rules table (writing_style scope after engineer-38). Persona uses a NEW table because it's per-contact, not a rule.

---

## Strategic context

Ryuto challenge 2026-05-08 ("既存サービス参考にしてパクろう"). Three picks from the survey, ranked by Steadii fit:

1. **Per-contact persona memory** (Shortwave pluck): the agent should remember facts about each contact — role, preferences, response patterns — and inject them into draft prompts. Today the model has only `senderRole` (peer/professor/vendor/parent) and per-recipient sender-history. A structured fact list compounds value as the user accumulates correspondence.

2. **Action items extraction → Steadii task proposals** (Steadii-unique): every L2 deep pass identifies what the email obligates the user to do. Today this lands implicitly in the draft body; surfacing it as a structured `action_items[]` on the draft + offering one-click "add to your tasks" turns Steadii into a chief-of-staff that doesn't drop balls.

3. **Pre-send sanity check** (Steadii-unique): right before send, a cheap GPT-5.4 Mini pass scans the draft for hallucinations (dates / names / URLs / events that aren't in the conversation context). Catches Apple Intelligence's known failure mode (made-up meeting times in suggested replies).

These three plug into the existing L2 pipeline at distinct points (deep pass / pipeline output / send-time gate) so they ship cleanly bundled.

---

## Setup

```bash
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
```

Most recent expected commit: latest `main` after PR #187 (`email_thread_summarize`). If main is behind, **STOP**.

Branch: `engineer-39-secretary-quality`. Don't push without Ryuto's explicit authorization.

---

## What changes

### Part 1 — Per-contact persona memory (~400 LOC)

#### 1.1 Schema

New table `agent_contact_personas`:

```sql
CREATE TABLE agent_contact_personas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_email text NOT NULL,
  contact_name text,
  -- Free-form short label for the relationship (e.g. "MAT223 instructor",
  -- "Stripe support", "Mom"). Surfaced in draft prompts AND in the
  -- "How your agent thinks" Settings surface so the user can correct
  -- mistakes.
  relationship text,
  -- Up to 8 short factual statements about the contact. Strings only;
  -- structured fields would over-engineer the v1 surface.
  facts jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Last full extraction timestamp. The cron skips contacts where
  -- last_extracted_at > now() - 7 days OR no new inbox/sent activity
  -- since.
  last_extracted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_contact_personas_user_email_uniq
    UNIQUE (user_id, contact_email)
);

CREATE INDEX agent_contact_personas_user_extracted_idx
  ON agent_contact_personas (user_id, last_extracted_at);
```

Migration `lib/db/migrations/000N_agent_contact_personas.sql`. **Manual migration after merge** per `feedback_prod_migration_manual.md`.

#### 1.2 Background extractor

`lib/agent/email/persona-learner.ts` (new, ~150 LOC) — mirrors `style-learner.ts` shape:

- `extractContactPersona(userId, contactEmail)`:
  - Pulls per-contact: last 30 days of inbox_items WHERE senderEmail=contactEmail + last 30 days of agent_drafts.status='sent' joined to inbox_items WHERE senderEmail=contactEmail + the user's own Gmail in:sent to:contactEmail (same helper as PR #185).
  - Concatenates into a corpus (cap ~6K chars; bounded cost).
  - GPT-5.4 full prompt: "Extract a single-line `relationship` label and up to 8 short `facts` about this contact based on the conversation history. Output JSON: {relationship, facts}."
  - Upserts the row with the new values.

- `runPersonaExtractionForUser(userId)`:
  - Selects active contacts: distinct `senderEmail` from inbox_items where receivedAt > now() - 30d AND (no persona row OR last_extracted_at < now() - 7d).
  - Caps at 20 contacts per run to bound cost.
  - Sequential extraction (parallel would burn LLM rate budget for marginal gain).

#### 1.3 Cron route

`app/api/cron/persona-learner/route.ts` (new, ~80 LOC) — mirrors style-learner cron:

- Daily 9am UTC (`0 9 * * *`).
- Iterates active users (any user with inbox activity in last 7 days).
- Per-user heartbeat + Sentry tag + signature verify.
- **Manual schedule registration on Upstash console after deploy** per `feedback_qstash_orphan_schedules.md`. PR description must include "Add Upstash schedule for /api/cron/persona-learner @ daily 9am UTC".

#### 1.4 Plumb into L2

`lib/agent/email/fanout.ts` — add a 6th source `contactPersona`:

- New type `FanoutContactPersona = { relationship: string | null; facts: string[]; lastExtractedAt: Date | null } | null`.
- Loader queries `agent_contact_personas` by (userId, contactEmail = inbox_items.senderEmail). Returns null if no row exists.
- Added to `FanoutResult`. Per-source timing tracked.

`lib/agent/email/fanout-prompt.ts` — render block:

```
=== Contact persona — {relationship} ===
- {fact 1}
- {fact 2}
...
```

When persona is null:
```
=== Contact persona ===
(no learned persona — first interaction or fresh contact)
```

`runDeepPass` reasoning instruction addition: "Use the contact persona to set tone + register, but don't echo facts back unless the user asked."

`runDraft` — same persona block. The draft prompt's existing "match prior reply tone" instruction expands to "match prior reply tone AND respect the persona's relationship label."

#### 1.5 Settings surface

`/app/settings/how-your-agent-thinks` — new section "Contacts Steadii has learned about":

- Lists all `agent_contact_personas` rows for the user, newest-first.
- Per-contact card: relationship label + facts list + remove button (deletes the row → next L2 falls back to "no learned persona").
- i18n keys + EN/JA.

### Part 2 — Action items extraction (~200 LOC)

#### 2.1 Deep pass output

`lib/agent/email/classify-deep.ts` — `DeepPassResult` gains `actionItems: ExtractedActionItem[]`:

```ts
export type ExtractedActionItem = {
  // Short imperative (e.g. "Submit photo ID", "Reply by Friday with availability").
  title: string;
  // Optional ISO date when the email implies a deadline.
  dueDate: string | null;
  // Confidence 0-1; the user-facing UI surfaces only items >= 0.6.
  confidence: number;
};
```

Extraction prompt addition (in the deep pass): "After your reasoning, list any obligations this email creates for the user as `actionItems` — concrete to-dos with optional due dates. Only include items with high confidence; an email asking 'Are you free Tuesday?' is not an action item, but 'Please submit the form by Friday' is."

#### 2.2 Persistence

`agent_drafts` already has the JSON columns we need (`retrievalProvenance`). Add a new `extractedActionItems jsonb DEFAULT '[]'::jsonb` column via the same migration as Part 1.

`lib/agent/email/l2.ts` persists `deep.actionItems` onto the draft row.

#### 2.3 UI: DraftDetailsPanel new section

`components/agent/draft-details-panel.tsx`:

- New collapsed-by-default section "Steadii detected N action items" below the reasoning block.
- Each item shows: title + due date pill (if set) + "Add to my tasks" button.
- Click "Add to my tasks" → calls a new server action `acceptDraftActionItemAction(draftId, itemIndex)` which writes the item to BOTH:
  - `assignments` (Steadii native, class-bound if the draft's inbox row has a class binding)
  - Google Tasks via existing `createTaskAction` (so it shows in Google Tasks app)
- After accept, the item flips to ✓ done state in the panel; subsequent clicks are no-ops.

#### 2.4 i18n

EN + JA keys for the section heading, button labels, accepted-state copy.

### Part 3 — Pre-send sanity check (~150 LOC)

#### 3.1 Sanity-check pass

`lib/agent/email/pre-send-check.ts` (new, ~80 LOC):

- Function `checkDraftBeforeSend({ draftBody, threadContext })` returns `{ ok: boolean; warnings: string[] }`.
- GPT-5.4 Mini call (cheap, NOT credit-metered as it's a tool_call equivalent).
- Prompt: "You are a fact-checker reviewing an outgoing email draft. The thread context is below. Flag any factual claim in the draft (date, name, URL, event, location, person, attachment reference) that does NOT appear in the thread context. Do NOT flag general greetings, offers, opinions, or stylistic phrasing. Output JSON: {ok: boolean, warnings: [{phrase: string, why: string}]}."
- Bounded: 4K chars context + 200 tokens output.

#### 3.2 Pre-send hook

`lib/agent/email/draft-actions.ts:approveAgentDraftAction` — before calling `enqueueSendForDraft`:

- Call `checkDraftBeforeSend` with the draft body + the thread's recent messages (already loaded by the existing flow).
- If `ok: false`:
  - Persist warnings on `agent_drafts.preSendWarnings: jsonb` (NEW column in the same migration).
  - Throw a typed error `PreSendCheckFailedError(warnings)` that the inbox/[id] page catches and surfaces as a confirmation modal.
  - The user can: "Send anyway" (re-call approveAgentDraftAction with `skipPreSendCheck: true`), or "Edit draft" (cancels the send, returns to edit mode).
- If `ok: true`: proceed to enqueue normally. No user-facing change.

#### 3.3 UI

`components/inbox/draft-edit-pane.tsx` (or wherever the Send button lives):

- Catch the `PreSendCheckFailedError` from the server action, render a modal with the warnings list.
- Modal: "Steadii spotted potential issues" + warning list ("'Friday meeting' — wasn't in the original email") + "Send anyway" / "Cancel" buttons.

#### 3.4 i18n + tests

EN + JA strings. Tests for the sanity check happy path + 2 hallucination cases.

---

## Files

- `lib/db/migrations/000N_engineer_39.sql` (NEW): `agent_contact_personas` table + `agent_drafts.extracted_action_items` column + `agent_drafts.pre_send_warnings` column.
- `lib/db/schema.ts`: schema additions (~50 LOC).
- `lib/agent/email/persona-learner.ts` (NEW, ~150 LOC).
- `lib/agent/email/pre-send-check.ts` (NEW, ~80 LOC).
- `lib/agent/email/fanout.ts`: 6th source slot `contactPersona` (~50 LOC).
- `lib/agent/email/fanout-prompt.ts`: persona block (~30 LOC).
- `lib/agent/email/classify-deep.ts`: `actionItems` extraction (~50 LOC).
- `lib/agent/email/l2.ts`: persist `actionItems` + `preSendWarnings` (~30 LOC).
- `lib/agent/email/draft-actions.ts`: `approveAgentDraftAction` calls pre-send check (~40 LOC).
- `app/api/cron/persona-learner/route.ts` (NEW, ~80 LOC).
- `app/app/settings/how-your-agent-thinks/page.tsx`: "Contacts learned" section (~80 LOC).
- `app/app/settings/how-your-agent-thinks/actions.ts`: `deletePersonaAction` (~25 LOC).
- `components/agent/draft-details-panel.tsx`: action items section (~80 LOC).
- `components/inbox/draft-edit-pane.tsx` (or matching file): pre-send warning modal (~80 LOC).
- `app/app/inbox/actions.ts` (or matching): `acceptDraftActionItemAction` (~50 LOC).
- `lib/i18n/translations/en.ts` + `ja.ts`: new keys (~30 LOC each).
- Tests (~400 LOC across multiple files).

Total: ~1500 LOC across production + tests. Mega scope; engineer can split into 3 PRs (one per Part) if review pacing wants it.

---

## Tests

New test files:
- `tests/persona-learner.test.ts` — extraction skips fresh contacts; upserts correctly; caps facts at 8; corpus assembly handles bilingual.
- `tests/contact-persona-fanout.test.ts` — fanout loads + prompt renders persona block when row exists; renders empty-state when missing.
- `tests/action-items-extraction.test.ts` — deep pass returns structured action items; confidence threshold filters low-confidence noise.
- `tests/accept-action-item.test.ts` — `acceptDraftActionItemAction` writes to both Steadii assignments + Google Tasks; idempotent on double-click.
- `tests/pre-send-check.test.ts` — sanity check happy path; hallucinated date triggers warning; hallucinated URL triggers warning; safe drafts pass.

Modified:
- `tests/fanout-prompt.test.ts` + `tests/l2-deep-pass.test.ts` — fixtures gain `contactPersona: null` (default) + new shape sites.
- `tests/sender-history-fanout.test.ts` — same.

Aim: 1066 → ~1100+. `pnpm test` + `pnpm tsc --noEmit` clean before opening the PR.

---

## Verification

Per AGENTS.md §13 — `preview_screenshot @ 1440×900` EN+JA. Required:

- `/app/settings/how-your-agent-thinks` showing "Contacts Steadii has learned about" section (likely empty until cron runs first time — empty state copy required).
- `/app/inbox/[id]` for a draft with action items: DraftDetailsPanel shows the new "N action items detected" collapsible.
- Pre-send warning modal triggered on a synthetic draft with a fabricated date — modal renders with warning text + Send anyway / Cancel buttons.

---

## Out of scope

- **Cross-source action coordination** (e.g. "this meeting clashes with your class — propose reschedule"). The proactive scanner already does some of this; deferring deeper integration to engineer-40.
- **Class-aware drafting** (per-class tone hints from syllabus). Voice profile + persona memory cover most of this; revisit if measurement shows a residual gap.
- **Send-time prediction** (Superhuman pluck) — defer to engineer-40 alongside coordination.
- **Vector embedding of sent mail** (Stage B from prior discussion) — defer until similar-sent (PR #186) measurement justifies it.
- **Bulk dismiss / archive on home queue** — sparring inline candidate, not engineer-39 territory.

---

## Critical constraints

- **Migration is manual** per `feedback_prod_migration_manual.md`. PR description must include "pnpm db:migrate against prod required" + the exact migration tag.
- **Persona-learner cron schedule** must be created on Upstash console after deploy (per `feedback_qstash_orphan_schedules.md`). PR description must include "Add Upstash schedule for /api/cron/persona-learner @ daily 9am UTC".
- **Pre-send check must NOT block on an LLM error**. Wrap the call so a 5xx from OpenAI degrades to "ok: true" (we'd rather miss a hallucination than block legitimate sends).
- **Action item `acceptDraftActionItemAction` must be idempotent** — record acceptance state on the agent_drafts row (e.g. `acceptedActionItemIndices: number[]`) so a double-click doesn't create dup tasks.
- **Persona facts are user-scoped** (queries always include userId). Cross-user contact reuse is out of scope (privacy).
- **Persona learner cost ceiling**: at α 100 users × 20 contacts × 1 LLM call/contact/run × daily = 2000 calls/day × ~$0.02 (GPT-5.4 full, ~3K input + 200 output) ≈ $40/day. **THIS IS NOT TRIVIAL.** Engineer should verify the budget gate logic skips contacts where last_extracted_at < 7d AND no new activity since. With proper gating, real call rate at α should be ~10% of theoretical.
- **Don't commit changes to `.claude/launch.json`**. Engineer-35 incident — pattern to watch.
- **Vitest can zombie**. `pkill -9 -f vitest` + re-run if hang.

---

## Final report (per AGENTS.md §12)

- Branch / PR: `engineer-39-secretary-quality`
- New tests: counts per new test file + total test count delta from 1066 baseline.
- Production LOC vs test LOC split.
- Migration applied: confirmation that `pnpm db:migrate` ran against prod.
- Upstash schedule registered: confirmation `/api/cron/persona-learner` shows up in Upstash console.
- Per-part smoke checks (chat scenario for each, brief observation).
- Cost estimate: actual persona-learner cost from one cron run on Ryuto's dogfood account.
- Screenshot pairs: Settings → How your agent thinks (Contacts section) EN + JA, /app/inbox/[id] action items panel EN + JA, pre-send warning modal EN + JA.
- **Memory entries to update**: `sparring_session_state.md` updated by sparring after merge.

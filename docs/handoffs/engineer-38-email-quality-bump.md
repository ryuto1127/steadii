# Engineer-38 — Email reply quality: sender-history fanout + voice profile + edit-delta learning

**Read user-memory FIRST** before this doc:

- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_steadii.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_secretary_pivot.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_decisions.md` (model routing + tier capability)
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_self_capture_verification_screenshots.md`

Reference shipped patterns:

- `lib/agent/email/fanout.ts` — multi-source retrieval. Mistakes source returns `[]` after PR #182; replace that slot conceptually with sender-history. The other 3 sources (syllabus / emails / calendar) are unchanged.
- `lib/agent/email/classify-deep.ts` — `runDeepPass` consumes the fanout output. Adds `senderHistory` into the prompt context.
- `lib/agent/email/draft.ts` — `runDraft` generates the draft body. Voice profile + writing-style rules inject here.
- `lib/agent/email/feedback.ts` — `recordSenderFeedback` is the existing feedback hook. Extend with edit-delta capture.
- `lib/db/schema.ts` line 806 — `agent_rules` table already exists. The new `writing_style` scope reuses it.
- `lib/db/schema.ts` users table — `preferences` jsonb is the right home for `voiceProfile` (per `setGithubUsernameAction` precedent).

---

## Strategic context

Ryuto dogfood 2026-05-07 — "email 返信の精度ばらつきが人間レベル未満":

- Steadii drafts vary in tone / length / register depending on the sender + retrieval luck. Sometimes the draft reads exactly like Ryuto wrote it; sometimes it sounds like a generic template.
- Three structural gaps cause most of the variance:
  1. **No sender-history use** — the agent retrieves "similar" past emails by vector, but never reaches for Ryuto's previous *replies to the same person*. The most natural human signal ("I always write this prof in keigo, no emojis, short bullets") is invisible to the model.
  2. **No cold-start voice anchor** — for first-time senders, the model has no idea Ryuto is a Vancouver Grade-12 student writing bilingual EN/JA in a particular register. Drafts default to generic LLM tone.
  3. **No edit-delta loop** — when Ryuto edits "ご確認お願いします" → "お願いします" before sending, the signal disappears. The next draft re-introduces "ご確認".

This spec ships all three as one mega-handoff. Order of impact: 1 > 3 > 2 (1 is the immediate moat; 3 covers cold start; 2 is the long-running learning loop).

---

## Setup

```bash
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
```

Most recent expected commit: `(after PR #182)` — mistake-drop merged. If main is behind that, **STOP**.

Branch: `engineer-38-email-quality`. Don't push without Ryuto's explicit authorization.

---

## What changes

### Part 1 — Sender-history fanout (~150 LOC)

#### 1.1 New fanout source

In `lib/agent/email/fanout.ts`:

- Add a new constant `FANOUT_K_SENDER_HISTORY = 3` (top-3 most-recent past replies to the same sender).
- Add a new function `loadSenderHistory(userId, senderEmail, k)`:
  ```ts
  // Past sent agent_drafts to this sender, newest-first, capped at k.
  // Joins through inbox_items so we can match on senderEmail (the
  // agent_drafts row doesn't denormalize the sender).
  SELECT
    agent_drafts.id,
    agent_drafts.draftSubject,
    agent_drafts.draftBody,
    agent_drafts.sentAt,
    inbox_items.subject AS originalSubject,
    inbox_items.snippet AS originalSnippet
  FROM agent_drafts
  INNER JOIN inbox_items ON agent_drafts.inboxItemId = inbox_items.id
  WHERE
    agent_drafts.userId = $1
    AND agent_drafts.status = 'sent'
    AND inbox_items.senderEmail = $2
    AND agent_drafts.sentAt IS NOT NULL
  ORDER BY agent_drafts.sentAt DESC
  LIMIT $3;
  ```
- Promise.all slot: replace the dead `mistakes` slot with `senderHistory`. Keep the same defensive error swallow + Sentry tag (`feature: "email_fanout", source: "sender_history"`).
- Result type: extend `FanoutResult` with `senderHistory: SenderHistoryEntry[]`. Drop the `mistakes` field from the type entirely (PR #182 made it unconditionally empty; cleanup time).

#### 1.2 Plumb into deep pass + draft prompts

`lib/agent/email/classify-deep.ts`:
- Accept `senderHistory` in the prompt context. Render as a clearly-labeled section above the retrieval pills:
  ```
  ## How you usually reply to this sender (most-recent first)

  1. [2026-04-22] Subject: "Re: midterm prep"
     Body: "Thanks for the heads up. I'll review chapter 7 tonight..."

  2. [2026-04-15] Subject: "Re: office hours Friday"
     Body: "I can come at 3pm. Question: ..."
  ```
- The deep prompt's reasoning instructions get a new line: "When proposing the action, reuse tone / register / phrase patterns from how the user has historically replied to this same sender."

`lib/agent/email/draft.ts`:
- Same context block in the draft prompt. The instruction shifts to: "Match the user's prior reply tone, length, and register to this same sender. Do NOT echo phrases verbatim — use them as a model for register, not a template."

#### 1.3 Provenance

`buildProvenance` in `classify-deep.ts` accepts the new source. Add a new `RetrievalProvenanceSource` variant:
```ts
| {
    type: "sender_history";
    id: string; // agent_drafts.id
    sentAt: string; // ISO
    snippet: string; // <=200 chars of the past reply body
  };
```

Component update for `components/agent/draft-details-panel.tsx` — render a new pill style for `sender_history` (suggest: clock icon, neutral color, label like "self-N · 4/22"). Empty pill state when no history exists.

### Part 2 — Edit-delta capture + writing-style rule extraction (~250 LOC)

#### 2.1 Capture deltas

When the user sends a draft after editing, `approveAgentDraftAction` (in `lib/agent/email/draft-actions.ts`) currently calls `recordSenderFeedback` with `userResponse: "sent"`. Capture the original LLM-drafted body alongside the user-final body when they differ.

Schema-wise, the simplest path: extend `agent_sender_feedback` with two nullable columns:
- `originalDraftBody: text("original_draft_body")` — the LLM's first draft body
- `editedBody: text("edited_body")` — the user's edited body (only when different from original)

Add a `lib/db/migrations/000N_sender_feedback_edit_delta.sql` migration. **Manual migration after merge** per `feedback_prod_migration_manual.md` (sparring runs `pnpm db:migrate` against prod).

When recording feedback at send time:
- Fetch the original `draftBody` snapshot from the latest L2 `runDraft` output (persist on `agent_drafts.draftBody` at L2 time; the user's edit overwrites this via `saveDraftEditsAction` → `agent_drafts.draftBody = edited`. We need to keep BOTH).
- New column `agent_drafts.originalDraftBody` (NEW migration column) that captures the LLM's first body and never gets overwritten by edits.
- At send-time `recordSenderFeedback` reads both `originalDraftBody` + final `draftBody` and persists the pair onto the feedback row when they differ.

#### 2.2 Background learner

New file `lib/agent/email/style-learner.ts`:

- Function `extractWritingStyleRules(userId)`:
  - Reads the last N=20 `agent_sender_feedback` rows where `editedBody IS NOT NULL` for this user.
  - Skips early if N < 5 (insufficient signal).
  - Calls GPT-5.4 (full model — this is a slow path, fine to be expensive) with a prompt: "Given these original-vs-final pairs, extract up to 5 short writing-style rules in the user's voice. Each rule should be a single sentence describing a pattern the user prefers (e.g. 'Use 確認 instead of ご確認', 'Drop trailing よろしく when the recipient is a peer'). Return JSON array of strings."
  - Upserts the extracted rules into `agent_rules` with `scope: "writing_style"`, `matchValue: "*"` (global), `source: "edit_delta_learner"`.
  - The `agent_rules` table already exists; only addition is a new value in the `AgentRuleScope` enum: `"writing_style"`.

- Trigger: a new QStash schedule `/api/cron/style-learner` (cadence: daily, e.g. `0 8 * * *`) per user with ≥5 unprocessed deltas. **Per `feedback_qstash_orphan_schedules.md`, the schedule must be created on Upstash console after deploy** AND the route registered.

#### 2.3 Inject rules into draft prompt

`lib/agent/email/draft.ts` — at draft generation time, load `agent_rules WHERE userId = X AND scope = 'writing_style' AND enabled = true` and inject:
```
## Your writing-style preferences (learned from past edits)

- Use 確認 instead of ご確認.
- Drop trailing よろしく when the recipient is a peer.
- ...
```

#### 2.4 Settings UI

`/app/settings/how-your-agent-thinks` already renders `agent_rules` per existing pattern. Add a "Writing style learned" section: list rules, with a "Remove" button per rule (deletes the row). User can manually correct the learner.

### Part 3 — Voice profile (cold start) (~150 LOC)

#### 3.1 One-shot extraction

New file `lib/agent/email/voice-profile.ts`:

- Function `generateVoiceProfile(userId)`:
  - Calls Gmail API with query `in:sent` to fetch the latest 50 sent messages.
  - Filters out forwards / very short replies (<3 lines) so the sample reflects real user voice.
  - Joins the bodies into one input (cap ~10K chars to bound cost).
  - Calls GPT-5.4 (full) with a prompt: "Summarize this user's writing style across these 50 sent emails. Output as a single 200-character description that captures register (formal / casual), language mix (EN / JA / mixed), typical length, signature pattern, and tone. The description will be injected as a single line into draft-generation prompts. Return as raw string, no markdown."
  - Stores the result in `users.preferences.voiceProfile: string`.

#### 3.2 Trigger paths

- **Onboarding**: after Gmail OAuth connect succeeds, kick off `generateVoiceProfile` async (don't block user). The user's first L2 draft should benefit from it.
- **Manual re-trigger**: button on `/app/settings/connections` ("Re-learn my writing voice"). Calls a new server action `regenerateVoiceProfileAction`. i18n keys + EN/JA strings per pattern from PR #172.

#### 3.3 Inject into draft prompt

`lib/agent/email/draft.ts` — at draft time, read `users.preferences.voiceProfile` and inject:
```
## Your writing voice
{voiceProfile}
```

Above the prior-thread + sender-history blocks. This is the cold-start anchor.

---

## Files

- `lib/agent/email/fanout.ts` — drop `mistakes` from `FanoutResult`, add `senderHistory` source + `loadSenderHistory` (~80 LOC)
- `lib/agent/email/classify-deep.ts` — accept + render `senderHistory` (~30 LOC)
- `lib/agent/email/draft.ts` — accept + render `senderHistory` + `voiceProfile` + `writingStyleRules` (~50 LOC)
- `lib/agent/email/draft-actions.ts` — capture original + edited body at send time (~30 LOC)
- `lib/agent/email/feedback.ts` — extend `recordSenderFeedback` arg shape (~20 LOC)
- `lib/agent/email/style-learner.ts` (NEW, ~120 LOC)
- `lib/agent/email/voice-profile.ts` (NEW, ~120 LOC)
- `lib/db/schema.ts` — add `originalDraftBody` to `agent_drafts`, add `originalDraftBody` + `editedBody` to `agent_sender_feedback`, add `"writing_style"` to `AgentRuleScope` enum, add `voiceProfile` to user preferences shape (~25 LOC)
- `lib/db/migrations/000N_sender_feedback_edit_delta.sql` (NEW, ~10 LOC)
- `app/api/cron/style-learner/route.ts` (NEW, ~80 LOC)
- `app/app/settings/connections/actions.ts` — add `regenerateVoiceProfileAction` (~25 LOC)
- `app/app/settings/connections/page.tsx` — add "Re-learn my writing voice" button (~30 LOC)
- `app/app/settings/how-your-agent-thinks` — show writing_style rules section (~50 LOC)
- `lib/i18n/translations/en.ts` + `ja.ts` — new keys (~15 LOC)
- `components/agent/draft-details-panel.tsx` — render `sender_history` pill (~30 LOC)
- Tests (~250 LOC across multiple test files)

Total: ~1170 LOC. Mega-handoff (precedent: engineer-37 was ~560 LOC; this is roughly 2× that scope, but split into cleanly independent parts).

---

## Tests

New test files:
- `tests/sender-history-fanout.test.ts` — fanout returns past replies to same sender, ordered newest-first, capped at K, filtered to `status='sent'`.
- `tests/style-learner.test.ts` — extracts rules from edit deltas; skips when <5 signal rows; upserts into `agent_rules` with the correct scope.
- `tests/voice-profile.test.ts` — fetches Gmail sent, calls model, persists to `users.preferences.voiceProfile`.

Modified:
- `tests/l2-deep-pass.test.ts` + `tests/l2-orchestrator.test.ts` — assert the new `senderHistory` block is present in the prompt when fanout returns history.
- `tests/edit-delta-capture.test.ts` (NEW) — verify `agent_sender_feedback` row gets `originalDraftBody` + `editedBody` at send time when the user edited.

Aim: 1028 → ~1050+. `pnpm test` + `pnpm tsc --noEmit` clean before opening the PR.

---

## Verification

Per AGENTS.md §13 — `preview_screenshot @ 1440×900` EN+JA. Required:

- `/app/settings/connections` showing the "Re-learn my writing voice" button (EN + JA).
- `/app/settings/how-your-agent-thinks` showing the "Writing style learned" section (likely empty for a fresh user — empty state copy needed).
- Chat smoke (Ryuto's account): reply to the same sender twice through Steadii's flow → verify the second draft's reasoning panel cites a `self-N` source pill.

---

## Out of scope

- **Per-category prompt templates** (Q3 item 4) — separate engineer cycle. The voice profile + writing-style rules cover most of the per-user variance; per-category is a smaller incremental step.
- **LLM re-rank** (Q3 item 5) — same. Wait until measurable variance after Parts 1-3 ship.
- **Mistake-note revival** — Steadii is no longer a tutor (per `project_secretary_pivot.md`). PR #182 dropped mistakes from fanout; do NOT add a `mistakes` source back.
- **Cross-user style sharing / global style memory** — privacy + scope creep.
- **Voice profile auto-refresh on schedule** — for now manual + onboarding only. Quarterly auto-refresh can be added later.

---

## Critical constraints

- **Migration is manual** per `feedback_prod_migration_manual.md`. After merge, sparring runs `pnpm db:migrate` against prod DATABASE_URL (NOT `.env.local`).
- **Style-learner cron schedule** must be created on Upstash console after deploy (per `feedback_qstash_orphan_schedules.md`). PR description must include "Add Upstash schedule for /api/cron/style-learner @ daily 8am" as a manual deploy step.
- **Voice profile cost**: each `generateVoiceProfile` call is ~10K chars input + 200 chars output on GPT-5.4. ~$0.05/run. At onboarding-only + manual re-trigger, that's ~$0.05 per user lifetime. Trivial.
- **Edit-delta capture must not block send**. Wrap the feedback write in try/catch, send-side never errors due to learner write failure.
- **Voice profile + style rules are user-specific** (never injected for a different user). All queries scoped by `userId`.
- **Don't commit changes to `.claude/launch.json`**. Engineer-35 incident — pattern to watch.
- **Vitest can zombie**. `pkill -9 -f vitest` + re-run if hang.

---

## Final report (per AGENTS.md §12)

- Branch / PR: `engineer-38-email-quality`
- New tests: counts per new test file + total test count delta from 1028 baseline.
- Production LOC vs test LOC split.
- Migration applied: confirmation that `pnpm db:migrate` ran against prod (sparring will do this — flag it if engineer can't verify).
- Upstash schedule registered: confirmation that `/api/cron/style-learner` schedule shows up in Upstash console.
- Screenshot pairs: Settings → Connections (re-learn button) EN + JA, Settings → How your agent thinks (style rules section) EN + JA.
- One observed-quality data point: pick a thread Ryuto has already replied to once, generate a second-reply draft via Steadii, capture the draft's reasoning panel showing a `self-N` source pill cited.
- **Memory entries to update**: `sparring_session_state.md` updated by sparring after merge. Optionally lock the L2 prompt structure in `project_decisions.md` if Ryuto wants.

# Engineer-42 — Type F queue cards: interactive Steadii confirmations

**Read user-memory FIRST**:

- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/MEMORY.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_wave_2_home_design.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_secretary_pivot.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_self_capture_verification_screenshots.md`

Reference shipped patterns:

- `lib/agent/queue/build.ts` — queue card builder. New Type F joins A/B/C/E.
- `lib/agent/queue/types.ts` — card type definitions. Engineer-42 adds `QueueCardF`.
- `components/agent/queue-card.tsx` — renderer. New `QueueCardFRender`.
- `app/app/queue-actions.ts` — server actions per card type. New `queueConfirmAction` / `queueCorrectAction`.
- `lib/db/schema.ts` — `agent_confirmations` table (engineer-41 / PR #195).
- `lib/agent/email/l2-tools/queue-user-confirmation.ts` — writes the rows engineer-42 renders.
- `lib/agent/email/l2-tools/lookup-contact-persona.ts` + `agent_contact_personas.structured_facts` — destination when user confirms a tz / language / role fact.

---

## Strategic context

Engineer-41 shipped the brain side: the agentic L2 loop writes rows to `agent_confirmations` when it infers something with low confidence (e.g. "this sender is in JST, 0.85 confidence"). The rows just sit there — no UI yet.

Engineer-42 renders these as **Type F queue cards** on `/app` Home. When user answers (confirm / correct / dismiss), the answer flows back to:

1. `agent_confirmations.status` flips to `confirmed` / `corrected` / `dismissed`
2. `agent_contact_personas.structured_facts.<topic>` updates with the user-confirmed value at confidence 1.0 + `confirmedAt: now()`
3. (optional) trigger a regenerate of any draft that was waiting on the answer

This is the "**ambiguity → ask, not assume**" loop Ryuto articulated as the core of human-secretary behavior.

---

## Setup

```bash
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
```

Most recent commit: PR #195 (engineer-41 / agentic L2). If main is behind, **STOP**.

Branch: `engineer-42-type-f-cards`. Don't push without Ryuto's explicit authorization.

---

## What changes

### Part 1 — Queue card type definition (~80 LOC)

`lib/agent/queue/types.ts`:

```ts
export type QueueCardF = {
  id: string;                          // `confirmation:<uuid>`
  archetype: "F";
  title: string;                       // LLM-generated, e.g. "アクメトラベルの本社は JST ですよね?"
  body: string;                        // context: where the inference came from
  confidence: QueueConfidence;         // map from inferred value confidence
  createdAt: string;
  sources: QueueSourceChip[];          // optional citations from the originating L2 run
  topic: ConfirmationTopic;            // "timezone" | "sender_role" | "primary_language" | "relationship" | "other"
  senderEmail: string | null;
  inferredValue: string | null;
  options: ConfirmationOption[];       // structured choices (yes / no / custom)
  originatingDraftId: string | null;   // deep-link back to the draft that triggered the question
};

export type ConfirmationTopic =
  | "timezone"
  | "sender_role"
  | "primary_language"
  | "relationship"
  | "other";

export type ConfirmationOption = {
  key: string;                         // "confirm" | "correct" | "dismiss" | custom
  label: string;                       // localized
  type: "confirm" | "correct" | "dismiss";
};
```

Add `F` to the discriminated union of all card types.

### Part 2 — Queue builder fetches confirmations (~150 LOC)

`lib/agent/queue/build.ts`:

- New `fetchPendingConfirmations(userId, locale)` — joins agent_confirmations + (when originatingDraftId set) inbox_items for context.
- Filters: `status = 'pending'` AND created_at within last 14 days (stale ones auto-dismiss).
- Returns rows mapped to `QueueCardF`.
- Slots into the existing `Promise.all` alongside proposals / drafts / pre-briefs / office_hours.

Sort priority: Type F cards interleave with Type A by `createdAt` (newest-first within type). They appear above Type B / C / E because pending interactions block downstream draft generation.

### Part 3 — Type F renderer (~200 LOC)

`components/agent/queue-card.tsx`:

- New `QueueCardFRender({ card, onConfirm, onCorrect, onDismiss })`:
  - Header: gradient-tinted icon (suggest: `MessageCircleQuestion` from lucide-react)
  - Title in larger weight (it's a question)
  - Body shows the inference context
  - Options laid out as buttons:
    - Primary: "✓ {label}" (e.g. "JST で確定")
    - Secondary: "違う tz を入力" → opens an inline text input
    - Tertiary: "聞かないで" (dismiss permanently)
  - On confirm: optimistic UI (collapse to `resolved`), then server action
  - On correct: collect text input, server action
  - On dismiss: server action

i18n keys: `queue.card_f.confirm`, `queue.card_f.correct`, `queue.card_f.dismiss`, `queue.card_f.correct_placeholder`, etc.

### Part 4 — Server actions (~150 LOC)

`app/app/queue-actions.ts`:

- `queueConfirmAction(cardId)`:
  1. Parse `confirmation:<uuid>` → row id
  2. UPDATE `agent_confirmations` SET status='confirmed', resolved_value=inferred_value, resolved_at=NOW()
  3. UPDATE `agent_contact_personas.structured_facts.<topic>` SET value, confidence=1.0, confirmedAt=NOW()
  4. revalidatePath("/app")

- `queueCorrectAction(cardId, correctedValue)`:
  1. Same parse
  2. UPDATE `agent_confirmations` SET status='corrected', resolved_value=correctedValue, resolved_at=NOW()
  3. UPDATE persona structured_facts with the corrected value at confidence 1.0
  4. revalidatePath

- `queueDismissAction` (existing) — extend to handle `confirmation:` prefix:
  - UPDATE status='dismissed' (no persona write — user said "don't ask me")

Idempotency: status check on entry so a double-click doesn't double-write.

### Part 5 — Wire into QueueList (~50 LOC)

`components/agent/queue-list.tsx`:

- Add `confirm: (cardId) => Promise<void>` and `correct: (cardId, value) => Promise<void>` to ServerActions type
- Pass through to `QueueCardFRender`

### Part 6 — Settings → "Questions Steadii is asking" (~80 LOC)

`/app/settings/how-your-agent-thinks/page.tsx`:

- New section showing all pending + recently-resolved confirmations
- Per-row: question + inferred value + resolved value (if any) + status pill + "delete" button
- Lets the user revisit answers after the fact

i18n keys for the section.

### Part 7 — Tests (~250 LOC)

- `queue-build-confirmations.test.ts` — fetchPendingConfirmations returns mapped rows; stale (>14d) filtered out; respects user scope
- `queue-confirm-action.test.ts` — confirm path writes structured_facts + flips status; idempotent on double-click
- `queue-correct-action.test.ts` — correct path persists user value
- `queue-card-f-render.test.tsx` — server-rendered markup contains question + 3 buttons

---

## Files

- `lib/agent/queue/types.ts` — QueueCardF + ConfirmationTopic + ConfirmationOption (~80 LOC)
- `lib/agent/queue/build.ts` — fetchPendingConfirmations + interleave (~150 LOC)
- `components/agent/queue-card.tsx` — QueueCardFRender (~200 LOC)
- `components/agent/queue-list.tsx` — wire props (~50 LOC)
- `app/app/queue-actions.ts` — queueConfirmAction + queueCorrectAction + queueDismissAction extension (~150 LOC)
- `lib/agent/email/l2-tools/queue-user-confirmation.ts` — verify schema matches the rows engineer-41 writes; no-op if already aligned
- `app/app/settings/how-your-agent-thinks/page.tsx` — Questions section (~80 LOC)
- `app/app/settings/how-your-agent-thinks/actions.ts` — deleteConfirmationAction (~30 LOC)
- `lib/i18n/translations/en.ts` + `ja.ts` — keys (~30 LOC each)
- Tests (~250 LOC)

Total: ~1050 LOC.

No new schema (engineer-41's 0035 already has `agent_confirmations`). No new cron.

---

## Tests

Aim: 1126 → ~1150+. `pnpm test` + `pnpm tsc --noEmit` clean before PR.

---

## Verification

Per AGENTS.md §13:

- `/app` showing a Type F card EN + JA (use a manually-inserted row via SQL Editor if no real one yet)
- Settings → How your agent thinks → "Questions Steadii is asking" section EN + JA
- Click "confirm" → card collapses, `structured_facts.timezone` updated in DB
- Click "correct" → inline input appears, submit persists user value
- Click "dismiss" → status='dismissed', card disappears, persona untouched

---

## Out of scope

- **Auto-regenerate drafts** when an underlying confirmation resolves — that's an engineer-43 nice-to-have. For now, the next L2 invocation reads the confirmed fact.
- **Confirmation request from places other than agentic L2** (e.g. proactive scanner) — extensions for later cycles.
- **Bulk-confirm UI** — if Steadii asks 5 questions at once, user clicks each individually for v1.

---

## Critical constraints

- **No migration** in this engineer. Engineer-41 already shipped the table.
- **Idempotency**: confirm/correct/dismiss actions guard on `status='pending'` before write so double-click is a no-op.
- **Persona structured_facts upsert**: read existing structured_facts blob, set the targeted key, write back — don't clobber other keys.
- **Don't commit changes to `.claude/launch.json`**.
- **Vitest can zombie** — `pkill -9 -f vitest` if hung.

---

## Final report (per AGENTS.md §12)

- Branch / PR
- Tests delta from 1126 baseline
- Screenshot pairs EN + JA
- Smoke test: insert a fake `agent_confirmations` row via SQL → verify renders correctly → click confirm → verify DB updates
- Memory updates handled by sparring post-merge.

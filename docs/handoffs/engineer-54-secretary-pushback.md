# Engineer-54 — Secretary push-back capability (slot feasibility + counter-proposal patterns)

**Read user-memory FIRST**:

- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/MEMORY.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_agent_failure_modes.md` — you'll add two new entries
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/user_ryuto.md` — canonical fixture user (Vancouver-based)
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_steadii.md` — Steadii's pitch is "ChatGPT picks the slot. Steadii pushes back when the slot doesn't fit you." This wave delivers that promise.
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_typecheck_before_push.md` — typecheck before every push

Read engineer-53 first — this wave builds on it. Order: engineer-53 → engineer-54.

Reference shipped patterns:

- `lib/agent/prompts/main.ts` — system prompt. TIMEZONE RULES (~154), OUTPUT GROUNDING (~108). engineer-53's EMAIL REPLY MUST-rule lives in this file.
- `lib/agent/tools/convert-timezone.ts` (PR #212) — the TZ converter. Already feeds into draft generation.
- `lib/agent/tools/infer-sender-timezone.ts` (PR #226) — sender TZ inference with body-language signal.
- `lib/agent/tools/user-facts.ts` + `save_user_fact` (PR #216 / engineer-47) — free-form fact storage. THIS WAVE adds a semi-structured field on top.
- `lib/agent/email/agentic-l2.ts` + `agent_contact_personas` (PR #195 / engineer-41) — per-contact structured_facts blob. You'll extend the schema.
- `lib/db/schema.ts` `users.preferences` — JSON column already used for `agenticL2`, `autoArchiveEnabled` etc. Adding `working_hours_local` here fits the existing pattern.
- `tests/agent-evals/scenarios/` (PR #232 / engineer-52) — eval harness. Adds 3 new scenarios for this wave.
- `lib/agent/orchestrator.ts` self-critique (PR #230 + PR #235) — leak detection + retry-with-tools. New detectors get added in this wave.

---

## Strategic context — what this wave delivers

Steadii's core differentiation versus ChatGPT and other AI assistants is **proactive secretarial reasoning**, not just text generation. The 2026-05-13 dogfood made this explicit. Ryuto manually replied to a アクメトラベル interview-slot email. The recruiter wrote back with two alternative slots — both in JST:

- 2026/5/20 (水) 18:00–18:45 JST → **PDT 02:00–02:45 (Tue 2 AM Vancouver)**
- 2026/5/21 (木) 15:00–15:45 JST → **PDT 23:00–23:45 (Tue 11 PM Vancouver)**

A human secretary in this situation would:
1. **Recognize** that both slots land in the user's night
2. **Reference** that the user has previously chosen evening-Pacific slots (8–10 PM PT range)
3. **Push back politely**, naming the reason ("these slots are 2 AM and 11 PM for me; could we explore earlier in your day?") and counter-proposing a window that converts back to a reasonable Pacific time

The current agent **does none of this**. It would either auto-accept one of the slots or write a placeholder draft. The push-back capability is the layer this wave adds.

Distinct from engineer-53:
- **Engineer-53** = "draft correctly" — no leaks, real names, real slots, no fabricated 件名
- **Engineer-54** = "draft INTELLIGENTLY" — feasibility check, past-pattern grounding, push-back when proposed slots don't fit

---

## Scope — build in order

### Part 1 — `users.preferences.workingHoursLocal` schema + onboarding

Add a typed field to the existing `users.preferences` JSONB column:

```typescript
// In lib/db/schema.ts — UsersPreferences type
type UsersPreferences = {
  // ... existing fields (agenticL2, autoArchiveEnabled, etc.)
  workingHoursLocal?: {
    start: string; // "HH:MM" 24h, in the user's profile TZ
    end: string;   // "HH:MM" 24h, in the user's profile TZ
    // tz field intentionally omitted — derived from users.timezone, single
    // source of truth. If user travels and their timezone changes, the
    // window auto-follows.
  };
};
```

No migration needed (JSONB column already exists). Add a Zod schema for validation at the API boundary.

**Onboarding**: when the agent is asked to draft a reply involving slot acceptance AND `workingHoursLocal` is not set, the agent MUST ask once before drafting: "What time of day works for you for meetings? e.g., 9 AM–9 PM Pacific. I'll remember this." On user answer, save via a new `save_working_hours` tool (write tier — requires confirmation? or auto-saves since it's user-volunteered preference? Lean: auto-save without confirm, surface a 1-line "saved your working hours" message). Once set, never asks again unless user updates it.

UI: `/app/settings` gets a new "Working hours" section under existing preferences. Pre-populated from the agent's saved value; user can edit. Save patches `users.preferences.workingHoursLocal`.

### Part 2 — Prompt: SLOT FEASIBILITY CHECK

Add a new section to `lib/agent/prompts/main.ts`, AFTER `TIMEZONE RULES` and BEFORE `SCHEDULING DOMAIN RULES`:

```text
SLOT FEASIBILITY CHECK (when drafting acceptance of proposed times)

Before composing acceptance language for any proposed time slot:

1. Convert each proposed slot to the user's local TZ (via convert_timezone).
2. Look up users.preferences.workingHoursLocal. The value is { start: "HH:MM", end: "HH:MM" } in the user's profile TZ.
3. For each slot's USER-LOCAL time, check whether it falls within [start, end]. A slot whose start time is at 02:00 user-local while working hours are 09:00–22:00 is INFEASIBLE.
4. If ALL proposed slots are infeasible → draft a counter-proposal (see COUNTER-PROPOSAL PATTERN below). Do NOT accept one and hope for the best.
5. If SOME slots are feasible → accept among the feasible subset. State explicitly that the other slot(s) were skipped due to time-of-day mismatch.
6. If workingHoursLocal is NOT SET → before drafting, ASK the user once: "Could you tell me what time of day works for you? e.g., 9 AM–9 PM Pacific. I'll remember it." Then save via save_working_hours. Do not silently default to "all hours are fine".

The point: a slot that crosses the user's sleep window is not "doable but tight" — it's INFEASIBLE without an explicit user override. Drafting acceptance of a 2 AM meeting is a failure mode (LATE_NIGHT_SLOT_ACCEPTED_BLINDLY).
```

### Part 3 — Prompt: COUNTER-PROPOSAL PATTERN

Add immediately after SLOT FEASIBILITY CHECK:

```text
COUNTER-PROPOSAL PATTERN (when no proposed slot fits)

When all proposed slots are infeasible (Part 2 step 4), draft a polite counter-proposal:

1. Acknowledge the proposal ("ご提案ありがとうございます" / "Thanks for the alternatives")
2. State PLAINLY which slots don't work and WHY, citing the user-local time:
   - GOOD: "5/20 18:00 JST はバンクーバー時刻で 2:00 AM になってしまい、ご対応が難しいです"
   - BAD: "ご提示いただいた日程ですと、ご対応が難しい状況です" (vague — no reason cited)
3. Propose an alternative WINDOW (not a single slot) framed in the SENDER'S TZ, derived from the user's working hours:
   - User working hours = 09:00–22:00 Pacific
   - Convert this window back to sender TZ → e.g. 01:00 next-day–14:00 JST
   - Express as something tractable: "JST の 9:00–14:00 帯 / 21:00–24:00 帯であれば調整しやすいです"
4. If a PAST PATTERN exists (Part 4), reference it: "as before, weekday evenings PT (mornings JST) work well"
5. Sign-off uses the user's actual name (engineer-53 rule).

The draft is a NEGOTIATION OPENING, not a rejection. Tone matters — the sender invested effort in proposing slots; the counter-proposal should acknowledge that explicitly.
```

### Part 4 — Prompt: PAST PATTERN GROUNDING

Add as a separate small section. Triggers when drafting acceptance OR counter-proposal:

```text
PAST PATTERN GROUNDING (use prior choices on this entity to ground the draft)

When drafting any slot-related reply on a known entity:

1. Call lookup_entity to find prior threads with this sender/org.
2. Follow recentLinks → email_get_body on the most recent 1-2 prior REPLIES the user sent (not received).
3. Extract what slot times the user previously chose. Convert all to user-local TZ for comparison.
4. If a pattern is visible (e.g. "always picks evenings local 19:00–22:00"), surface it once in the draft: "前回も Pacific 夕方帯でお願いしたのと同じく…" / "consistent with previous slots I've taken from your team…".
5. Do NOT invent a pattern from a single data point. ≥2 prior choices needed.

This is the secretary's memory at work — the user shouldn't have to re-state their preferences each round.
```

### Part 5 — Tool: `save_working_hours`

New tool in `lib/agent/tools/user-facts.ts` (or a new file):

```typescript
// Schema
{
  name: "save_working_hours",
  description: "Save the user's working/meeting-available hours. Use when the user states their availability window (e.g. '9 AM to 10 PM Pacific') or in response to your own ask. Saves to users.preferences.workingHoursLocal.",
  mutability: "write",
  parameters: {
    start: { type: "string", description: "Start time in HH:MM 24h, user's profile TZ" },
    end:   { type: "string", description: "End time in HH:MM 24h, user's profile TZ" },
  }
}
```

Confirmation behavior: **auto-save**. This is a low-stakes preference, not a destructive action; the user just told the agent their availability, no point making them confirm again. The chat UI surfaces a 1-line "saved your working hours: 9:00–22:00 Pacific" so the action is visible.

Schema validation: enforce `start < end` (no overnight windows — if the user works overnight, they need to specify e.g. 22:00–06:00 and we treat it as two windows). For α: simple non-overnight only. Overnight support is post-α polish.

### Part 6 — Self-critique detector extensions

`lib/agent/self-critique.ts` — add:

```typescript
// LATE_NIGHT_SLOT_ACCEPTED_BLINDLY — heuristic detector for drafts that
// accept a slot without mentioning user-local time when the sender TZ
// is in `lib/agent/email/sender-timezone-heuristic.ts`'s known cross-
// TZ set. The detector is loose (false-positive-tolerant) since the
// retry pass can correct.
{
  name: "slot acceptance missing user-local TZ",
  pattern: /(ご提示いただいた日程|the proposed (slot|time)).+(参加可能|可能です|works for me|sounds good|問題なく)/i,
  // Only fires when the response is a draft (heuristic: contains
  // "件名は不要" check OR draft block markers). False positive on
  // non-slot replies is tolerable; the retry pass can prove it's clean.
},

// WORKING_HOURS_IGNORED — draft mentions slot times but no comparison
// to user_local. Detector: if the response contains a JST time AND no
// "PT" / "PDT" / "PST" / "user TZ" mention within 80 chars, suspect.
// Skipped for now if the existing TIMEZONE RULES dual-display check
// already handles this — verify before adding to avoid double-counting.
```

Add corresponding unit tests in `tests/self-critique.test.ts`.

### Part 7 — Eval scenarios

Three new files in `tests/agent-evals/scenarios/`:

**`late-night-slot-pushback.ts`** — exact fixture from Ryuto's 2026-05-13 dogfood:
- Email body: アクメトラベル round 2 (the alternative slots 5/20 18:00 JST + 5/21 15:00 JST)
- Prior thread state: Ryuto's first reply (with his 3 chosen slots, all PT 20:00–22:00 range)
- `users.preferences.workingHoursLocal = { start: "08:00", end: "22:00" }` (Vancouver TZ)
- User message: "アクメトラベル の二回目のメールに返信したい"
- Assertions:
  - `tool_called: convert_timezone` (≥2 times — one for each proposed slot)
  - `response_contains: "2 AM"` OR `"2:00"` (the converted Vancouver time — user-local cited)
  - `response_does_not_match: /(参加可能|sounds good|works for me).*5\/20/i` (didn't blindly accept)
  - `response_matches: /(難しい|cannot|wouldn't work)/i` (acknowledged infeasibility)
  - `response_matches: /(JST の|in your time|JST).*[0-9]{1,2}:[0-9]{2}/i` (proposed alternative window in sender TZ)
  - custom: contains a reference to PAST PATTERN if prior thread present

**`feasible-and-infeasible-mix.ts`** — one of the proposed slots IS in working hours, one isn't:
- Assertions: agent accepts the feasible one, explicitly mentions the other was skipped

**`working-hours-unset-asks-once.ts`** — fixture has `workingHoursLocal` undefined:
- Assertions: response asks for working hours, no draft generated yet, doesn't proceed without the data

Update `tests/agent-evals/scenarios/index.ts` to register all three.

### Part 8 — `feedback_agent_failure_modes.md` taxonomy

Add two new entries:

```markdown
### `LATE_NIGHT_SLOT_ACCEPTED_BLINDLY`

**Shape:** Agent drafts acceptance of a proposed time slot without
checking whether the slot falls within the user's working/available
hours. Result: the user is committed to a 2 AM meeting because the
agent only saw "valid date in JST" and not "infeasible in user-local".

**Root cause:** Agent has convert_timezone but no instruction to apply
the result against a known availability window. The user's working
hours weren't checked because (a) they weren't in user_facts before
engineer-54, and (b) no prompt rule required the comparison.

**Fix:** SLOT FEASIBILITY CHECK prompt rule (PR #NNN — engineer-54).
self-critique heuristic detector catches drafts missing user-local
time references.

### `WORKING_HOURS_IGNORED`

**Shape:** Agent has access to users.preferences.workingHoursLocal
but composes a draft that ignores it — e.g. proposes a counter-window
that's still inside the sender's day but outside the user's evening
preference.

**Root cause:** Prompt loads the preference but does not gate the
draft on it.

**Fix:** SLOT FEASIBILITY CHECK + COUNTER-PROPOSAL PATTERN (engineer-54).
Eval scenarios assert that the draft's proposed window converts back
to within the user's working hours.
```

Also add a `### THREAD_ROLE_CONFUSED` entry (carry-over from engineer-53 scope discussion):

```markdown
### `THREAD_ROLE_CONFUSED`

**Shape:** Agent reads an email body that includes quoted prior
messages (lines prefixed with `>`) and treats the quoted text as new
content, or attributes the user's prior reply to the wrong party.

**Root cause:** No explicit prompt rule for thread role parsing.
Models usually infer correctly but slip on long quoted chains or
nested quotes.

**Fix:** THREAD ROLE PARSING prompt section — engineer-53 if a
section is added, otherwise engineer-54 as a small add-on. Detector
optional (hard to regex reliably).
```

---

## Setup

```bash
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
git checkout -b engineer-54
```

## Verification

- `pnpm typecheck` clean
- `pnpm test` — full suite green, ~+18 new unit tests (preference schema, save_working_hours, self-critique detectors)
- `pnpm eval:agent` — all scenarios pass live, including the 3 new ones. Cost ~\$0.02/run.
- Manual: re-run the アクメトラベル round-2 dogfood scenario; expected: agent calls `convert_timezone` on both slots, recognizes both are night Pacific, drafts a counter-proposal with concrete alternative window in JST, references the prior-pattern if visible.

## Out of scope

- Overnight working-hours windows (e.g. someone who works 22:00–06:00). α users are students with normal day schedules; defer.
- Multi-TZ travel (user's working hours follow `users.timezone`; if user travels their timezone needs to update first — separate flow).
- Automated meeting placement (agent picks a specific time from the proposed window without asking) — that's the Tier-2 auto-execute roadmap (`project_agent_model.md`), not this wave.
- Calendar-conflict checking BEYOND working hours — `check_availability` already exists, but layering it in to the counter-proposal is engineer-55 polish.

## Memory entries to update on completion

- `feedback_agent_failure_modes.md` — three new entries above (`LATE_NIGHT_SLOT_ACCEPTED_BLINDLY`, `WORKING_HOURS_IGNORED`, `THREAD_ROLE_CONFUSED`)
- Reference the scenario files in each entry per the convention introduced by engineer-52's PR #232

## Dependency on engineer-53

This wave assumes engineer-53 has landed:
- EMAIL REPLY MUST-rule (email_get_body required before drafting)
- Real-name sign-off
- No fabricated 件名 line
- User real name injected into system prompt

If engineer-53 hasn't landed: do NOT proceed with engineer-54. The push-back logic only works when the draft itself is correctly grounded; otherwise we'd be layering intelligence on top of placeholder leaks.

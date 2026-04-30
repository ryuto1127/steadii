# Feat — Voice input Phase 2 (academic context cleanup + auto-shorten)

Continuation of Phase 1 ([PR #97](https://github.com/ryuto1127/steadii/pull/97), shipped 2026-04-29). Picks two locked items from `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_voice_input.md` "Steadii's unique moat (vs Wispr Flow / VoiceOS / etc.)" section: **#1 (academic context cleanup)** + **#3 (auto-shorten for long voice msgs)**.

Tone switching by destination (#2 in that section), global hotkey, and landing voice scene are deliberately **out of scope** for this handoff — they require destination surfaces / UX design that don't exist yet. Will be bundled into a later handoff once those surfaces land. See sparring memory `feedback_handoff_sizing.md` for the rationale (premature abstraction without callers).

## Setup

```
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
git status
git log --oneline -5
git checkout -b feat-voice-input-phase2
```

Branch: `feat-voice-input-phase2`. Don't push without Ryuto's explicit authorization.

Read `AGENTS.md` first (especially §12 — your final report MUST include "Memory entries to update").

---

## Item A — Academic context awareness in cleanup

### Goal

Cleanup pass benefits from knowing the user's classes / professors / recent chat topics. STT garbles like "マット223" → "MAT223" should resolve with high confidence when MAT223 is one of the user's classes. Topic accuracy improves when recent chats establish context.

### Implementation

1. **Fetch user context** in `lib/voice/cleanup.ts` `cleanupTranscript()` before the OpenAI call:
   - User's active classes from `classes` table where `userId = args.userId`, `status = 'active'`, `deletedAt IS NULL`. Pull `code`, `name`, `professor`. Limit ~10 most recent.
   - Recent chat titles: `chats.title` for the user's last ~5 chats (excluding null titles). This is a cheap proxy for "what they've been talking about".
   - Both queries should be a single round-trip if possible (parallelize via `Promise.all`).

2. **Format context** as a structured block. Example:
   ```
   USER ACADEMIC CONTEXT (use to disambiguate proper nouns / topics):
   Classes:
   - MAT223 — Linear Algebra I (Prof. Smith)
   - CSC110 — Introduction to Computer Science (Prof. Lee)
   Recent chat topics: midterm review, lab 4 submission, calendar booking
   ```
   Skip blocks that are empty (no classes / no titles). If both are empty, skip the entire context section — fall back to phase 1 behavior.

3. **Prompt structure** — preserve cacheability:
   - Keep `VOICE_CLEANUP_SYSTEM_PROMPT` as the **stable prefix** (universal across all users; OpenAI will auto-cache when it exceeds 1024 tokens).
   - Append the user-specific context as a **second system message**, NOT concatenated into the universal prompt. This way only the variable part changes per user; the prefix caches.
   - Updated rule wording inside the universal prompt: rule #6 already covers "preserve proper nouns / course codes verbatim, correct STT garbles to canonical form when confident" — extend it to "use USER ACADEMIC CONTEXT below as the canonical-form reference when present". Do NOT rewrite the prompt — add a single sentence to rule #6.

4. **Function signature** — `cleanupTranscript` keeps the same shape externally. Internal: add a `userContext` build step that returns `{ classesBlock?: string; topicsBlock?: string }` → assembled into the second system message.

5. **Caching note**: when context is empty (new user, no classes), skip the second system message entirely. This way the original cacheable single-system-message path still works for those users.

### Cost / token impact

Adding ~80-200 tokens to system per call. At Mini pricing ($0.75/1M input), that's +$0.00006-0.00015 per call. Negligible. Already accounted for in the `voice_cleanup` 0-credit policy — keep it 0 credit.

### Tests

- Unit: `cleanupTranscript` with mocked OpenAI verifies user context block is included when classes/chats exist, omitted when empty.
- Unit: prompt structure has stable universal system message + variable second system message (assert via captured `messages` array).
- Integration: `/api/voice` end-to-end with a seeded user (1 class, 1 chat) — assert response is consistent with cleanup hitting the context.

---

## Item B — Auto-shorten for long voice msgs

### Goal

For recordings >30s, the user probably rambled ("explain everything that happened today"). Surface a two-option choice: send full cleaned transcript, or send a shortened summary. User picks; chosen text inserts to the input.

### Implementation

1. **Server change** — in `app/api/voice/route.ts`:
   - After the cleanup pass, check `durationSec`. If `>= 30`, make a SECOND Mini call to produce a shortened summary. New prompt (locked content below, add to `lib/voice/cleanup-prompt.ts`):

     ```
     export const VOICE_SHORTEN_SYSTEM_PROMPT = `You receive a clean voice transcript from a university student. Produce a shorter version that preserves the request / question / decision exactly but cuts elaboration, repetition, and tangential context.

     RULES:
     1. Preserve the actionable core: the question, request, decision, or commitment.
     2. Drop background narration, tangents, and repeated points.
     3. Same language and tone as input. Do not translate or shift register.
     4. Target ~30-50% of input length. If the input has no fluff (already concise), return it unchanged.
     5. Output ONLY the shortened text. No explanation, no preamble.`;
     ```

   - Response shape extends to include `shortened?: string` when applicable:
     ```ts
     { cleaned, transcript, durationSec, cleanupSkipped, shortened?: string }
     ```
   - Failure of the shorten call should NOT fail the request — return `cleaned` only, log a soft warning.

2. **Client UX** — extend `components/chat/use-voice-input.ts` and the calling components:
   - When the response includes `shortened` and it differs from `cleaned`, surface a small inline two-option chooser **above the chat input** (NOT a blocking modal — modals would break the "ephemeral / no UI" voice aesthetic).
   - Chooser visual: two pill buttons side-by-side, muted background, low chrome:
     - `Send full (~N words)` → inserts `cleaned` to input
     - `Send short (~M words)` → inserts `shortened` to input
   - Auto-dismiss the chooser after either button is clicked, or after 8s of inaction (default = full insert).
   - Discoverability: this is a transient surface; no persistent UI when no recent recording.

3. **State** — add a transient `pendingChoice: { cleaned: string; shortened: string } | null` to the hook's return shape. The component renders the chooser when this is non-null.

### Tests

- Unit: server returns `shortened` only when duration ≥ 30s; absent when < 30s.
- Unit: shorten call failure doesn't fail the parent request.
- Component: chooser renders with two options, click inserts the chosen text, auto-dismiss after 8s.

---

## Cost metering

- **Item A** adds ~$0.0001/call to existing `voice_cleanup` task. Stays 0 credit.
- **Item B** adds a second Mini call for >30s recordings. Roughly doubles cost on those (still ~$0.0008/call). Log this as the same `voice_cleanup` task type — analytics rolls up via `usage_events.metadata` if needed.

## Out of scope (deferred to next handoff)

- Tone switching by destination (#2 from project memory) — needs destination surfaces (email draft, etc.) which don't exist yet
- Global hotkey from any screen — needs trigger key choice + scope decision
- Landing voice scene / voice agent overlay — needs UX design + Figma
- Polish items from the Phase 1 UX spec not yet realized

These items will be re-considered in a follow-up handoff once destination surfaces are designed.

## Constraints

- Locked decisions in `project_voice_input.md` are sacred — Whisper batch / Mini / hold-to-talk / cleanup prompt structure are NOT to re-decide
- Pre-commit hooks must pass; no `--no-verify`
- Conversation Japanese; commits + PR body English
- Don't push without Ryuto's explicit authorization
- Do NOT add a `destination` parameter to `/api/voice` "for future use" — wait until item #2's surfaces actually exist (premature abstraction)

## Verification plan

1. `pnpm typecheck` — clean (modulo pre-existing `tests/handwritten-mistake-save.test.ts` arity errors on `main`)
2. `pnpm test` — green (modulo pre-existing `tests/inbox-detail-old-shape.test.ts` "Why this draft" failure on `main`)
3. Manual smoke (Ryuto, post-merge):
   - User with classes seeded → voice "MAT223 のレポート due tomorrow" → cleaned text correctly preserves "MAT223" verbatim
   - User WITHOUT classes seeded → cleanup still works (context-empty fallback path)
   - Hold trigger >30s → after release, two-option chooser appears above input
   - Click "Send short" → shortened text inserts; click "Send full" → cleaned text inserts
   - Chooser auto-dismisses after 8s with default = full insert
   - Recording <30s → no chooser, behaves like Phase 1
   - Whisper or shorten failure mid-flow → graceful fallback, no crash

## When done

Per AGENTS.md §12, your final report MUST include "Memory entries to update":

- `project_voice_input.md` — flip status section to "Phase 1 + Phase 2 (items 1, 3) shipped 2026-04-29". Add commit hash. Note any deviations from locked design.
- `project_voice_input.md` — under "Steadii's unique moat" section, mark items #1 and #3 as shipped, leave #2 as deferred.

Plus standard report bits.

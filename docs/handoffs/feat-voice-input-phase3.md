# Feat — Voice input Phase 3 (global hotkey + chat overlay + landing voice scene)

Continuation of Phase 1 ([PR #97](https://github.com/ryuto1127/steadii/pull/97)) + Phase 2 ([PR #98](https://github.com/ryuto1127/steadii/pull/98)). Closes the voice work for α: Caps Lock works from anywhere on every Steadii app page (tap = chat overlay, hold = voice), and the public landing page reflects the "Type and Talk 50/50" positioning.

Strategic locks (do NOT re-spar): Whisper batch + Mini cleanup, hold-to-talk Caps Lock trigger, "Listening to Steadii" UX (no mic button, no waveform), holographic palette. All in `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_voice_input.md`.

## Setup

```
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
git status
git log --oneline -5
git checkout -b feat-voice-input-phase3
```

Branch: `feat-voice-input-phase3`. Don't push without Ryuto's explicit authorization.

Read `AGENTS.md` first (especially §12 — your final report MUST include "Memory entries to update").

---

## Item A — Caps Lock interaction model (tap / hold / dismiss)

Phase 1 hijacked Caps Lock only when chat input was focused. Phase 3 extends to **every Steadii app page** with a unified tap/hold model:

| Caps Lock action | Behavior |
|---|---|
| Tap (<250ms) — chat overlay closed | Open summonable chat overlay (Cmd+K-style popup) |
| Tap (<250ms) — chat overlay open | **Close the overlay** (re-tap = toggle close) |
| Hold (≥250ms) while chat input focused | Phase 1 voice — text → cleanup → insert (existing behavior, unchanged) |
| Hold (≥250ms) while chat input NOT focused | Global agent voice — transcript routed through agent |

ESC also closes the overlay (backup; Caps Lock re-tap is the canonical close per Ryuto).

### Tap vs hold detection

Same mechanism as Phase 1:

1. `event.preventDefault()` on `keydown` for `code === "CapsLock"` (suppresses OS toggle).
2. Record `keydownAt = Date.now()` on first keydown (skip if `event.repeat`).
3. On `keyup`: compute `heldMs = Date.now() - keydownAt`.
4. If `heldMs < 250`: dispatch `tap` action.
5. If `heldMs >= 250`: voice flow (existing 500ms `RECORDING_MIN_MS` silent-abort still applies for the 250-500ms middle zone).

AltRight fallback (Phase 1's auto-detected fallback) extends to both tap and hold.

### Caps Lock universal hijack — design trade-off

This handoff makes Caps Lock universally hijacked on all `/app/*` pages, not just chat input. Users on a Settings page tapping Caps Lock get the chat overlay, not OS Caps Lock toggle. Trade-off accepted: most users use Shift for capitals; the discoverability hint sets the expectation explicitly. Public landing pages (`/`, `/login`, etc.) are NOT in scope for this hijack — only authenticated `/app/*` pages.

### Refactor opportunity (engineer's judgment)

Current `use-voice-input.ts` owns both keyboard and voice. Splitting into a `useGlobalCapsLock` event emitter consumed by `use-voice-input` (existing) + `useChatOverlay` (new) + `useGlobalAgentVoice` (new) is cleaner. Engineer can also keep monolithic if the refactor exceeds 0.5d — user-facing behavior is what matters.

---

## Item B — Chat overlay (summonable popup)

Visual:
- Backdrop: `bg-black/30 backdrop-blur-sm`
- Card: rounded, `bg-[hsl(var(--surface))]`, shadow, padding. Centered or top-third positioned.
- Inside: a chat input visually identical to the home composer (re-use `<NewChatInput>` or its visual twin). Caps Lock hold inside the overlay's input is Phase 1 voice (text → cleanup → insert into the overlay's input).
- Auto-focus the input on open.
- Animation: 200ms ease-out fade + scale-up on open, 150ms fade on close.

Close triggers:
- Caps Lock tap (canonical, per Ryuto)
- ESC key (backup)
- Click outside the card (backdrop click)

Submit:
- Empty: no-op
- Non-empty: post to existing chat-creation endpoint (or current chat if user came from one — engineer's call). Prefer **keeping the overlay open** and rendering the agent's response inline below the input (instant feel). Saves as a normal chat, accessible later via chat history.
- After response renders, the input clears so user can continue or close.

---

## Item C — Global agent voice (Caps Lock hold from any page)

### Visual

Caps Lock keypress isn't bound to a focused element. Render a transient holographic-bordered "voice indicator" pill near top-center of the viewport:
- Same palette as Phase 1 (cyan / magenta / lime breathing, 1.5-2s cycle)
- Inner text: italic muted "Listening..."
- During processing: amber-tinted variant (matches Phase 1 processing state)
- Auto-hides on completion / cancellation
- Fixed position, z-index above page content but below modals

### Pipeline

1. Voice transcript → existing `/api/voice` (no API change needed at the cleanup layer; it already handles arbitrary transcripts).
2. Add a new param to the request: `surface: "global"` (vs implicit `"chat_input"`). Cleanup behavior unchanged; `surface` is purely a routing hint for what happens AFTER cleanup.
3. After cleanup completes, client posts the cleaned text to a **new endpoint** `POST /api/voice/agent` (or extends existing chat endpoint with a flag — engineer's call). This endpoint:
   a. Runs the cleaned text through the existing agent (same chat-completion + tool-calling stack used elsewhere in Steadii).
   b. Risk-tier confirmations (low/med/high) gate execution per existing infra — global voice does NOT bypass these.
   c. Returns one of two shapes based on agent output:
      - `{ kind: "operation", executed: [{ tool, args, summary, undoable }, ...] }` when only tool calls happened (or text response is just confirmation like "Done")
      - `{ kind: "chat", chatId, userMessage, assistantMessage }` when text response only (no tools called)

### Client-side rendering

- `kind: "operation"`:
  - Surface a **toast** (existing `sonner` setup) with the summary: "Added 4 classes: CSC110, MAT223, BIO150, ENG110"
  - Include `Undo` button when ALL executed ops are reversible (low-risk: class add, task add, task reschedule). If any op is non-reversible, omit Undo.
  - **Operation mode does NOT save to chat history** — one-shot per Ryuto's explicit instruction.
- `kind: "chat"`:
  - **Open the chat overlay** (same one as Item B), pre-populated with the user message + the agent response.
  - Saves as a normal chat (visible in chat history).

### Risk-tier integration

Global voice goes through the same risk-tier confirmation system. High-tier ops (email send, data delete) render the existing confirmation modal pre-execution; the modal is identical whether the op was triggered from chat or global voice.

### Undo

For α, support Undo on these operations:
- **Class add** → soft-delete the class row (set `deletedAt`)
- **Task add** → soft-delete the task row
- **Task reschedule** → restore previous due date

Implementation: track operation IDs per global-voice fire (engineer scopes a `voice_operations` table OR reuses `usage_events.metadata` — judgment call). New endpoint `POST /api/voice/undo` takes `operationId`, reverses the op.

If Undo implementation exceeds **0.5d**, ship the toast WITHOUT Undo and itemize Undo as polish later. Toast visibility alone meets Ryuto's "ユーザーが見える前で 4 classes 追加される" requirement.

### Failure UX

- Whisper/Mini error: existing Phase 1 toast "音声を読み取れませんでした、もう一度どうぞ"
- Agent error or empty output: toast "Steadii couldn't understand — try rephrasing"
- Tool call failure mid-execution: toast "Operation failed — please try in the UI"

---

## Item D — Discoverability (extended)

Phase 1 shipped a hint below the chat composer: "Hold Caps Lock to talk".

Phase 3 changes:

1. **Existing chat composer hint** updated to: **"Hold Caps Lock to talk · Tap to chat from any page"** (single line, fits the existing slot).
2. **Every `/app/*` non-chat page** (Classes, Tasks, Calendar, Inbox, Settings, etc.): add a small muted hint at bottom-right: **"Tap Caps Lock to chat · Hold to talk"**. Same `text-[hsl(var(--muted-foreground))]` styling. Position should not collide with existing footer/nav elements — engineer scopes placement.
3. **Fade behavior**: both hints hide after **3 successful global-mode uses** (tap-summoned overlay submits + global voice fires combined). Persist counter in `localStorage` key `steadii.voice.global_uses` (separate from Phase 1's chat-input counter).
4. **Re-engagement**: if no global use in 7 days after hint hides, re-show once.

---

## Item E — Landing voice scene

### Hero tagline change

Find the current hero tagline in the landing page code (search for "Reads, writes, and remembers — for you."). Replace with:

> **Type or talk — Steadii reads, writes, and remembers for you.**

Update the JP version consistently if it exists (suggested: "話しても、書いても — Steadii が読み、書き、覚える。"). If unsure of i18n location, grep for the EN string + adjacent JP block.

### Hero-adjacent animated demo

Add a small looping animated demo near the hero (engineer chooses placement: right of hero copy if layout allows, OR centered below the CTA).

**Animation spec** (5-7 second loop, pure CSS keyframes, no audio, no JS framework dependency):

| time | frame |
|---|---|
| 0-1s | Caps Lock key icon fades in (idle) |
| 1-2s | Holographic border (Phase 1 palette: cyan #22D3EE → magenta #E879F9 → lime #A3E635 breathing 1.5s cycle) wraps an idle chat input rectangle |
| 2-4s | Animated text fade-in inside the input: `MAT223 のレポート due tomorrow` (mixed JP+EN to showcase code-switching). Cursor blinks. |
| 4-5s | Brief pause showing finished text, border still breathing |
| 5-7s | Reset: text fades out, border returns to idle gray, Caps Lock icon fades back |

Caption beneath the demo: **"Hold Caps Lock to talk"** (small, muted).

### Constraints

- **NO mic permission prompt on landing.** The demo is purely visual — never trigger `getUserMedia`.
- **NO actual audio playback.** Visual only.
- **NO interactive "try it now" demo** — too much friction (mic permission = scary on first visit).
- Mobile: animation should degrade cleanly on small screens (engineer's call — could swap to a static screenshot below a breakpoint).

---

## Out of scope

- Tone switching by destination (still no destination surfaces — defer indefinitely)
- Polish itemization (revisit post-α if real gaps surface)
- Replacing or restructuring existing landing sections beyond the hero tweak + demo addition

## Constraints

- Locked decisions in `project_voice_input.md` are sacred — Whisper / Mini / Caps Lock / "Listening to Steadii" UX / holographic palette are NOT to re-decide
- Pre-commit hooks must pass; no `--no-verify`
- Conversation Japanese; commits + PR body English
- Don't push without Ryuto's explicit authorization
- Operation-mode global voice does NOT save to chat history (one-shot semantics)
- Chat-mode global voice DOES save (treated as a normal chat)
- Caps Lock universal hijack on `/app/*` is intentional — discoverability hints set the expectation. Public marketing pages (`/`, `/login`) do NOT hijack Caps Lock.

## Verification plan

1. `pnpm typecheck` — clean (modulo pre-existing 2 errors in `tests/handwritten-mistake-save.test.ts:76,82`)
2. `pnpm test` — green (modulo pre-existing 1 failure in `tests/inbox-detail-old-shape.test.ts` "Why this draft")
3. Manual smoke (Ryuto, post-deploy):

**Item A — keystrokes**
- [ ] Tap Caps Lock on `/app` (chat input focused) → no overlay (no-op when already in chat input)
- [ ] Tap Caps Lock on `/app/classes` (no chat focus) → chat overlay opens, input auto-focused
- [ ] Tap Caps Lock again with overlay open → overlay closes
- [ ] ESC with overlay open → overlay closes
- [ ] Click outside card with overlay open → overlay closes
- [ ] Hold Caps Lock on `/app` (chat input focused) ≥1s → Phase 1 voice fires (unchanged)
- [ ] Hold Caps Lock on `/app/classes` ≥1s, say "add MAT223 with Prof Smith" → toast "Added MAT223" + class appears in list. NO chat created.
- [ ] Hold Caps Lock on `/app/classes` ≥1s, say "what's the difference between linear algebra and calculus" → chat overlay opens with question + agent response. Saved as a new chat.

**Item B — overlay UX**
- [ ] Backdrop blurs page behind, animation smooth
- [ ] Auto-focus on input
- [ ] Submit empty → no-op
- [ ] Submit non-empty → response renders inline, input clears, overlay stays open
- [ ] Phase 1 hold-to-talk works inside the overlay's input

**Item C — global agent voice**
- [ ] Holographic border pill appears near top-center during global hold
- [ ] Toast shows for low-risk operations
- [ ] Undo button works (or absent if engineer skipped per scope flexibility)
- [ ] High-risk ops show existing confirmation modal pre-execution
- [ ] Whisper/Mini failure → graceful toast, no crash
- [ ] Existing mic permission persists, no re-prompt on subsequent uses

**Item D — discoverability**
- [ ] Hint visible on `/app/classes`, `/app/tasks`, etc. on first load
- [ ] After 3 successful uses, hint hides
- [ ] After 7 days of no use post-hide, hint re-shows once
- [ ] Existing Phase 1 chat-composer hint string updated

**Item E — landing**
- [ ] `mysteadii.com` hero tagline updated to "Type or talk — ..."
- [ ] Animated demo loops 5-7s with all spec'd frames
- [ ] No mic permission prompt anywhere on landing
- [ ] Mobile: demo doesn't break layout (degrade or hide acceptable)

## When done

Per AGENTS.md §12, your final report MUST include "Memory entries to update":

- `project_voice_input.md` — flip status to "Phase 1 + 2 + 3 SHIPPED". Mark global hotkey + landing voice scene as SHIPPED in the queued section. Note any deviations from this handoff's spec (especially: did Undo ship? was the refactor done?).
- `project_steadii.md` — under "Voice as first-class input" section, mark global voice + landing demo as shipped pre-α.

Plus standard report bits.

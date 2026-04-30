# Feat — Voice input Phase 1 (Whisper STT + GPT-5.4 Mini cleanup)

Pulled forward from post-α queue per Ryuto's 2026-04-30 decision (built during dogfood-stall while Anthropic Chrome extension fix is pending). Full design spec lives at `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_voice_input.md`. This handoff is the Phase 1 implementation spec — the basic pipeline. Phase 2/3 (academic-context-aware cleanup, tone switching, auto-shorten) explicitly out of scope.

## Setup

```
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
git status
git log --oneline -5
```

Branch: `feat-voice-input-phase1`. Don't push without Ryuto's explicit authorization.

---

## Pipeline architecture

```
[user holds mic / ⌘⇧V]
  ↓
MediaRecorder API captures audio (opus codec, single chunk)
  ↓
[user releases]
  ↓
POST /api/voice (multipart, audio blob)
  ↓
server: Whisper STT (OpenAI API, batch)
  ↓
server: GPT-5.4 Mini cleanup with locked prompt
  ↓
server returns { cleaned: string }
  ↓
client: insert cleaned text at input cursor
```

## Stack (locked, do not deviate)

- **STT**: Whisper API (`whisper-1` or successor), batch mode. NOT realtime.
- **Cleanup model**: `gpt-5.4-mini` (NOT Nano). Add `voice_cleanup` task type to `lib/agent/models.ts` if not already present.
- **Audio capture**: browser `MediaRecorder` API, `audio/webm;codecs=opus` mimeType, single chunk per recording.
- **Server route**: new `app/api/voice/route.ts` POST handler. Multipart accepting audio blob.

## Cleanup prompt (locked, do not modify)

Use the exact prompt from `project_voice_input.md` "Cleanup prompt (production-ready, locked 2026-04-30)" section. Read that file directly; do not paraphrase.

Few-shot examples in the same memory section: include them. Cost is negligible (~$0.00015/call).

## Cost metering

This is the second LLM call category beyond the existing `chat`/`tool_call`/etc. Add `voice_cleanup` to `lib/agent/models.ts` task types. Per-call cost is ~$0.0004 (50 input + 50 output tokens at Mini pricing). Treat as **0 credit** (similar to `chat_title` / `tag_suggest`) — voice is a UX accelerator, not a billed primitive at α. Log to `usage_events` for analytics.

Whisper STT cost: $0.006/min. Treat as 0 credit too. Log audio duration in usage_events metadata for cost attribution.

## UX implementation — "Listening to Steadii" (NOT "Recording")

Pivoted 2026-04-30 to single-key hold + holographic border glow, no mic button, no red REC dot, no waveform. Star Trek "Computer..." moment feel. See memory `project_voice_input.md` "UX decisions" + "Why no mic button / no waveform" sections for full rationale.

### Trigger key

- Primary: **Caps Lock hold**. Use `keydown` + `keyup` listeners on the chat input (or document if input has focus). Call `event.preventDefault()` on `keydown` to suppress the OS Caps Lock toggle while we use it as voice trigger.
- Fallback: **Right Option (⌥)** — `event.code === "AltRight"`. Activate fallback automatically if Caps Lock event handling fails (e.g. browser doesn't fire reliably on this OS/keyboard combo). Detect at first use, store result in `localStorage` so subsequent loads use the working key.
- Hold = listening, release = stop + send.
- **No mic button anywhere**. Key is the only affordance.

### Visual feedback (on the chat input itself)

Use the **input field's own border** as the feedback surface — no separate UI element.

- **idle**: default input chrome (existing `border` color, no animation)
- **listening**: input border becomes a holographic gradient (cyan `#22D3EE` → magenta `#E879F9` → lime `#A3E635`, animated 1.5-2s breathing cycle via CSS `@keyframes`). Placeholder text changes to italic muted `Listening...`.
- **processing**: same breathing animation, warm-tinted (amber `#F59E0B`-leaning palette). No spinner. Placeholder stays `Listening...` to avoid jarring transition.
- **completed**: cleaned text inserts at cursor with 250ms ease-out fade-in animation. Border returns to idle within same 250ms.

Audio level visualization: SKIP. No waveform / VU meter / dot pulse. The breathing border conveys "I'm listening" without cassette-recorder vocabulary.

### Discoverability hint

Below the chat input, muted text: `Hold Caps Lock to talk` (or `Hold ⌥ to talk` if Right Option fallback active).

Hide after ≥3 successful voice uses (track `voiceHintShown` count in `localStorage`).

If user hasn't tried voice in 7 days after hiding, re-show hint once (gentle re-engagement; track separately).

## Server: /api/voice

### Request

```ts
POST /api/voice
Content-Type: multipart/form-data
Body: audio blob (Steadii single audio file, < 25MB Whisper limit)
```

### Handler steps

1. Auth check via `auth()` — reject 401 if no session.
2. Parse multipart, get audio blob. Reject 413 if > 25MB.
3. POST to OpenAI Whisper API with the blob.
4. POST result transcript to OpenAI GPT-5.4 Mini with the locked cleanup prompt + few-shot examples.
5. Return `{ cleaned: string, durationSec: number }`.
6. Log to `usage_events`: `task_type='voice_cleanup'`, `credits_used=0`, plus audio duration in metadata.
7. Errors: surface as JSON error responses, NOT raw exceptions.

### Rate limit

- Per-user: 60 voice calls / hour (~1/min average). Reuse existing rate limit infra in `lib/utils/rate-limit.ts`.
- Reasoning: voice is cheap but we don't want runaway loops or spam.

## Error handling

- **Mic permission denied** (browser-level): toast `mic 許可してください、Settings から再許可可`. Use `sonner` toast lib (already in stack).
- **Whisper failure** (network / API error): toast `録音失敗、もう一度試して`. Raw audio discarded (no fallback insertion).
- **Cleanup failure** (Mini error): fallback to inserting the raw STT transcript. Toast `text-cleanup スキップしました（生 transcript 使用）`. Better UX than nothing.
- **Audio recording failure** (no audio captured / 0 bytes): silent abort, no toast (probably accidental press-release).

## Tests

- Unit: cleanup prompt handles JP, EN, mixed, self-correction, code-switching (use the few-shot examples as test cases).
- Integration: `/api/voice` mocks Whisper + Mini, verifies happy path + each error mode.
- Component: `<MicButton>` press/hold/release behavior; ⌘⇧V hotkey wires correctly.

Skip live audio testing in CI — too fragile.

## Out of scope (Phase 2/3, defer)

- Academic context boost (passing user's classes/professors to cleanup prompt) — phase 2
- Tone switching by destination (chat vs draft) — phase 2
- Auto-shorten for long recordings — phase 3
- Real-time streaming transcription — never (batch is sufficient at α scale)
- Mobile UX (touch press-and-hold optimization) — defer
- Accessibility: keyboard-only voice trigger discoverability — phase 2

## Constraints

- Locked decisions in `project_voice_input.md` are sacred — Whisper batch / Mini / push-to-hold / cleanup prompt are NOT to re-decide
- Pre-commit hooks must pass; no `--no-verify`
- Conversation Japanese; commits + PR body English
- Don't push without Ryuto's explicit authorization
- Mic permission UX: do NOT auto-prompt on page load — only on first user click of mic button (avoids "scary" perm prompt)

## Verification plan

1. `pnpm typecheck` — clean
2. `pnpm test` — green (new voice tests added)
3. Manual smoke (Ryuto, post-deploy):
   - `/app` → click mic → grant mic perm → say short JP sentence → release → cleaned text appears within 2-3s
   - Same with mixed JP+EN ("MAT223 のレポート due tomorrow")
   - Same with self-correction ("5/16 あ違う 5/17")
   - ⌘⇧V hotkey works equivalently
   - Discoverability hint visible until 3rd use, then hidden
   - Mic permission denied → toast shown
   - Whisper fail simulation (disconnect WiFi mid-recording) → toast shown
   - Long recording (>10s) processes correctly

## When done

Per AGENTS.md §12, your final report MUST include "Memory entries to update":

- `project_voice_input.md` — flip status from "design locked, NOT implemented" to "shipped 2026-04-30 (Phase 1)". Add commit hash. Note any deviations from locked design.
- `project_steadii.md` — under post-α candidates section, mark "voice input Phase 1" as shipped pre-α (pulled forward).
- `project_decisions.md` — if voice cleanup pricing model needs to be locked (e.g. "voice = 0 credit, like chat_title"), add a line.

Plus standard report bits.

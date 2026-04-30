# Feat — Voice polish + inbox fixes + agent bugs (engineer 15)

α-shipping bundle. Voice work landed in PR #97/#98/#99 but Ryuto manual-tested and surfaced UX gaps + speed pain + 2 unrelated agent/chat bugs. This handoff covers all of them in one PR — bundle is correct per `feedback_handoff_sizing.md` (0/4 split criteria apply; no decision gates between items).

## Setup

```
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
git status
git log --oneline -5
git checkout -b feat-voice-polish-and-fixes
```

Branch: `feat-voice-polish-and-fixes`. Don't push without Ryuto's explicit authorization.

Read `AGENTS.md` first (especially §12 — your final report MUST include "Memory entries to update").

---

## Item A — Voice UX: split Listening vs Processing

**Bug**: Phase 1 spec said placeholder stays "Listening..." during processing to "avoid jarring transition." Ryuto tested live and confirms this is wrong — keeping "Listening..." after the user has released the key is confusing.

**Fix** — distinct copy + states:

| State | Trigger | Placeholder / pill text |
|---|---|---|
| listening | key held, recording | "Listening..." (italic muted) |
| processing | key released, cleanup running | **"Processing..."** (italic muted) |
| completed | text inserted | (placeholder gone) |

Apply to:
- **Phase 1 chat-input voice** (`components/chat/use-voice-input.ts` + the consuming chat input components). Wherever the `state === "processing"` branch currently keeps the "Listening..." label, switch to "Processing...".
- **Phase 3 global voice pill** (`components/voice/global-voice-pill.tsx`) — verify engineer 14's commit message claim of "Listening…/Working on it…" is actually wired correctly. If yes, leave alone; if no, fix.
- **Landing demo** (`components/landing/voice-demo.tsx` + `app/globals.css` keyframes) — animation should explicitly show the transition: 1-2s Listening → 2-3s **Processing** (border tints amber per existing spec) → 3-4s text appears.

Existing JP / EN i18n strings need a "Processing..." entry — search the i18n files for "Listening" and add the sibling.

---

## Item B — Voice speed: Mini → Nano + streaming + short-skip

**Goal**: post-release latency 1.5-3s → first character ~200-300ms / total 500-1500ms.

### B.1 — Switch `voice_cleanup` model from Mini to Nano

In `lib/agent/models.ts`, the `voice_cleanup` task currently routes to `OPENAI_CHAT_MODEL` (Mini). Move it to the nano tier:

```ts
case "chat_title":
case "tag_suggest":
case "voice_cleanup":   // ← move here
  return env.OPENAI_NANO_MODEL?.trim() || DEFAULTS.nano;
```

Update the `taskTypeMetersCredits` switch + the comment block at the top of the file (line ~31) to reflect Nano routing.

Pricing tier: `voice_cleanup` is already 0-credit (per `taskTypeMetersCredits`), so no billing-side change is needed beyond the task-type comment.

**Memory update**: `project_voice_input.md` "Stack picked" section locked Mini in 2026-04-30 over JP+EN handling concerns. Phase 2's locked prompt + few-shot examples should mitigate the quality concern at Nano scale; if quality regresses noticeably during smoke, fall back to Mini and flag to sparring.

### B.2 — Stream the cleanup response

Current `lib/voice/cleanup.ts` calls `openai().chat.completions.create({ ... })` (non-streaming). Switch to streaming:

```ts
const stream = await openai().chat.completions.create({
  model,
  messages: [...],
  temperature: 0.2,
  stream: true,
});
```

The route shape needs to change too:
- `app/api/voice/route.ts` becomes a streaming response (Server-Sent Events or chunked transfer). Each delta is sent to the client as it arrives.
- Client (`components/chat/use-voice-input.ts`) reads the SSE stream and appends tokens to the input as they arrive.

The `shortened` second call (Phase 2 auto-shorten) happens AFTER the cleanup stream completes. Server should:
1. Stream cleanup tokens to client (event: `delta`).
2. After cleanup ends, if `durationSec >= 30`, run the shorten call, send the result as a final event (event: `shortened`).
3. Send the final `done` event with `{ durationSec, cleanupSkipped }`.

Auto-shorten chooser UI (`components/chat/voice-choice.tsx`) should still appear after the full stream completes.

### B.3 — Skip cleanup for very short transcripts

If Whisper returns a transcript with <10 non-whitespace characters, skip the Mini call entirely and insert the raw transcript:

```ts
const cleanedThreshold = 10;
if (transcript.replace(/\s/g, "").length < cleanedThreshold) {
  return { cleaned: transcript, transcript, durationSec, cleanupSkipped: true };
}
```

This makes "うん" / "はい" / "OK" instant — no ~700ms model call for a 2-character transcript.

### Tests

Extend `tests/voice-route.test.ts`:
- Streaming response shape (mock OpenAI streaming, assert SSE events arrive in order)
- Short-skip path: transcript "うん" → response includes `cleanupSkipped: true`, no cleanup call made
- Nano routing: assert `selectModel("voice_cleanup")` returns the nano default when no env override

---

## Item C — Voice demo visual fixes (landing)

`components/landing/voice-demo.tsx` + `app/globals.css` `voice-demo-*` keyframes.

### C.1 — Vertical centering bug

Ryuto observed the text inside the input rectangle sits slightly above center. The container has `flex h-full items-center` but baseline drifts due to the cursor element's height + `leading-[1.4]`. Fix: align the cursor to the same baseline as the text, or use `place-items: center` + explicit `line-height: 1` on the inner row.

### C.2 — Trailing whitespace bug

The `voice-demo-text` span uses `inline-block max-w-full overflow-hidden whitespace-nowrap` with width animating from 0 to its natural width. After animation, the span's `inline-block` reserves the natural text width, but the parent container is wider, leaving visible padding that reads as "extra space after the text." Fix: change the animation strategy:

- **Option A** (preferred): use `width: max-content` on the span and animate via `clip-path: inset(...)` from the right. Container stays tight, no trailing space.
- **Option B**: wrap the text in a flex container with `width: fit-content` and let it self-size.

Engineer picks; goal is text → cursor → no extra space, tightly fit.

### C.3 — VoiceOS-inspired snake motion (the big redesign)

Per Ryuto's analysis of voiceos.com: text "snakes in" from outside the input on the left, follows a wavy path, then settles cleanly inside the input. This visceral motion is the "voice → text" metaphor.

**Animation spec** (replace current width-animate approach):

| time | frame |
|---|---|
| 0-1s | Caps Lock key icon fades in. Input border idle gray. |
| 1-2s | Caps key transitions to "pressed" state (slight scale-down + ring pulse), holographic border breathing visible (cyan/magenta/lime, 1.5s cycle). Input shows italic muted "Listening..." placeholder + 3 pulsing dots after it. |
| 2-3s | Listening continues. Pulsing dots animate in sequence. |
| 3-4s | Transition to processing: border tints amber, "Listening..." fades, "Processing..." briefly visible. **Text starts entering from outside the input on the left** — individual character spans staggered along a curved path (translateX + translateY with sine-wave Y offset), ending neatly inside the input. |
| 4-5s | All characters settled inside, "MAT223 のレポート due tomorrow" displayed with cursor blink. |
| 5-6s | Reset: border returns to idle gray, key fades to idle, text fades out. |

**Implementation hint**: each character is a separate `<span>` with CSS variables for its index (`--i: 0`, `--i: 1`, ...). Single `@keyframes` rule with `animation-delay: calc(var(--i) * 50ms)` for staggering. Path is `translate(calc(var(--start-x) + ...), calc(sin(...) * amplitude))` evolving to final position. SVG path-following also possible if simpler.

**Out of scope**: applying this snake motion to in-app voice (the current Phase 1 fade-in stays). This is landing-only.

### Caption update

Caption beneath the demo: keep "Hold Caps Lock to talk" — but make it more readable (current is `text-[12px]` + 55% opacity, very subtle). Bump to `text-[13px]` + 70% opacity, OR `text-[12px]` + 75% opacity.

---

## Item D — Landing "Just chat" section: cards & subhead

Currently 3 cards labeled "YOU TYPE". Ryuto wants the section to convey "say or type" without per-card labeling.

**Changes**:

1. **Remove the per-card "YOU TYPE" label** entirely. Cards just show the chat-bubble + content + result arrow.
2. **Add a section subhead** below "Just chat. Steadii does the rest.":
   - EN: **"Say or type — both feel native."**
   - JP: **"話しても、書いても — どちらも自然。"**
   - Style: `text-[14px] text-[hsl(var(--muted-foreground))]` or similar, mirroring existing subhead pattern on the page.
3. Section title stays "Just chat. Steadii does the rest." (no change).

The 3 cards' content stays identical — only the label is removed.

---

## Item E — Inbox badge count bug

**Bug**: Ryuto opens an email and exits midway → sidebar inbox badge count does NOT decrement. Per the existing code (`lib/agent/email/pending-queries.ts` `countPendingDrafts` + `app/app/inbox/[id]/page.tsx` `reviewedAt` set + `revalidatePath` in `after()`), the count SHOULD drop on detail-page open. But it doesn't — investigate.

### Root cause investigation

Likely culprits, in order of probability:

1. **`after()` callback execution** — Next.js `after()` runs once the response is sent, but the timing between callback execution and the next sidebar render isn't guaranteed. If the user navigates back to `/app/inbox` faster than the `revalidatePath` propagates, the sidebar reads stale data.
2. **`revalidatePath("/app", "layout")` scope** — there are documented Next.js 15 issues where layout-scoped revalidation doesn't always invalidate nested server components. May need `revalidateTag` with explicit cache tags on the badge query.
3. **Browser-side router cache** — Next.js client router caches RSC payloads. `router.refresh()` or `revalidatePath` may not bust the client cache reliably.

### Fix approach

1. **Switch to a tag-based revalidation**: define a cache tag like `"inbox-badge"` on the `countPendingDrafts` call (wrap in `unstable_cache` with the tag, or use Drizzle + manual `revalidateTag`). Detail page calls `revalidateTag("inbox-badge")` instead of `revalidatePath`.
2. **Plus** keep the existing `revalidatePath` calls as belt-and-suspenders.
3. **Plus** force the Sidebar to opt out of caching: add `noStore()` or `export const dynamic = "force-dynamic"` if it's not already set on the layout.
4. **Add a server action** `markInboxItemReviewed(itemId)` invoked client-side from the detail page mount (not the render path). The server action does the DB write + `revalidateTag` synchronously and returns. Client then calls `router.refresh()` to bust the client RSC cache.

The combination should ensure: open detail → `reviewedAt` set in DB → tag invalidated → next sidebar render reads fresh count → badge drops.

### Verification

Add an integration test (or component test if integration is too heavy) that:
1. Seeds an inbox item with a pending draft (count = 1)
2. Calls the mark-reviewed action
3. Asserts `countPendingDrafts(userId)` returns 0

---

## Item F — Inbox: collapse "Steadii noticed" into a toggle

**Bug**: Currently `app/app/inbox/page.tsx` renders `sortedProposals` (agent proactive proposals) ABOVE the email list as a flat section. When proposals accumulate, emails get pushed below the fold and require scrolling.

**Fix** — convert the "Steadii noticed" section into a collapsible toggle:

- **Default state**: collapsed. Header row visible: "Steadii noticed (N)" with a chevron + "▾" indicator. Click to expand.
- **Expanded state**: shows all proposals in the existing list format. Click header again to collapse.
- **Visual**: header row uses the existing "Steadii noticed" styling (Sparkles icon + uppercase label). Add a count badge `(${sortedProposals.length})` and a chevron rotating 180° on expand.
- **Order inside the toggle**: newest-first (already correct per `sortedProposals` sort). When expanded, the freshest proposal is at the top — exactly Ryuto's "トグルを開いた瞬間、一番上にエージェントの一番新しいコードが見える" requirement.
- **Persistence**: remember the toggle state in `localStorage` (`steadii.inbox.proposals_expanded`) so a user who prefers it expanded doesn't re-collapse on every visit.
- **Auto-expand on first new proposal** (optional polish): if there's at least one `pending` proposal newer than the user's last visit, auto-expand once. Track via another `localStorage` key (`steadii.inbox.proposals_last_seen`). Skip if engineer judgment says this exceeds 0.5d.

---

## Item G — BUG: chat assistant message rendered twice

**Bug**: When the agent responds in a regular chat (e.g. `/app/chat/[id]?stream=1`), the assistant message visibly renders TWICE — character-for-character identical, back-to-back. Reproduced 2026-04-30 with the calendar-delete flow.

### Root cause investigation (engineer to confirm)

Most likely cause: **streaming vs final-message double-render race**. When the orchestrator streams tokens to the chat UI via SSE, the client renders the streamed assistant message into the message list. Once streaming completes, the API may also persist the message and a refetch/cache-revalidate may add it again — resulting in two copies.

Possible locations:
- `lib/agent/orchestrator.ts` `streamChatResponse` — does it both stream AND insert into `messages` table? The client may be adding the streamed copy on top of the persisted one when fetching.
- The chat page may be rendering server-fetched messages PLUS streamed-in messages without deduplication. Look for the chat view component that subscribes to the SSE stream.
- The `/api/voice/agent` route returns `{ assistantMessage }` AND the orchestrator already wrote it to DB → if the client uses both, dup.

### Fix

Engineer to identify the dup path and ensure exactly ONE copy renders. Likely fix: when streaming, the SSE event handler builds an in-memory message object; on stream end, the client should NOT add a separate "loaded from DB" copy — it should reconcile by message ID.

Add a regression test if reasonable (component or integration).

---

## Item H — BUG: parallel calendar delete fails / tool result rendering broken

**Bug**: User asks Steadii to delete multiple calendar events. Agent attempts parallel deletion, fails on most, then says "1件だけ削除できましたが、残りは並列削除がうまく反映されませんでした。必要なら続けて残り9件を個別に消します。" User accepts; agent runs sequential `calendar_delete_event` tool calls (5+ in a row), each rendering as a black/empty result box in the chat.

### Two distinct issues

1. **Parallel deletion failure**: agent first tried to delete all events in one batch (or in parallel tool calls) and most failed. Need to investigate `lib/agent/tools/calendar.ts` `calendarDeleteEvent` to confirm it's idempotent + safe under concurrent invocation. Likely cause: the orchestrator's parallel tool-call execution ran into a race in `markDeletedByExternalId` or `triggerScanInBackground`, OR Google Calendar API rate limit was hit and silently failed.
2. **Tool result rendering broken**: the sequential delete fallback runs but each result renders as an empty/black box. The tool handler returns `{ eventId: args.eventId }` on success — that should produce a recognizable success indicator in chat, not a black box. Investigate the chat tool-result rendering component (likely `components/chat/*` or the inbox detail's draft view) and confirm it handles `calendar_delete_event` results properly.

### Fix approach

1. **For parallel failure**: add a serialization fence around `calendar_delete_event` invocations within a single orchestrator turn — process them sequentially even if the agent emits parallel tool calls. This is conservative; speed is sacrificed for correctness. Alternatively, fix the root cause (rate limit / race) but serialization is the safer bet for α.
2. **For result rendering**: identify the component rendering tool results in chat, ensure it has a case for `calendar_delete_event` (success: "✓ Deleted [event title]" or just "✓ Deleted"; failure: "✗ Couldn't delete [...]"). Black box = unhandled tool name fall-through.

Engineer to investigate which is dominant and fix both.

---

## Out of scope

- Tone switching by destination (still no destination surfaces — defer indefinitely)
- Voice Undo button on operation toasts (post-α polish)
- Playwright integration tests for voice provider/overlay (post-α tech debt)

## Constraints

- Locked decisions in `project_voice_input.md` are sacred — Whisper / "Listening to Steadii" UX / holographic palette are NOT to re-decide. Listening→Processing label fix is an explicit revision Ryuto signed off on, but the broader "no mic / no waveform" stance remains.
- Pre-commit hooks must pass; no `--no-verify`
- Conversation Japanese; commits + PR body English
- Don't push without Ryuto's explicit authorization
- Caps Lock universal hijack on `/app/*` stays; landing pages don't hijack
- Voice cleanup stays 0-credit even on Nano

## Verification plan

1. `pnpm typecheck` — clean (modulo pre-existing 2 errors in `tests/handwritten-mistake-save.test.ts:76,82`)
2. `pnpm test` — green (modulo pre-existing 1 failure in `tests/inbox-detail-old-shape.test.ts` "Why this draft")
3. Manual smoke (Ryuto, post-deploy):

**Item A — Listening/Processing**
- [ ] Hold Caps Lock in chat input, release → placeholder shows "Listening..." while held, switches to "Processing..." after release, gone when text inserts
- [ ] Same for global voice pill
- [ ] Same in landing demo animation

**Item B — Speed**
- [ ] Voice from chat input completes total < 1.5s for short clips (was 2-3s)
- [ ] First character visible in input < 500ms (streaming)
- [ ] "うん" / "はい" instant (skip path)

**Item C — Demo visuals**
- [ ] Text vertically centered in the demo input
- [ ] No trailing space after "MAT223 のレポート due tomorrow"
- [ ] Snake motion: characters enter from outside-left, wavy path, settle inside

**Item D — Cards**
- [ ] No "YOU TYPE" labels on cards
- [ ] Section subhead "Say or type — both feel native." visible below "Just chat. Steadii does the rest."

**Item E — Inbox badge**
- [ ] Open an inbox item with pending draft → sidebar badge decrements within 1s
- [ ] Navigate away without acting → count stays decremented (doesn't bounce back)
- [ ] Refresh page → count is consistent

**Item F — Inbox toggle**
- [ ] "Steadii noticed (N)" header collapsed by default
- [ ] Click expands list, click again collapses
- [ ] Newest proposal at top when expanded
- [ ] Toggle state persists across reloads

**Item G — Chat dup**
- [ ] Send a chat message → assistant response appears exactly ONCE

**Item H — Calendar delete**
- [ ] Ask Steadii to delete multiple events → all delete cleanly (no "parallel failed" message)
- [ ] Each delete renders a recognizable success indicator (✓ + event reference), not a black box

## When done

Per AGENTS.md §12, your final report MUST include "Memory entries to update":

- `project_voice_input.md` — note Listening/Processing label revision; note Nano switch + streaming + short-skip; note demo redesign + cards section change.
- `project_steadii.md` — voice section may need minor copy alignment if landing tagline / subhead shifted.
- If the chat-dup or calendar-delete bugs traced to known Phase 6/7/8 components, note in `project_steadii.md` Phase status.

Plus standard report bits.

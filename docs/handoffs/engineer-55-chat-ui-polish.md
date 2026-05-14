# Engineer-55 — Chat UI polish (sidebar recent chats + tool-call summary view)

**Read user-memory FIRST**:

- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/MEMORY.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/user_ryuto.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_steadii.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_pre_launch_redesign.md` — the D1 design lock (Raycast/Arc + Geist + amber, `.app-island-bg` iridescent backdrop, Logomark 32px in collapsed rail). The sidebar additions in this wave MUST inherit that visual language.
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_ai_aesthetic_unreliable.md` — surface visual options; Ryuto's eye via Claude Design is the source of taste. Don't lock visual specifics from training data — confirm with Ryuto on anything beyond layout/copy.
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_typecheck_before_push.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_sparring_engineer_branch_overlap.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_role_split.md`

Reference shipped patterns:

- `app/app/_components/Sidebar.tsx` (or whatever the canonical sidebar file is — verify via grep) — collapsed-rail design with Logomark 32px + icon row for `/app`, `/app/inbox`, `/app/calendar`, `/app/tasks`, `/app/classes`, `/app/activity`. Recent chats section goes BELOW the icon row.
- `app/app/chats/page.tsx` — existing chats history page. Audit current state: does it have search? Date grouping? Empty state? Mobile-responsive? Engineer-55 fills in whatever is missing per Part 2.
- `app/app/chat/[id]/page.tsx` or similar — individual chat thread view. The tool-call rendering lives somewhere in this tree; grep for `tool_call_started` / `tool_call_result` event handling.
- `lib/db/schema.ts` `chats` table — `userId`, `title`, `updatedAt`, `deletedAt`, `clarifyingDraftId` (engineer-46), and `chats.messages` count is queryable via the `messages` table. Recent-chats query: `SELECT * FROM chats WHERE userId = ? AND deletedAt IS NULL ORDER BY updatedAt DESC LIMIT 5`.

---

## Strategic context

The 2026-05-13 dogfood transcript ran through the chat orchestrator and surfaced two UX gaps that the agent-quality work (engineer-53 / engineer-54) doesn't address:

1. **The chat doesn't help the user navigate.** The sidebar shows app-level icons (home / inbox / calendar / tasks / classes / activity) but no recent chats. The user can only get back to a prior chat by typing the URL or remembering it. ChatGPT / Claude / Gemini all surface recent threads as a primary affordance — Steadii is the outlier without it.

2. **Tool calls are visually equal-weight with the draft.** A response shows 4–6 lines of "✓ email_search" / "本文を確認して、返信文を整えます。" / "✓ email_get_body" inline with the draft prose. The user has to read past the agent's narration to find the answer. The original transparency goal is correct (Steadii IS more honest than ChatGPT about what tools it used), but the visual hierarchy is inverted — narration shouldn't outweigh the response.

Distinct from engineer-54:
- Engineer-54 = "agent thinks like a secretary" (slot feasibility, counter-proposal, working hours)
- Engineer-55 = "the surface around the agent feels like a chat product" (sidebar discoverability + tool-call view density)

These are pure UI/UX changes — no prompt changes, no orchestrator changes, no eval scenarios beyond the existing ones.

---

## Scope — build in order

### Part 1 — Sidebar Recent chats section

Add an expandable section to the sidebar below the existing icon row. Layout:

```
[Logomark 32px]

[Home icon]
[Inbox icon]
[Calendar icon]
[Tasks icon]
[Classes icon]
[Activity icon]

──────────  (subtle divider)
Recent chats        すべて →   (link to /app/chats)
  アクメトラベル面接日程返信文…  (3h ago)
  カレンダーの整理について…  (1d ago)
  CSC108 課題の概要…  (3d ago)
  …  (up to 5 entries total)
──────────
```

Design notes:
- Each row: chat title (truncate at 28 chars or similar with `…`) + relative time (use `dayjs.relativeTime` or existing helper if one exists in the codebase — grep before importing a new dep).
- Active chat (the one currently being viewed) gets a subtle highlight (the same affordance as the active icon in the icon row).
- Section can be hidden on extremely narrow viewports (mobile drawer state) — but on the standard rail width it stays visible.
- Loading state: skeleton shimmer for the row count. Empty state: "まだチャットがありません。Home から始められます。" / "No chats yet."
- Real-time-ish: when the user lands in a new chat, the sidebar should reflect within the next sidebar re-render. Easiest: refetch on route change. Don't over-engineer with subscriptions for α.

Data fetching:
- Server component or RSC if the sidebar is server-rendered. Otherwise SWR / react-query mirroring how `/app/inbox` lists pull from the API.
- Query: most-recent 5 chats by `updatedAt DESC`. Filter `deletedAt IS NULL`. Scope to the current user via session.
- Avoid an N+1 — single query joins for title + updatedAt is enough.

### Part 2 — `/app/chats` history page audit + fill-in

Existing page at `app/app/chats/page.tsx` (confirmed via the Vercel build manifest in PR #240 / PR #242 logs). Audit current state and fill the gaps:

1. **List all chats** for the user, paginated (or virtualized for α since chat count is small).
2. **Search** — text input at the top, filters by chat title (case-insensitive substring). For α, in-memory filter on the loaded set is enough; postgres `ILIKE` if the loaded set ever exceeds a few hundred.
3. **Grouping** — section headers by recency: "Today", "Yesterday", "This week", "Earlier" (or equivalents in JA per the user's locale).
4. **Empty state** — same copy as sidebar's empty state.
5. **Per-row affordance** — click to navigate to `/app/chat/[id]`. Optional: hover-only "Delete" / "Rename" actions. **Defer rename** for engineer-56 if hover-action UI doesn't exist elsewhere yet; delete is enough for α.
6. **Mobile responsive** — single column on narrow viewports.

If the existing page already has any of (1–5), don't rebuild — just fill the gaps. Spec assumes worst case (empty `page.tsx` with just a heading). Engineer to audit first.

### Part 3 — Tool-call collapsed-summary view

Today, a chat message that involved tool calls renders something like:

```
メールを探して、本文の候補を作ります。
  ✓ email search
該当なしだったので、短い候補で再検索します。
  ✓ email search
本文を確認して、返信文を整えます。
  ✗ email get body — failed
該当メールを再取得してから本文を見ます。
  ✓ email search

返信文をそのまま使える形でまとめます。
[draft content]
```

The narration lines + ✓/✗ markers + retries occupy ~half the visible height. The DRAFT (the answer the user came for) is below the fold.

Target view: tool-call activity collapsed to a single summary line, draft prose primary.

```
[chips row, small, secondary color, OPTIONAL one-line label]
▶ Steadii の思考: email_search → email_get_body × 2 (1 retry) → 整えます

[draft content — primary, full-width, prominent]
```

Behavior:
- The summary row is **always rendered** when ≥1 tool call happened in this turn (never hidden behind "show more").
- Click the row → expand to show the current inline view (preserving all of: narration text, ✓/✗ status, tool name, args/result on a per-tool expand if already supported).
- Default state: COLLAPSED. The user opted into Steadii to get answers, not reasoning logs — but reasoning is one click away.
- Failure visibility: when ANY tool call in the turn failed (✗), the summary row gets a small warning icon + the user sees the failure-mode keyword (e.g. "1 retry"). Failures don't auto-expand — but they ARE flagged so the user knows to expand if something looks off in the draft.
- Animation: lightweight (height transition, ~150ms). No bouncing or skew.

Implementation hint:
- The chat message rendering already has access to the full tool-call event stream (it has to, to render the current inline view). Group consecutive tool events under a single `<ToolCallSummary>` component that conditionally renders the collapsed chip OR the existing expanded markup.
- Streaming: while a turn is in progress, tool events arrive one at a time. The summary row should update in real time ("running: email_search…" → "running: email_get_body…" → final summary). Test this — it's the hardest part of this change. Don't ship a UI that's clean for completed messages but flickers during streaming.

### Part 4 — Existing tests / a11y

- Vitest tests for the data-fetch hooks (recent chats query / chats page list).
- Component-level tests for the `<ToolCallSummary>` collapse/expand toggle + keyboard-focus.
- A11y: chat list items must be keyboard-navigable; the collapsed tool-call summary needs proper `aria-expanded` + `aria-controls` so screen readers announce the expansion state.
- No new eval scenarios (this wave is UI-only — agent behavior unchanged).

### Part 5 — i18n

Every new string passes through the existing i18n layer (JA + EN). Reference `lib/i18n/request.ts` and the existing `messages/{en,ja}.json` (or equivalent) for the key namespace pattern. Add new keys under `sidebar.recentChats.*`, `chatsPage.*`, `chat.toolSummary.*`. Run `pnpm i18n:audit` to catch any unprovided keys before claiming done.

---

## Setup

```bash
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
git checkout -b engineer-55
```

**IMPORTANT before checkout**: run `git status`. If a sparring session is doing concurrent work, those changes might be in the working tree. See `feedback_sparring_engineer_branch_overlap.md`.

## Verification

- `pnpm typecheck` clean
- `pnpm test` full suite green, +~12 new unit / component tests
- `pnpm i18n:audit` zero misses
- Manual via the dev preview (this wave IS observable in browser preview):
  1. Sidebar shows 5 most recent chats, "すべて →" link present, active chat highlighted
  2. `/app/chats` shows full history with date grouping + search
  3. A chat with tool calls renders collapsed by default → click to expand → all original detail visible → click again to collapse
  4. Streaming a new message: summary row updates in real time without flicker
  5. Failed tool call: warning indicator on the summary row
- Engineer SHOULD `preview_screenshot` the four states at 1440×900 and embed them in the PR description per `feedback_self_capture_verification_screenshots.md`.

## Out of scope

- Chat rename / chat delete affordances beyond a simple delete button — defer to engineer-56
- Search-across-message-bodies (currently scoped to chat titles only) — defer
- Real-time chat-list updates (WebSocket / SSE subscription) — defer; route-change refetch is enough for α
- Mobile-specific drawer pattern — α users mostly on desktop; respect viewport but don't over-design for narrow widths
- Re-design of the chat input itself (Caps Lock voice trigger / attach button etc.) — already shipped, untouched

## Memory entries to update on completion

- `project_pre_launch_redesign.md` — note the sidebar Recent chats addition + tool-call summary view, both shipped as engineer-55 (PR #NNN). This is a structural addition to the D1 design lock.

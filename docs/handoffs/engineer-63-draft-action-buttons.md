# Engineer-63 — Draft action buttons (Send / Edit / Confirm) + cross-iteration UI rehydrate gate

**Read user-memory FIRST**:

- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/MEMORY.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/user_ryuto.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_pre_launch_redesign.md` — D1 design lock; new buttons must inherit (Raycast/Arc + Geist + amber)
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_ai_aesthetic_unreliable.md` — confirm with Ryuto on anything beyond layout/copy
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_typecheck_before_push.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_sparring_engineer_branch_overlap.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_vercel_external_peers.md` — touches the chat orchestrator surface, verify /api/chat post-deploy
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_self_capture_verification_screenshots.md` — engineer captures own screenshots
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_role_split.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_dogfood_batched_end.md`

Reference shipped patterns:

- `components/chat/chat-view.tsx` — chat surface. Engineer-55 added the tool-call summary chip; engineer-58 added status polling + `rehydrateFromPoll`. This wave adds action affordances on assistant messages that contain a drafted email.
- `components/chat/markdown-message.tsx` — markdown renderer. Code-block detection lives here; engineer-63 extends it to surface the contained body to action buttons.
- `lib/agent/tools/gmail.ts` — existing `gmail_send` tool. Already destructive (`mutability: "destructive"`) so the orchestrator's confirmation flow gates user approval. Send button reuses this exact tool.
- `lib/agent/orchestrator.ts` — confirmation path. Engineer-46 + engineer-19 patterns already handle "agent emitted tool_call_pending → UI shows confirm/deny". The Send button is the inverse: user-initiated tool call into the same execution path.
- `app/api/chat/route.ts` — POST endpoint. Engineer-58 set up `messages.status` + waitUntil. The Send/Edit actions call back into this surface.
- `app/api/chat/messages/[id]/status/route.ts` — engineer-58's status poll endpoint. Engineer-63's tool-history rehydrate test piggy-backs here.
- `lib/utils/tool-call-summary.ts` — chip aggregation. Sparring inline PR #260 fixed the underlying overwrite bug; this wave adds an integration test.

---

## Strategic context

The 2026-05-15 dogfood validated engineer-62's structural fix — agent now reliably produces a proper draft with full context, dual-TZ conversion, sender-norms reasoning, code-block-wrapped body, and meta-commentary outside. **Quality is there.** What's missing is the **action layer**:

1. **User sees the draft → has to copy/paste into Gmail → potentially edit → send.** 4-5 manual steps. Steadii's "secretary not ChatGPT" pitch promises "we handle it" — the manual copy-paste-send is where the promise breaks today.

2. **Tool-call chip recoverability** — sparring PR #260 fixed the orchestrator-side bug (tool_calls now accumulate). Engineer-63 adds the regression test so we don't backslide.

This wave adds the action UI + a regression test for the Bug A fix.

---

## Scope — build in order

### Part 1 — Draft detection in markdown messages

`components/chat/markdown-message.tsx` (or equivalent) — when rendering an assistant message, scan for fenced code blocks. For each code block:
- If the code block is in an assistant turn that has a reply-intent context (user message indicates reply, OR the response contains slot/date language), tag it as a "draft candidate".
- Emit a `<DraftActionBar>` adjacent to the code block.

Heuristic for "draft candidate":
- Code block content length ≥ 100 chars (filter out trivial snippets like `pnpm typecheck`)
- Contains a greeting marker (`お世話になっております` / `Dear ` / `Hi ` / `お疲れ様` etc.)
- AND/OR contains a closing marker (`よろしくお願いいたします` / `Best,` / `Sincerely`)

If both markers present → confident draft. Show full action bar (Send + Edit). If only one → show "looks like a draft?" button bar with a smaller affordance + a tooltip. If neither → no buttons.

### Part 2 — Send button → `gmail_send` flow

New component `components/chat/draft-action-bar.tsx`. Renders 2 buttons:
- **送信 (Send)** — primary button, amber per D1 lock
- **編集 (Edit)** — secondary button, neutral

On Send click:
1. Open a confirmation modal (reuse `tool-call-card.tsx`'s DestructiveConfirm pattern OR a new lightweight modal). Modal shows:
   - To: `<sender-of-the-inbound-email>` (parsed from the originating inbox_item — chat-view needs to track which email this draft is replying to)
   - Subject: `Re: <original-subject>` (auto-prefixed; if user already prefixed don't double-prefix)
   - Body: contents of the code block
   - Two buttons: Cancel / Send for real
2. On "Send for real" — POST `/api/chat/draft-send` (new endpoint) with `{ chatId, messageId, replyToInboxItemId, body }`.
3. The endpoint:
   - Validates the user owns the message
   - Looks up the originating inbox_item to get sender + subject
   - Calls `gmail_send` (the existing tool) — same path the agent would have taken
   - Persists a new audit_log row with `action: "draft_sent_by_user"`, `resourceId: messageId`
   - Returns success
4. UI: replaces the action bar with "✓ Sent at HH:MM" + a small undo? (no undo in α — confirmation modal is the gate)

Reuse `gmail_send`'s rate-limit + error-handling. Inherit Gmail token refresh path.

### Part 3 — Edit button → inline editor

On Edit click:
1. Replace the code block's `<pre>` with a `<textarea>` (or rich textbox component) prefilled with the code block content.
2. Show "保存 / Cancel" buttons.
3. On Save:
   - POST `/api/chat/draft-edit` (new endpoint) with `{ chatId, messageId, newBody }`
   - Endpoint updates the assistant message's `content` field, replacing the original code block content with the new body. Preserve surrounding context prose + meta-commentary.
   - Re-render with new code block content.
4. On Cancel — revert to read-only view.

Editing is per-session; after edit the Send button uses the new body.

**Edge case**: agent emitted multiple code blocks (rare but possible — e.g. a "より丁寧版" alternative below the primary draft). Show action bar per code block; user picks which to send/edit.

### Part 4 — Sender / subject tracking

For Send to work, chat-view needs to know which inbox_item the draft is replying to. Today this isn't stored on the assistant message.

Option A: scan the chat's tool calls for an `email_get_body` or `email_get_new_content_only` invocation, extract its `inboxItemId` arg. The most recent one before the draft is the reply target.

Option B: add explicit `replyToInboxItemId` column on `messages`. Migration. Orchestrator sets it when it detects reply intent.

Lean: **Option A**. No migration, no orchestrator changes, just chat-view inspection of existing tool_calls. The accumulated `messages.tool_calls` (PR #260) has all the data.

### Part 5 — Regression test for cross-iteration tool-history (PR #260 gate)

Engineer-63 adds an integration test that asserts:
- An assistant turn with 3+ tool iterations persists ALL tool_calls in `messages.tool_calls` (not just the last iteration's)
- `rehydrateFromPoll` reconstructs all of them

Test file: `tests/orchestrator-tool-call-accumulation.test.ts`. Mocks the orchestrator's iteration loop with 3 batches (e.g. `[lookup_entity], [email_search, email_get_body], [convert_timezone, convert_timezone]`), runs the persistence, queries the DB row, asserts all 5 tool_calls are present.

### Part 6 — i18n strings

New keys under `chat.draftActions.*`:
- `send`: 送信 / Send
- `edit`: 編集 / Edit
- `save`: 保存 / Save
- `cancel`: キャンセル / Cancel
- `confirmTitle`: 送信の確認 / Confirm send
- `confirmTo`: 宛先 / To
- `confirmSubject`: 件名 / Subject
- `confirmBody`: 本文 / Body
- `confirmSendButton`: 送信する / Send for real
- `sentSuccess`: ✓ {time} に送信しました / ✓ Sent at {time}
- `sentError`: 送信に失敗しました — もう一度お試しください / Send failed — please try again

Run `pnpm i18n:audit` clean.

### Part 7 — a11y

- Send/Edit buttons are keyboard-navigable (Tab order)
- Send button has `aria-label` describing the action ("Send draft to <sender>")
- Edit textarea has `role="textbox"` + label
- Confirm modal: focus trap, Esc to cancel
- "✓ Sent" success state announced via `aria-live="polite"`

---

## Setup

```bash
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
git checkout -b engineer-63
```

IMPORTANT before checkout: `git status`. PR #260 (sparring tool-calls accumulation fix) must be in main before this wave starts — engineer-63 depends on the accumulated `messages.tool_calls` shape for reply-target detection.

## Verification

- `pnpm typecheck` clean
- `pnpm test` full suite green + Part 5 integration test
- `pnpm i18n:audit` zero misses
- Manual via dev preview: draft a reply, click Send → confirmation modal shows correct to/subject/body → confirm → audit_log row created
- Manual: click Edit → textarea editable → Save → code block content updates → Send uses new content
- Engineer self-captures screenshots: idle draft, action bar visible, confirm modal, sent success state — per `feedback_self_capture_verification_screenshots.md`

## Out of scope

- Voice agent (different orchestrator surface; same draft-detection logic could be reused later)
- "Schedule send" / "send later" — α users use Gmail web for delayed send if needed
- Draft templates / "save as template" — post-α polish
- Multi-recipient drafts (CC/BCC) — α only needs reply, which is single recipient
- Multi-thread send (sending the same draft to different recipients in different threads) — explicitly excluded
- Undo send — α uses Gmail's native undo (the chat just kicks gmail_send; Gmail's own 30s undo applies)

## Memory entries to update on completion

- `project_pre_launch_redesign.md` — note draft action bar shipped + the cross-iteration rehydrate test
- `feedback_agent_failure_modes.md` — no new entry; the action bar is feature, not bug-fix

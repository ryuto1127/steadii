# Polish-10 — Chat syllabus auto-import + attachment-only submit + Enter-to-send

Three fixes bundled into one PR. All three are blocking the landing-page demo recording — Ryuto needs to upload a syllabus from chat, attach a file without typing, and use Enter to send while filming.

## Setup

```
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
git status   # clean
git log --oneline -5
```

Most recent expected: `4a0c810 Merge pull request #67 from ryuto1127/polish-9-tasks-multi-source`. If main isn't at that or later, **STOP**.

Branch: `polish-10-chat-syllabus-ux`. Don't push without Ryuto's explicit authorization.

## Context — the bigger picture

These three issues all touch the main chat input at `/app` and `/app/chat/[id]`. Issue 1 is a real bug (Phase 8's syllabus auto-import is silently bypassed when the user uploads via chat). Issues 2 and 3 are UX consistency fixes — the "internal chat" components (inbox-detail clarifying-reply, etc.) already follow the desired conventions; the main chat is the outlier.

Solve all three in one PR. They're small enough individually that splitting adds review overhead without payoff.

---

## Issue 1 — Syllabus auto-import bypassed in chat (the real bug)

### Current behavior

When a user attaches a syllabus PDF in the main chat and sends, the file is uploaded to blob storage, persisted as a `messageAttachments` row, and surfaced to the AI as a text note (`[User attached PDF: filename — url]`). The AI may "see" it, but **no extraction runs and no calendar events are created**. By contrast, the syllabus wizard at `/app/syllabus` correctly calls `saveSyllabusToPostgres()`, which fires `runSyllabusAutoImport()` per `lib/syllabus/save.ts:107`.

### Code path (verified)

- `app/api/chat/attachments/route.ts:100-141` — direct insert into `messageAttachments`, no extraction
- `lib/agent/orchestrator.ts:386-420` — `loadHistory()` loads attachments, passes to `toOpenAIMessage()`
- `lib/agent/messages.ts:47-58` — converts PDFs to a text note for the LLM, no tool invocation
- `lib/syllabus/save.ts:107` — `runSyllabusAutoImport()` fires here, but never reached from chat path

### Fix — add a `syllabus_extract` agent tool

Picked over the simpler "auto-extract every PDF in attachments route" because:
- The agent decides whether the PDF is actually a syllabus (vs past exam, lecture slides, scanned notes) — avoids false positives
- Glass-box narrative: the user sees a ToolCall card "Reading syllabus → Adding 12 dates to your calendar" instead of a silent background operation
- Plays well in the landing demo recording (visible agent reasoning)

**Tool spec:**
- Tool name: `syllabus_extract`
- Description (for the LLM): "Extract a syllabus PDF the user just attached. Use ONLY when the user's PDF appears to be a course syllabus (contains course schedule, exam dates, assignment list). Returns the extracted class + auto-imports schedule items into calendar."
- Inputs: `attachmentUrl: string`, `classId?: string` (optional — if user already mentioned which class this is for, otherwise tool creates a new one or asks)
- Implementation: pull the blob, run the existing GPT-vision syllabus extraction (mirror the wizard's path), then call `saveSyllabusToPostgres()` so the existing `runSyllabusAutoImport()` fires.

**System prompt update:** add a short rule under the existing PROACTIVE SUGGESTIONS or tools section (`lib/agent/prompts/main.ts`) — something like:

```
When the user attaches a PDF that looks like a course syllabus
(course code in filename, mentions exam dates, has a weekly schedule),
call syllabus_extract instead of just acknowledging the attachment.
The tool will create the class if needed and auto-add the schedule
to the user's calendar.
```

**Confirm UX:** `runSyllabusAutoImport()` already handles the 3 cases per Phase 8 D10 (confident match → skip, confident no-match → auto-add with `[Steadii]` prefix, ambiguous → emit `syllabus_calendar_ambiguity` proposal). Don't re-invent — just make sure the chat path reaches it.

**Credits:** the syllabus extraction itself is already metered (`syllabus_extract` task type in `lib/agent/models.ts` — verify this exists; if not, add it). The tool wrapper itself is just orchestration, no extra credit charge.

---

## Issue 2 — Allow attachment-only submission

### Current behavior

`components/chat/new-chat-input.tsx:186`:

```ts
const canSubmit = value.trim().length > 0 && !isPending;
```

Empty textarea = disabled submit, even with file attached.

### Fix

Change to:

```ts
const canSubmit = (value.trim().length > 0 || file !== null) && !isPending;
```

Verify the `file` (or whatever the local attachment state is named — confirm in the same file) is the right reference. Pattern matches `chat-view.tsx:534`:

```ts
disabled={streaming || (!input.trim() && !attachment)}
```

When attachment-only is sent:
- The `messageAttachments` row already gets inserted (no change needed)
- The user message body can be empty string — verify the orchestrator doesn't choke on empty `content` when attachments exist. If it does, default the body to a single space or a sensible placeholder like `(file)` for DB integrity, but try empty first.

---

## Issue 3 — Enter-to-send + remove Cmd+Enter helper

### Current behavior

**Keybinding** (`components/chat/new-chat-input.tsx:259-265`):

```ts
if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
  e.preventDefault();
  (e.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
}
```

**Helper text** rendered at `new-chat-input.tsx:333-342` (hardcoded "Press ⌘ + Enter" footer) + i18n keys:
- `lib/i18n/translations/en.ts:508` — `send_hint: "⌘⏎ to send"`
- `lib/i18n/translations/ja.ts:232` — `send_hint: "⌘⏎ で送信"`

### Fix

**Keybinding:** match `chat-view.tsx:469-477`:

```ts
if (e.key === "Enter" && !e.shiftKey) {
  e.preventDefault();
  (e.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
}
```

Shift+Enter inserts newline (default textarea behavior — make sure you're not preventDefault-ing it).

**Remove the helper text entirely:**
- Delete the hardcoded footer at `new-chat-input.tsx:333-342`
- Delete the `send_hint` keys from `en.ts:508` and `ja.ts:232`
- Grep for any other consumer of `send_hint` before deleting (`grep -r "send_hint" .`) and delete those references too

The Enter convention is universally understood (Slack, Discord, ChatGPT, Claude.ai). No replacement helper text needed.

---

## Verification plan

After implementing:

1. `pnpm typecheck` — should be clean (only the 2 pre-existing test errors on main remain)
2. `pnpm test` — all green
3. Manual smoke (the demo-blocking scenarios):
   - Open `/app`, attach a syllabus PDF (use any sample syllabus — even a fake one), no text, press Enter → tool call should appear, class should be created, calendar events should populate (verify on `/app/calendar`)
   - Open `/app`, attach any PDF, no text, press Enter → message sends with attachment-only
   - Open `/app`, type "hello" + press Enter → sends; type "hello" + Shift+Enter → newline; verify Cmd+Enter does NOT also fire submit (or does it harmlessly — your call, but Enter alone must work)
   - Inspect main chat input — no "Press ⌘ + Enter" footer visible

4. Don't break the internal chat (`chat-view.tsx`) — its Enter behavior was already correct; the fix to `new-chat-input.tsx` shouldn't touch it.

---

## Out of scope

- Drag-and-drop file upload (current attach button stays)
- Multi-file attachments (current 1-file limit, if any, stays)
- Touch / mobile send button polish
- Refactoring `new-chat-input.tsx` and `chat-view.tsx` into a shared component (tempting but separate PR)
- Adding a "file detected — looks like syllabus, want to import?" inline confirmation. The agent decides via system prompt rule. If observation in α shows false-positive imports, add the confirmation then.

---

## Constraints

- Locked decisions in `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/` are sacred
- Pre-commit hooks must pass; no `--no-verify`
- Conversation Japanese; commits + PR body English
- Don't push without Ryuto's explicit authorization
- Phase 8 D10 (`runSyllabusAutoImport` flow) must stay intact — Issue 1 is hooking *into* it, not replacing it

---

## Context files to read first

- `app/api/chat/attachments/route.ts` — current attachment upload path
- `lib/agent/orchestrator.ts` — chat orchestration entry
- `lib/agent/messages.ts` — message conversion (PDF text-note generation)
- `lib/agent/tools/` — existing tool definitions, mirror the shape for `syllabus_extract`
- `lib/agent/prompts/main.ts` — system prompt to extend
- `lib/syllabus/save.ts` — the target function the new tool must reach
- `lib/agent/proactive/syllabus-import.ts` — what fires after `save.ts`
- `lib/agent/models.ts` — task type enum + credit routing
- `components/chat/new-chat-input.tsx` — Issues 2 + 3 main file
- `components/chat/chat-view.tsx` — pattern to match
- `lib/i18n/translations/{en,ja}.ts` — `send_hint` removal
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_steadii.md`, `project_decisions.md`, `project_pre_launch_redesign.md`, `project_agent_model.md`

---

## When done

Report back with:
- Branch name + final commit hash
- Verification log (typecheck, tests, manual smoke for all 3 scenarios above)
- Any deviations from this brief + 1-line reason each
- Confirmation that Phase 8 D10 syllabus auto-import is still firing for the wizard path (not just the new chat path)

The next work unit is the landing-page demo video recording — these three fixes unblock that.

# Wave 1 — Secretary pivot foundation

**This is the first wave of the secretary-pivot roadmap.** Steadii is now a pure secretary / chief of staff for students — NOT a tutor. The strategic lock is captured in memory `project_secretary_pivot.md`. Read that first before starting.

This wave establishes the **vision-alignment baseline** so subsequent waves (Home rebuild, group projects, etc.) don't compound copy/UX dissonance. Four scopes, all touching different code paths, no conflicts:

1. Copy audit — kill tutor language across landing, onboarding, UI, email templates
2. Chat scope detection — tutor-style queries get a ChatGPT handoff offer, not an in-Steadii answer
3. Sidebar shortcut UX — inline placement when sidebar is open + dedupe + better selections
4. Mistake notes label rebrand — keep as draft-personalization input, drop the "study aid" framing

## Setup

```bash
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
git status
git log --oneline -5
```

Most recent expected: PR #115 (polish-17 i18n agent components) merge or later. If main isn't there, **STOP** and flag.

Branch: `wave-1-secretary-pivot-foundation`. Don't push without Ryuto's explicit authorization.

---

## Strategic context (READ THIS BEFORE TOUCHING CODE)

`project_secretary_pivot.md` is the source of truth. Key points:

- Steadii does the *work* (manage email/calendar/deadlines/relationships)
- Students do the *learning* (ChatGPT/Claude/Gemini handles that)
- Steadii is positioned as the **best context loader for AI tutors**, not as a tutor itself
- This wave is about removing existing tutor-implication, not adding new features
- Page name is **"Home"** / 「ホーム」 — NOT "Steadii". The brand is Steadii, the page is Home (no double-branding)

If anything in scope conflicts with the pivot lock, flag — don't guess.

---

## Scope 1 — Copy audit

Goal: every user-visible string that implies tutoring/teaching/study-aid framing → rewrite to secretary/admin/management framing.

### Files to audit

```bash
# Landing copy + value props
lib/i18n/translations/en.ts (landing.* / value_props / how_it_works / etc.)
lib/i18n/translations/ja.ts (same paths)

# Onboarding flow copy
app/onboarding/**

# Hero / subhead / pitch
components/landing/**

# UI strings inside /app/*
lib/i18n/translations/{en,ja}.ts (app, home, inbox, classes, mistakes, calendar, tasks, settings, agent.*)

# Email templates
lib/integrations/resend/templates/access-approved.ts
lib/integrations/resend/templates/admin-new-request.ts
lib/integrations/resend/templates/digest-weekly.ts (if exists)
```

### What to look for and rewrite

| Tutor-leaning phrase | Secretary-leaning replacement |
|---|---|
| "AI study companion" / "study buddy" | "academic chief of staff" / "personal secretary" |
| "learn with Steadii" / "Steadii helps you learn" | "Steadii handles your academic admin" / "delegate to Steadii" |
| "review mistakes to study" | "Steadii uses your weak areas as context" |
| "explain concepts" / "answer questions" | (remove, not in scope) |
| "AI tutor" / "tutoring" | (remove entirely) |
| "Steadii reads, writes, and remembers" | "Steadii reads, writes, schedules, and tracks — so you don't have to" |

JA equivalents:
| Tutor JA | Secretary JA |
|---|---|
| 「学習アシスタント」「勉強パートナー」 | 「学業の秘書」「あなた専属の chief of staff」 |
| 「Steadii と学ぶ」「学びをサポート」 | 「Steadii が学業の事務を片付ける」「Steadii に任せる」 |
| 「間違いを復習する」 | 「Steadii があなたの弱点を起案に活かす」 |
| 「概念を説明」「疑問に答える」 | （削除） |
| 「AI 家庭教師」「AI 講師」 | （削除） |

### Hero subhead specifically

Current EN: "Type or talk — Steadii reads, writes, and remembers for you."
New EN: "Your chief of staff for college life. Steadii reads, writes, schedules, and tracks — so you don't have to."

Current JA: 「話しても、書いても — Steadii が読み、書き、覚える。」
New JA: 「あなた専属の、学業の chief of staff。Steadii が読み、書き、予定し、追跡します — あなたはやらなくていい。」

(Adjust if Ryuto's voice prefers different — flag in your final report if you found a better phrasing.)

### Approach

1. Run `grep -rni "tutor\|tutoring\|study companion\|study buddy\|study with\|learn with steadii\|study aid\|review mistakes to" --include="*.ts" --include="*.tsx" --include="*.md" -- app/ components/ lib/ docs/handoffs/`
2. Same for JA: 「家庭教師」「講師」「勉強パートナー」「学習アシスタント」「学びをサポート」「復習」
3. Categorize hits: copy-only changes vs structural changes
4. Apply copy-only changes inline. Flag any structural changes for Wave 2 or beyond.

### What NOT to touch

- The actual mistake-notes data model + storage (Wave 1 is UI labels only)
- Any existing translation key names (engineer 17 + polish-17 locked the schema; just change values)
- Backend prompts (e.g. system prompts in `lib/agent/prompts/*`) — those are agent-instruction copy, not user-visible copy
- Variable names, code comments, internal docs — those are dev-facing

---

## Scope 2 — Chat scope detection

Goal: when a user types a tutor-style question into the Steadii chat input, surface an inline offer to redirect to ChatGPT (with a context-rich prompt baked in), instead of running the request through Steadii's orchestrator.

### Where the chat input lives

- `components/chat/chat-input.tsx` (or similar) — the composer
- `app/api/chat/route.ts` (or similar) — the server endpoint that handles chat submissions

Find the entry point and the request flow before touching.

### Detection logic

**Approach: lightweight heuristic first, optional short-LLM classifier later.**

Heuristic patterns that flag as tutor-style (case-insensitive):

EN:
- Starts with: "what is", "what are", "explain", "how does", "why does", "why is", "can you teach", "help me understand", "what's the difference between"
- Contains: "definition of", "formula for", "derive", "prove that"
- Pure knowledge questions: ends in `?` AND no action verb (schedule, draft, send, move, add, remove, cancel, email, message, find, search) earlier in the input

JA:
- 「〜とは」「〜って何」「〜の違いは」「〜の仕組み」「説明して」「教えて(× contextual: 教えてもらえますか could be polite request)」「導出」「証明」
- 末尾「？」 + 動作動詞(送って／連絡して／追加して／キャンセルして／調べて／予定して)が含まれない

Patterns that flag as command (override tutor detection):
- Action verbs as primary: schedule / draft / send / move / add / cancel / email / message / 送って / 予定して / 追加して / キャンセル / 連絡して
- Reference to Steadii's data: "my MAT223 prof", "my calendar", "my tasks", 「私のシラバス」 etc.

If both flags fire, **prefer command interpretation** (let user through to Steadii — false negatives on tutor detection are fine, false positives are annoying).

### UI on tutor detection

Inline message above the chat input, **before** the request hits the orchestrator:

```
┌─────────────────────────────────────────────┐
│ ⚠ This looks like a study question.          │
│ Steadii handles academic admin (email,        │
│ schedule, deadlines). For learning, ChatGPT  │
│ is faster. Want me to send you there with    │
│ your context loaded?                         │
│                                              │
│ [Open in ChatGPT]  [No, ask Steadii anyway]  │
└─────────────────────────────────────────────┘
```

JA:
```
┌─────────────────────────────────────────────┐
│ ⚠ 学習質問のようです。                        │
│ Steadii は学業の事務担当。学習は ChatGPT の  │
│ 方が速いです。あなたのコンテキストを添えて    │
│ ChatGPT で開きますか?                        │
│                                              │
│ [ChatGPT で開く]  [いや、Steadii で続ける]   │
└─────────────────────────────────────────────┘
```

### "Open in ChatGPT" prompt construction

Build a prompt that bundles user context with the question:

```
Context: I'm a university student. Currently taking these classes:
- {class_code} ({class_name}) — Prof {professor_name}
- ...

Recent syllabus topics:
- {class_code}: {recent_chapter_or_topic}
- ...

Past confusion / weak areas (use to calibrate explanation depth):
- {mistake_summary_1}
- {mistake_summary_2}

My question:
{user_input}

Please answer with awareness of the above context. Default to undergraduate-level explanation unless I ask for deeper.
```

Open via `https://chatgpt.com/?prompt={url-encoded prompt}` (ChatGPT supports `?prompt=` URL param for prefilled queries).

Source data:
- Classes: `db.select().from(classes).where(eq(classes.userId, userId))`
- Recent syllabus topics: pick most-recent class's most-recent syllabus chunk
- Past mistakes: limit 3 most recent

If user has no classes / syllabi / mistakes → still construct prompt, just with the question alone. Don't over-engineer empty-state handling.

### What NOT to do

- Do NOT actually run the user's tutor query through Steadii's orchestrator silently (i.e. don't fall back to "if detection failed, just answer it"). The point is to push them to ChatGPT.
- Do NOT classify with a costly LLM call by default. Heuristic-first; LLM classifier is a Wave 3+ enhancement if heuristics underperform.
- Do NOT block the user — the "ask Steadii anyway" escape hatch is critical (false positives must not lock them out).

---

## Scope 3 — Sidebar shortcut UX

Goal: Ryuto reported keyboard-shortcut hints (e.g. "gc · チャット") render as floating tooltips below sidebar items. They want them **inline at the right edge when sidebar is open**, plus the shortcut keys themselves have duplicates and questionable choices.

### Find the sidebar code

```bash
grep -rn "shortcut\|kbd\|keyboard" --include="*.tsx" -- components/layout/sidebar.tsx components/layout/
```

The shortcut-key map and the floating-pill component should be there.

### Three sub-fixes

#### 3a — Layout: inline at right edge when sidebar is open

When sidebar is in expanded state (typical desktop layout), shortcut hints should render as muted-style chips on the right edge of each nav row. When sidebar is collapsed (icon-only), they don't render (the icons themselves are the only affordance).

Pattern (Tailwind-ish):
```tsx
<a className="... flex items-center justify-between">
  <span className="flex items-center gap-2">
    {icon}
    <span>{label}</span>
  </span>
  {sidebarOpen ? (
    <kbd className="ml-auto rounded bg-[hsl(var(--surface-raised))] px-1.5 py-0.5 text-[10px] font-mono text-[hsl(var(--muted-foreground))]">
      {shortcut}
    </kbd>
  ) : null}
</a>
```

The floating-tooltip variant can stay for the collapsed-sidebar case if it exists, but the inline version takes priority for the expanded state.

#### 3b — Dedupe shortcut keys

Audit the existing shortcut map. Each binding must be unique. Common pattern is `g + <letter>` (gh, gi, gc, gk, gt, gs etc.) so collisions show up easily.

Suggested mapping (revise to match what's already there if reasonable):
- `gh` → Home
- `gi` → Inbox
- `gc` → Calendar
- `gt` → Tasks
- `gk` → Classes
- `gs` → Settings
- `gj` → 履歴 (旧 Chats — but this is Wave 2 rename, so keep current label for now)

Confirm none duplicate. If two items share `gc` (e.g. Calendar AND Chat), pick one and reassign the other.

#### 3c — Better key selection

Mnemonic > muscle memory:
- "Calendar" → `gc` (calendar starts with c) ✓
- "Chats / 履歴" → `gj` (j = journal? recent? — better than `gc` which collides). Or `gh` if Home is moved/renamed.
- "Home" → `gh` (home starts with h) ✓
- "Inbox" → `gi` ✓
- "Tasks" → `gt` ✓
- "Classes" → `gk` (c is taken; k for "kurasu" / "klass") or `gl` (l for学 lecture)

Document your choices in the PR description so we can revise without re-grokking the rationale.

### What NOT to do

- Don't introduce new shortcut prefixes (stick with `g`-prefix or whatever's already convention)
- Don't break existing shortcut behavior — additive UI only
- Don't change the keyboard event handler logic; just the visual presentation + dedupe

---

## Scope 4 — Mistake notes UI rebrand

Goal: keep the data model (mistake_notes table) and pipeline (handwritten OCR → mistake creation) as-is — they're INPUT for Steadii's draft personalization. But the *UI label* + *page copy* should stop framing them as "study material" or "review aid".

### Files

- `app/app/mistakes/**` — list + detail pages
- `app/app/classes/[id]/**` — mistakes tab inside class detail
- `lib/i18n/translations/{en,ja}.ts` — `mistakes.*` keys

### Rewrites

| Current label | New label |
|---|---|
| "Mistake notes" | "Weak-area memory" or "Steadii's notes about you" |
| "間違いノート" | 「弱点メモ」or「Steadii の覚え書き」(prefer the latter — frames Steadii as the actor) |
| "Review your mistakes" | "Areas Steadii tracks for you" |
| "Study aid" | "Used by Steadii when drafting your emails" |

In each list/detail page, add a brief contextual note:

EN:
> Steadii uses these to personalize drafts and notice when emails relate to topics you've struggled with. Not a study tool — for studying, use ChatGPT/Claude.

JA:
> Steadii はこれを参考にメールの起案や提案を調整します。学習用ではありません — 勉強は ChatGPT/Claude などをご利用ください。

### Sidebar nav

If "Mistakes" / 「間違い」 is in the sidebar, rename consistently. If it's only inside class detail tabs, just update the tab label.

### What NOT to do

- Don't drop the data model
- Don't remove the OCR pipeline or any backend
- Don't surface "go review your mistakes" type prompts anywhere
- Don't add quiz / flashcard / spaced-repetition features (out of scope, against pivot)

---

## Verification

For each scope, capture screenshots @ 1440×900 in BOTH locales (EN + JA). Per AGENTS.md §13, you (engineer) self-capture, do NOT ask Ryuto.

Specific captures needed:

- Landing page: hero + value props + how-it-works section (4 screenshots: 2 sections × 2 locales)
- /app/mistakes (list + detail) in both locales
- /app/classes/[id] mistakes tab in both locales
- Sidebar (expanded state) showing shortcut chips inline in both locales
- Chat input with a tutor-style query triggering the ChatGPT handoff offer (1 EN + 1 JA = 2 screenshots)
- Welcome / approval email rendered in EN and JA (you can render via the template builder in a small test, doesn't need to be a real send)

---

## Tests

- Typecheck must pass (the 2 pre-existing `tests/handwritten-mistake-save.test.ts` failures are unrelated, leave them)
- `pnpm test` must stay at 726 / 726 pass
- New unit tests:
  - `lib/chat/scope-detection.test.ts` (or wherever the detector lives) — at least 12 cases:
    - 4 EN tutor patterns (correctly detected)
    - 4 JA tutor patterns (correctly detected)
    - 2 EN command patterns (correctly NOT flagged)
    - 2 JA command patterns (correctly NOT flagged)
- ChatGPT handoff URL construction — unit test that prompt encoding produces a valid `chatgpt.com/?prompt=...` URL

---

## What NOT to touch in Wave 1

- Home page rebuild (Wave 2)
- Sidebar reorder / 履歴 rename (Wave 2 — this is a structural change tied to the Home rebuild)
- Group project / meeting pre-brief / office hours scheduler (Waves 3-4)
- Auto-execute mode (Wave 5)
- Backend prompt rewriting
- Translation key namespace restructuring

If you find yourself wanting to refactor structure to make this wave cleaner, **flag and pause** — Wave 2 will rebuild Home anyway, so don't pre-empt that work.

---

## Final report format

Per AGENTS.md §12, your final report MUST include:

1. **Branch / PR name**: `wave-1-secretary-pivot-foundation`
2. **Summary**: per-scope (1/2/3/4) what you changed
3. **Verification screenshots**: list above, all 1440×900, EN + JA pairs where applicable
4. **Tests added / passing**: scope-detection cases + handoff URL cases
5. **Memory entries to update**: anything from the secretary pivot that's now firmer or contradicted
6. **Out-of-scope flags**: things you noticed that need Wave 2+ attention

---

## Estimated effort

- Scope 1 (copy audit): ~3-5h (lots of files, mostly mechanical)
- Scope 2 (chat scope detection): ~6-8h (new logic + UI + tests + ChatGPT URL builder)
- Scope 3 (sidebar UX): ~2-3h (visual only, contained)
- Scope 4 (mistake notes rebrand): ~1-2h (copy + label changes)

Total ~12-18h. Single PR, single branch.

If any scope reveals a deeper issue (e.g. heuristic detection underperforms, or copy audit surfaces structural design choices that need re-spar), pause and flag.

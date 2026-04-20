# Steadii — Pre-α UI Redesign Spec

Handoff document for the terminal Claude Code session that will implement this redesign. Read this file in full before writing any code. Also read `PRD.md` for product intent and `AGENTS.md` for technical conventions.

---

## 1. Context & Goal

Steadii is currently complete through Phase 5 (Billing). Before α launch to 10 invited users, the UI is being fully redesigned. The human owner (Ryuto) considers the current UI "amateurish" and would be embarrassed to invite users to it. This redesign replaces the existing warm-academic aesthetic entirely.

**Goal**: Ship a Raycast/Arc-grade UI before α launch. Users should feel the app is built with the precision of a productivity tool, not a class project.

**Non-goals**: Changing product scope, data model, backend integrations, PRD §3.x feature definitions, or routing structure beyond what is specified here.

---

## 2. Locked Direction (do not re-propose)

- **Reference aesthetic**: Raycast + Arc. Cold-tech precision. Not warm academic.
- **The existing warm-academic palette and Instrument font family are discarded entirely.** Do not try to preserve them.
- **Tagline**: "Steady through the semester." with subcopy "Your classes, assignments, and mistakes — in one conversation."

---

## 3. Visual Tokens

Replace `app/globals.css` `@theme` and base layer with the following.

### 3.1 Fonts

```
--font-sans: "Geist", ui-sans-serif, system-ui, sans-serif;
--font-mono: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
/* --font-serif removed entirely; do not re-introduce */
```

Load Geist + Geist Mono via `next/font/google` or `next/font/local`. Drop all Instrument-family references.

### 3.2 Color tokens (HSL, Tailwind-compatible)

Light mode (default for no system preference):
```
--background:       45 14% 98%   /* #FAFAF9 */
--surface:          0 0% 100%    /* #FFFFFF */
--surface-raised:   40 14% 94%   /* #F3F1ED */
--border:           35 16% 87%   /* #E4E0DB */
--foreground:       30 12% 10%   /* #1A1814 */
--muted-foreground: 32 4% 40%    /* #6E6A64 */
--primary:          32 95% 44%   /* #D97706 electric amber light */
--primary-foreground: 45 14% 98%
--destructive:      0 72% 51%    /* #DC2626 */
--ring:             32 95% 44%
--radius:           0.375rem     /* 6px base */
```

Dark mode:
```
--background:       30 8% 4%     /* #0C0B0A */
--surface:          30 6% 8%     /* #151413 */
--surface-raised:   30 6% 11%    /* #1C1B19 */
--border:           30 6% 16%    /* #2A2725 */
--foreground:       40 34% 94%   /* #F5F1E9 */
--muted-foreground: 30 5% 53%    /* #8A8580 */
--primary:          38 92% 50%   /* #F59E0B electric amber dark */
--primary-foreground: 30 8% 4%
--destructive:      358 75% 59%  /* #E5484D */
--ring:             38 92% 50%
```

Mode default: `html { color-scheme: light dark; }` with system preference respected. Add a user toggle in Settings that stores `light | dark | system` in `users.theme_preference` (add the column in a migration).

### 3.3 Class-color palette (overrides PRD §3.5.1 rendering)

Map the existing Notion `select` values to these saturated hex values. Used only for 6px color dots, timeline bars, and class-detail accent lines — never as background fills.

```
blue:    #3B82F6
green:   #10B981
orange:  #F97316
purple:  #8B5CF6
red:     #EF4444
gray:    #6B7280
brown:   #92400E
pink:    #EC4899
```

### 3.4 Typography scale

```
display: 28 / -0.02em tracking
h1:      22 / -0.015em
h2:      18 / -0.01em
h3:      15 semibold
body:    14 / line-height 1.55  (reduced from current 15)
small:   13
mono:    13 tabular-nums
```

Apply via Tailwind utilities or CSS variables, your choice. Ensure `font-variant-numeric: tabular-nums` is set on all numeric content (times, counts, credits).

### 3.5 Shape, spacing, motion

- **Radius**: 6px base (`--radius`), 4px for pills/chips, 8px for large cards.
- **Spacing**: 4px grid. Rows 10–12px vertical padding. Cards 16–20px.
- **Shadows**: Minimal. Dark mode uses surface-raised brightness differences. Light mode uses 1px border + optional 1–2px y-offset subtle shadow.
- **Motion**: `transition: 160ms cubic-bezier(0.16, 1, 0.3, 1)` as the default. Hover 80ms. Page transitions 200ms cross-fade. No springs, no bounces.
- **Streaming indicator**: blinking tail cursor only (no typewriter effect, no token highlights).

### 3.6 Iconography

Lucide icons only. No emoji anywhere in the UI. Stroke width 1.5px. Size scale: 14 / 16 / 20 / 24px.

---

## 4. Information Architecture

### 4.1 Sidebar (5 items)

Replace the existing 7-item sidebar with exactly:

```
Home       /app
Chats      /app/chats
Classes    /app/classes
Calendar   /app/calendar
Settings   /app/settings
```

- Remove `Mistakes`, `Syllabus`, `Assignments`, `Resources` as top-level items.
- `Mistakes / Syllabus / Assignments / Chats` live as tabs inside `/app/classes/[id]` (§4.5).
- `Resources` management moves to `Settings → Resources`.
- Sidebar should support keyboard navigation (↑/↓ to move, Enter to activate, `g` then letter as shortcut jumps).

### 4.2 Home (`/app`) — Dashboard + Chat input (transitional)

Layout:

```
┌─────────────────────────────────────────┐
│  Dashboard (top)                        │
│   Card 1: Today's schedule              │
│   Card 2: Due soon                      │
│   Card 3: Past week retrospective       │
├─────────────────────────────────────────┤
│                                         │
│          [ Chat input box ]             │
│                                         │
└─────────────────────────────────────────┘
```

Behavior:
- On submit, navigate to `/app/chat/[newId]` (new route, pure chat view). Dashboard is gone on that route.
- Existing chats are accessed via sidebar → `Chats`.
- When user returns to `/app`, dashboard is visible again with input.
- Input supports text, image paste/upload, PDF upload (same as existing chat input).

### 4.3 Today dashboard cards (exactly 3, in this order)

**Card 1 — Today's schedule**
- Source: Google Calendar events for today (not just classes — include all events).
- Sort: time-ascending.
- Row format: `HH:MM — MM · {title} · {calendar name muted}`.
- Empty: "No classes or events today."

**Card 2 — Due soon**
- Source: `Assignments` DB rows where `Due ∈ [now, now + 72h]` and `Status ≠ Done`.
- Sort: due-ascending.
- Row format: `● {class color dot} · {title} · due {relative time, e.g. "in 14h"}`.
- Empty: "Nothing due. You're clear."

**Card 3 — Past week retrospective**
- Window: rolling 7 days ending today.
- Content structure:
  ```
  Past week · {MM/DD – MM/DD}
  ───────────────────────────
  {N} chats · {N} mistakes · {N} syllabi
  Focus: {top 1-2 classes by activity count}

  Pattern: {1-2 lightweight observations, e.g. "自由落下問題で3回詰まりました"}

  [ 復習する ]   [ 練習問題を生成 ]
  ```
- The "Pattern" lines: generate with GPT-5.4 Nano using recent mistake-note titles + tags. Use as a new agent tool `summarize_week(user_id)` that caches for 6h.
- Action buttons: "復習する" opens a chat pre-loaded with the top mistakes; "練習問題を生成" opens a chat with a prompt to generate similar problems.
- Empty (new user, <7d of data): "Not enough history yet. Come back next week."

### 4.4 Classes list (`/app/classes`)

Layout = **timeline strip on top + dense list below**.

```
┌────────────────────────────────────────────────────────┐
│ Today      CSC108 ──  MAT135 ──        PHY132 ──     │
│ Tomorrow   HIS109 ──           MAT135 ──             │
├────────────────────────────────────────────────────────┤
│ ● CSC108  Intro to Computer Science    Prof. Smith    │
│           Fall 2026 · Today 2pm · 2 due · 4 mistakes  │
│ ● MAT135  Calculus I                   Prof. Liu      │
│           Fall 2026 · Tue 10am · 1 due · 2 mistakes   │
│ …                                                      │
└────────────────────────────────────────────────────────┘
```

- Timeline strip: today + tomorrow. Each class session is a colored bar positioned by time, width = duration. Hover shows tooltip.
- List below: one row per class. Keyboard ↑/↓ + Enter to navigate to `/app/classes/[id]`.
- No grid/gallery alternative — reject if terminal Claude suggests it.

### 4.5 Class detail (`/app/classes/[id]`)

Header: large class name + code + professor + term + color chip. Below, tabs:

```
[ Syllabus ]  [ Assignments ]  [ Mistakes ]  [ Chats ]
```

- `Syllabus` tab: renders the saved Syllabi DB page for this class. If none: E5 empty state (§7.5).
- `Assignments` tab: dense list filtered to this class. Click row → Notion page.
- `Mistakes` tab: grid of mistake-note thumbnails (2–3 per row on desktop), click → chat rehydrated with that mistake's context.
- `Chats` tab: dense list of chats tagged with this class (auto-tagged by agent or manually). Click → open chat.

### 4.6 Chat screen (`/app/chat/[id]`)

Pure chat. No dashboard. Layout:

```
┌─────────────────────────────────────────┐
│ Class tag (if tagged) · share · rename  │
├─────────────────────────────────────────┤
│                                         │
│  user/assistant message stream…         │
│                                         │
├─────────────────────────────────────────┤
│         [ chat input, sticky bottom ]   │
└─────────────────────────────────────────┘
```

Tool call rendering (inline, collapsible — NOT side panel, NOT inline bubble):

```
✦ Creating calendar event
  ▸ Calendar: Personal
  ▸ When: Tue May 5, 10:00–11:00
  ▸ Title: MAT135
  [ ✓ Created ]
```

- While running: animated status line (single line).
- On completion: collapse to one-line summary; click to expand details.
- Monospace for field names and values. Amber accent for `✓` status.

Destructive confirms (inline in chat — NOT modal):

```
⚠ The agent wants to DELETE:
  "Physics Week 3" (Notion page)

  [ Cancel ]  [ Confirm deletion ]
```

Agent-proposed actions (pill buttons beneath the assistant response):

```
assistant: [explanation body…]

[ + 間違いノートに追加 ]   [ 類題を生成 ]
```

- Agent decides when to surface actions via system-prompt rules (already in `lib/agent/prompts/`). When the response is a problem explanation, surface "間違いノートに追加" + "類題を生成". When a syllabus preview, surface "Notionに保存".
- Also reachable via keyboard command palette (`⌘K`).

Source citations (footnote pills below answers):

```
Sources:  [ 📄 CSC108 Syllabus · Attendance ]  [ 📝 Physics Week 3 ]
```
(Icon replaced with Lucide per §3.6 — emoji shown above is illustrative only.) Click opens a side drawer with the referenced content preview and a "Open in Notion" link.

Attachments in user messages:
- Images: inline thumbnails, max 200×200px. Click opens full overlay.
- PDFs: filename pill with Lucide `file-text` icon. Click opens inline preview.

### 4.7 Calendar (`/app/calendar`)

Keep existing week/month views (PRD §3.10.2). Apply new tokens only. Do not redesign layout here — the existing calendar library renders are acceptable if themed correctly.

### 4.8 Settings (`/app/settings`)

Reorganize into sections (vertical list, dense):

```
Profile
Connections        (Notion, Google Calendar)
Resources          (registered Notion resources — moved from sidebar)
Agent behavior     (confirmation mode)
Usage & billing    (Credits bar, plan, Customer Portal)
Redeem code        (input + history)
Appearance         (light/dark/system toggle — new)
Language           (ja/en)
Danger zone        (delete account)
```

---

## 5. Components to Build / Rebuild

These are the core components. Terminal Claude may split into smaller pieces as needed, but the following must exist as documented props/behavior:

### 5.1 `<DashboardCard>`

Props: `title`, `children`, `empty?: { text, action? }`, `action?: { label, href, shortcut? }`.

Renders a card with:
- Header: title (h3 style) + optional shortcut hint in mono-muted
- Body: children, or empty state if no data
- Optional right-aligned action link

### 5.2 `<DenseRow>`

Reusable row for classes list, chats list, assignments, mistakes. Props: `leadingDot?: ClassColor`, `title`, `secondary?`, `metadata?: string[]` (shown as bullet-separated muted text), `rightContent?`, `onClick`.

Keyboard: entire row is focusable, Enter activates, arrow keys move between rows in a list container.

### 5.3 `<TimelineStrip>`

Horizontal 24h strip showing class sessions for today + tomorrow. Props: `days: Day[]` where `Day = { label, events: { start, end, title, color }[] }`.

### 5.4 `<ChatMessage>`

Handle user, assistant, tool-call, destructive-confirm, error variants. Tool-call is collapsible. Destructive-confirm blocks further chat send until resolved.

### 5.5 `<ActionPill>`

Pill button used for agent-proposed actions. Supports keyboard activation via `⌘K` menu registration.

### 5.6 `<SourcePill>`

Small inline chip showing a source. Click opens a side drawer with content preview.

### 5.7 `<CommandPalette>` (`⌘K`) — DEFERRED to post-α

See §12. Do not implement in this redesign. Keyboard ↑/↓ + Enter on dense lists gives a partial keyboard-power experience in the meantime.

---

## 6. Onboarding Flow

Refactor the existing onboarding at `/onboarding` to the flow below. Each step gets:
- Top: thin 4-dot progress indicator (step 1 of 4 etc.)
- Center: single clear action
- Bottom: "Why do we need this?" click-to-reveal disclosure

Steps:

1. **Sign in** (existing route). Hero copy = tagline.
2. **Connect Notion** — 1 sentence explaining what will happen.
3. **Connect Google Calendar** — 1 sentence explaining why.
4. **Auto-setup** — animated checklist as each DB is created (200ms stagger). Monospace check marks. Display the 5 items: parent page, Classes, Mistake Notes, Assignments, Syllabi.
5. **Optional: register existing resources** — `Skip for now` is equally prominent as `Add resources now`. Skip is the sensible default. Make clear it can be done later in Settings.

On completion, redirect to `/app`. New user lands on E1 empty state (§7.1).

**Resumability**: Store onboarding progress in `users.onboarding_step` so a user who closes the tab can resume. Add migration if column doesn't exist.

---

## 7. Empty & Error States

All empty/error states follow: **fact → next action**. Lucide icons, no emoji. Tone = 淡々 + occasional dry one-liner. Copy may be EN or JA depending on user's locale.

### 7.1 E1 — New user Home

Centered hero in place of the 3 cards:

```
         Welcome to Steadii

  Steady through the semester.

  Connect your first class to start seeing
  today's schedule, due assignments, and
  recent activity.

        [ + Add your first class ]

        or paste a syllabus
              ⌘ + V
```

### 7.2 E2 — Quiet day (existing user, nothing today)

Cards render, but with terse empty text:
- Today's schedule: "No classes or events today."
- Due soon: "Nothing due. You're clear."
- Past week: real content with "Light week. Take a breath." if activity count < 3.

### 7.3 E3 — No chats

```
No chats yet.
   [ Start a conversation ]
         ⌘N
```

### 7.4 E4 — No classes

```
No classes yet.
Classes are Steadii's core unit. Add one to start
tracking assignments, mistakes, and syllabi.
   [ + Add class ]
```

### 7.5 E5 — Class tab empty (syllabus)

```
No syllabus saved for {class code}.
Drop a PDF, paste a URL, or upload an image
and Steadii will extract the structure.
   [ Upload PDF ]  [ Paste URL ]
```

### 7.6 E6 — Class tab empty (mistakes)

```
No mistake notes for {class code} yet.
Paste a problem image in chat and ask for
an explanation to start your mistake notebook.
   [ Open chat ]
```

### 7.7 E7 — Search no results

```
No results for "{query}"
Try different keywords, or start a new chat
to ask about this topic.
   [ Ask in chat ]
```

### 7.8 R1 — Quota exceeded

```
⚠ You've used all 250 credits this month.
Credits reset on {date} ({n} days from now).
Upgrade to Pro for 1000 credits/month, or wait
for the reset.
   [ Upgrade to Pro — $20/mo ]   [ Redeem code ]
```

### 7.9 R2 — Integration disconnected

```
Notion connection expired.
Steadii can't read or write until you reconnect.
Your data is safe.
   [ Reconnect Notion ]
```

### 7.10 R3 — Tool execution failure

Render inline in chat as a tool-call card with `✗` state, error message, `[ Dismiss ] [ Retry ]` buttons.

### 7.11 R4 — File size exceeded

```
Can't upload "{filename}" ({size} MB).
Free plan allows up to 5 MB per file.
Compress the PDF or upgrade to Pro (50 MB).
   [ Compress in browser ]   [ Upgrade ]
```

(If browser-side compression is non-trivial, the first button can link to a tips doc instead.)

### 7.12 R5 — Offline

Thin strip at top of app shell:

```
⟳ Offline — changes will sync when reconnected
```

Chat send disabled; Notion/Calendar reads use last-cached data where possible.

### 7.13 R6 — OpenAI failure

Inline in assistant bubble:

```
Couldn't generate a response. OpenAI returned an
error ({reason}). Usually transient.
   [ Retry ]
```

---

## 8. Landing Page (`/`)

Rebuild to match redesign. Minimal structure:

```
[Nav: Steadii logo · Sign in]

    Steady through the semester.

    Your classes, assignments, and mistakes —
    in one conversation.

    [ Continue with Google ]

[Screenshot / product shot]

[3 value props, each 1 sentence]

[Footer: Privacy · Terms · Contact]
```

- Typography leans on `display` size for the hero.
- Single screenshot (dashboard view) is enough for α.
- Lighthouse performance ≥ 85 (Phase 6 acceptance criterion).

---

## 9. Implementation Order (Suggested)

1. **Tokens first** — update `app/globals.css`, load Geist/Geist Mono fonts. Verify dark/light toggle works.
2. **Shared components** — `<DashboardCard>`, `<DenseRow>`, `<TimelineStrip>`, `<ActionPill>`, `<SourcePill>`.
3. **Sidebar restructure** — 5-item nav, remove old items, add keyboard navigation.
4. **Home page** — dashboard + chat input. Build 3 cards. Wire `summarize_week` tool for Card 3.
5. **Classes list + detail** — timeline strip, dense list, tabs.
6. **Chat screen** — tool-call rendering, action pills, source pills, destructive confirms.
7. **Empty/error states** — apply systematically across the app.
8. **Onboarding refactor** — progress dots, check-mark animation, skip clarity.
9. **Settings reorg** — new sections, Appearance toggle.
10. **Landing page** — last, since it's the least-reused work.
11. **Cleanup** — delete dead components, old CSS, unused routes.

Each step should be a commit. Expected order is 10–12 commits. (Command palette `⌘K` deferred — see §12.)

---

## 10. Acceptance Criteria

- [ ] No trace of Instrument Sans/Serif or the warm-cream palette remains in the codebase.
- [ ] Light/dark/system theme toggle works; persists to `users.theme_preference`.
- [ ] Home route `/app` renders dashboard + chat input. Submitting the input routes to `/app/chat/[id]`.
- [ ] Sidebar has exactly the 5 items specified in §4.1. All old top-level routes (`/app/mistakes`, `/app/syllabus`, `/app/assignments`, `/app/resources`) redirect or are folded elsewhere.
- [ ] `/app/classes` shows timeline strip + dense list. Arrow keys + Enter navigate.
- [ ] `/app/classes/[id]` has the 4 tabs.
- [ ] Chat screen renders tool calls as inline collapsible cards, not as side panels.
- [ ] Destructive confirmations are inline in chat (not modals).
- [ ] Every empty state listed in §7 is reachable and matches the copy pattern.
- [ ] New-user onboarding completes in under 90 seconds with 4 progress dots visible.
- [ ] Lighthouse performance score on `/` ≥ 85.
- [ ] All 145+ existing tests still pass; new tests added for the `summarize_week` tool, theme toggle persistence, and sidebar keyboard navigation.
- [ ] Screenshot review by Ryuto: no screen feels "amateurish" (final subjective gate).

---

## 11. Non-Goals (do not expand scope into these)

- Mobile-native redesign (Phase 6 target is "doesn't break").
- SRS for mistake notes (v1.0+).
- Cross-platform proactive agent (v1.0 Morning Brief, v1.2+ intervention — see PRD §9.4).
- Real-time collaborative features.
- Marketing copy polish beyond the hero tagline.
- Changing the OpenAI model routing, billing logic, or Notion data schema.

---

## 12. Resolved Decisions (previously open)

These were decided by Ryuto during the design sparring. Do not re-open.

- **PDF browser compression** (§7.11 R4): **remove the compression button**. Keep the copy "Compress or upgrade" but no implementation. Client-side PDF compression is a deep rabbit hole not worth engineering for α 10 users.
- **Command palette** (`⌘K`, §5.7): **deferred to post-α**. Remove from §9 implementation order. Sidebar + chat cover primary operations. Keyboard ↑/↓ + Enter in dense lists still ships (partial keyboard-power retention). Revisit for β.
- **Existing in-flight chats on cutover**: **hard cutover**. All existing chats render with the new UI immediately. No date-based conditional styling. Rationale: in-flight chats are mostly dogfood data, date-branching complicates every component.

## 13. Skill Usage (Claude Code skills)

These skills help enforce quality during and after implementation. Do not invoke all of them — use only as specified.

**During implementation (terminal Claude invokes these)**:
- After each major component is built, invoke `design:design-system` to verify the visual tokens defined in §3 are being used consistently across all components. Catch hardcoded colors, off-scale spacing, non-Geist fonts.

**After implementation (human-invoked checkpoints)**:
- Run `design:design-critique` against screenshots of each major screen (Home, Chat, Classes list, Class detail, Settings, Onboarding). Goal: catch any screen that feels amateurish compared to Raycast/Arc reference.
- Before α launch, run `design:accessibility-review` once across the app to verify WCAG AA per PRD §4.6. Fix all flagged issues before ship.

**Do NOT use**:
- `design:design-handoff` — this document already serves that purpose.
- `design:ux-copy` — copy is already agreed with Ryuto; skill is not strong at Japanese review.
- `design:design-critique` on the current (pre-redesign) UI — it's being discarded wholesale, no value in critiquing it.

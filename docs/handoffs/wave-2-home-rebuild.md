# Wave 2 — Home rebuild (queue + command palette + briefing)

**Read `project_wave_2_home_design.md` (in user memory) FIRST.** That file is the locked design spec — everything in this handoff implements it. If anything in this handoff conflicts with the spec, the spec wins.

This wave rebuilds `app/app/page.tsx` (Home) into the agent-first command center the secretary pivot demands. Three layers: command palette → Steadii queue → today briefing + recent activity.

The page name stays **"Home" / 「ホーム」** — Steadii is the brand (sidebar logo), Home is the page (no double-branding).

## Setup

```bash
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
git status
git log --oneline -5
```

Most recent expected: PR #117 (post-Wave-1 follow-ups) merge or later. If main isn't there, **STOP** and flag.

Branch: `wave-2-home-rebuild`. Don't push without Ryuto's explicit authorization.

---

## Strategic context (re-read before touching code)

- `project_secretary_pivot.md` — overall pivot, secretary positioning
- `project_wave_2_home_design.md` — locked spec for Home (THIS WAVE)
- `feedback_self_capture_verification_screenshots.md` — engineers self-capture, never ask Ryuto
- AGENTS.md §12 (final report shape) and §13 (verification protocol)

---

## Scope

Eight sub-scopes, all in this PR. Order suggested but you can interleave:

### 1. Queue card system

Create `components/agent/queue-card.tsx` (or split across multiple files if size warrants — `queue-card-decision.tsx`, `queue-card-draft.tsx`, etc.). 5 archetypes per spec:

- **Type A — Decision-required**: bold border, primary color, large card, 2-3 explicit option buttons + Dismiss
- **Type B — Draft-ready**: muted bg, embedded draft preview snippet (3-4 lines), [Review] / [Send / Apply] / [Skip]
- **Type C — Soft notice**: minimal, low contrast, 1 primary action ("起案して") + Dismiss; user click upgrades to a Type B (Steadii drafts the action)
- **Type D — FYI / completed**: chip-style 1-line, very low contrast, [詳細] / [Undo (within window)]
- **Type E — Clarifying input**: muted, distinct icon (❓), radio choices + free-text fallback + [選んで進める] / [後で聞く] / [却下]

Each card receives:
- Title + body (terse)
- Source citation footer (reuse the existing thinking-bar pill style — `mistake-N`, `syllabus-N`, `calendar-N`, `email-N`; click → expanded detail with full thinking-bar)
- Confidence indicator on left card border (3-tier visual: vivid 4px / 2px low-opacity / no border + italic note "詳細確認推奨"; numeric % NOT shown)
- Relative timestamp ("5 分前"); click → absolute tooltip
- Origin link (jump to underlying data — email, event, syllabus chunk, etc.)

Interactions:
- Click body → opens expanded detail pane (right-side modal or inline expand — your choice)
- Click action button → optimistic UI, fires inline, surfaces 10-sec Undo banner if reversible (B always 10s; A only if reversible — calendar move yes, email send 10s, payment irreversible no Undo; D 24h Undo for low-risk auto-execute)
- Right-click (desktop) / long-press (mobile) → quick menu: Snooze 1h / 24h / 1 week / Dismiss permanently
- Default Dismiss button = 24h snooze; permanent dismiss is the long-press / quick-menu option

### 2. Steadii queue surface (the main Home content)

In `app/app/page.tsx`, replace the current dashboard / chat-input layout with the queue surface. The queue unifies:

- Phase 8 proactive proposals (existing `agentProposals` table, status='pending')
- W1 drafts to review (existing `agentDrafts` rows where status indicates pending review)
- Steadii-noticed suggestions
- Soft nudges (deadline approaching, group check-in due, etc. — these may need new generation logic; can stub for Wave 2 and fill out in Wave 3)
- Clarifying questions (Phase 8 D12 ambiguity-class, W1 ask_clarifying drafts)

Sort: **A → B → C → D → E**, newest-first within each group. Hard cap 5-7 visible, "もっと見る" expands inline (lean: inline expand, no separate `/app/queue` page).

Empty state: "queue は空です。Steadii が見守っています。…" + CTA button that focuses the command palette input.

### 3. Command palette (top of Home)

`components/chat/command-palette.tsx` (new file). Always docked top of Home, NOT sticky on scroll. Width capped at `max-w-2xl`, centered.

Default state:
```
┌──────────────────────────────────────────────┐
│ ⌘ Steadii に頼む…                              │
│   draft · schedule · move · check-in · cancel │
└──────────────────────────────────────────────┘
```

Placeholder rotates through example commands every 4 sec.

Focused state (input clicked, before typing):
- Recent commands (last 5, persisted in localStorage per-device, NOT synced to DB for Wave 2)
- Examples (3-5 rotating example phrases)

Tutor detection state (Wave 1's `lib/chat/scope-detection.ts` already exists):
- When tutor detected, the dropdown is replaced with the inline ChatGPT handoff offer (already wired in `components/chat/new-chat-input.tsx` from Wave 1 — reuse the same offer card UI here)
- Recent + Examples are hidden during tutor offer state

Cmd+K full overlay palette is **OUT OF SCOPE for Wave 2** — that's Wave 3+ polish. Wave 2 ships docked-top only.

### 4. Today briefing (below queue)

`app/app/page.tsx` continues below the queue with:
- Today's calendar events (from existing calendar fanout source)
- Today's tasks (open tasks due today)
- Next 3 deadlines across all sources

This replaces the current "dashboard cards" pattern. Reuse existing data sources where possible — `lib/agent/fanout.ts` likely has the right queries.

Visually subtle compared to the queue — the queue is the star, today is supporting context.

### 5. Recent activity footer (bottom of Home)

A collapsed section showing Steadii's recent audit log (autoExecuteEvents / agentProposals.status='resolved' / agentDrafts.status='sent' / etc.) — last ~10 entries. Click row → detail modal of what was done.

This is where Type D (FYI / completed) cards optionally collapse into. Engineer choice: keep Type D as queue items at the bottom, OR fold them into Recent activity entirely. Lean: **fold into Recent activity** — keeps the queue focused on actionable items.

### 6. Sidebar reorder

Update `components/layout/sidebar-nav.tsx` and `components/layout/nav-items.ts`:

```
Steadii (logo, unchanged)
─────
🏠 Home          gh
📥 Inbox         gi
📅 Calendar      gc
✅ Tasks         gt
🎓 Classes       gk
─────
💬 履歴           gj    (renamed from チャット — JA only, EN can stay "Chats" or become "History")
⚙ 設定          gs
```

Add a visible separator (or subtle visual break) between primary nav (Home → Classes) and secondary (履歴 / Settings).

Mistakes is NOT in sidebar — engineers from Wave 1 already removed it. Verify it stays removed.

EN locale rename: "Chats" → "Recent" (or "History" — your call, use the term that reads natural in EN). JA: 「チャット」 → 「履歴」.

### 7. Onboarding adjustment — Step 3 commitment + wait

Replace the current Step 3 of onboarding with a commitment + wait screen:

> Steadii が直近 7 日のメールを読んで、最初の draft を準備します。
> 通常 ~24h 後に Home に最初の提案が表示されます。push 通知で知らせます。
> その間、何か頼みごとがあればここから:

Below this message, render the command palette focused (or a simplified version of it). User can dispatch a command immediately if they want, or just close onboarding and wait.

Trigger a push notification when the first queue item lands for that user (use the W1 dogfood `agent-trigger.ts` as reference for how to fire the user-facing notification, OR queue a digest event — pick the simpler path).

If push notifications aren't already wired (web push permission flow / service worker), add the minimum viable wiring. If wiring is too involved for Wave 2, gate behind a feature flag and fall back to email-only notification of the first queue item — flag this in the report.

### 8. Notification tier matrix

Per spec, Wave 2 wires per-archetype notification routing:

| Type | Push (immediate) | Daily digest | In-Steadii |
|---|---|---|---|
| A (Decision) | ✓ | summary | always |
| B (Draft-ready) | batch 1×/day | ✓ | always |
| C (Soft notice) | none | ✓ (weekly summary level) | always |
| D (FYI) | none | none | always |
| E (Clarifying) | only if blocking voice/cmd | none | always |

Settings panel should expose per-tier opt-out toggles. Add UI in `app/app/settings/notifications.tsx` (or wherever notification prefs live).

---

## Verification

For each touched surface, capture screenshots @ 1440×900 in BOTH locales (EN + JA). Per AGENTS.md §13.

Specific captures needed:

- New Home (`/app`) populated with each archetype A/B/C/D/E (mock data is OK if real fanout doesn't yield variety — capture the rendering, not the data)
- New Home empty state (queue empty, command palette CTA visible)
- Command palette default state + focused state + tutor-detection state (reuse Wave 1's offer card)
- Sidebar with reordered items (expanded state + shortcut chips)
- Onboarding new Step 3 (commitment + wait copy)
- Notification settings panel with per-tier toggles

---

## Tests

- Typecheck must pass (the 2 pre-existing `tests/handwritten-mistake-save.test.ts` failures stay)
- `pnpm test` must stay above 775/775 — no regressions

New tests:
- `tests/queue-card.test.tsx` — render each archetype with a fixture, assert primary/alt actions exist, assert confidence-tier border classes apply correctly
- `tests/command-palette.test.tsx` — focus state shows recent + examples, typing tutor query swaps to handoff offer, escape closes
- `tests/notification-routing.test.ts` — given (archetype, user pref), correct channel set fires
- Sidebar reorder doesn't need new tests if the existing nav-items test still passes

---

## What NOT to touch

- The Phase 8 proactive agent itself (the ENGINE that produces proposals) — Wave 2 only redesigns the SURFACE
- W1 draft generation pipeline — same, surface change only
- Mistake notes / OCR pipeline — Wave 1 closed this, don't reopen
- Voice cleanup logic — out of scope
- Existing translation key namespace structure — only add new keys, don't restructure
- Backend prompts — out of scope
- `app/app/inbox/*` — Inbox stays as-is (the "show me everything triaged" surface; Home is the "show me what needs me" surface)
- `app/app/chat/[id]/*` — chat thread page unchanged

If you find yourself wanting to refactor Inbox or chat to share the queue-card system, **flag it for Wave 2.5** — out of this PR's scope.

---

## Final report format

Per AGENTS.md §12:

1. **Branch / PR name**: `wave-2-home-rebuild`
2. **Summary**: per-scope what you changed
3. **Verification screenshots**: list above, all 1440×900, EN + JA pairs
4. **Tests added**: queue-card / command-palette / notification-routing
5. **Memory entries to update**: anything that's now firmer or contradicted from `project_wave_2_home_design.md`
6. **Out-of-scope flags**: anything you noticed for Wave 2.5 / 3 / etc.

---

## Estimated effort

- Scope 1 (queue-card system): ~2 days (5 archetypes + interactions + confidence visual + Undo)
- Scope 2 (queue surface query + sort): ~1 day (mostly aggregation logic)
- Scope 3 (command palette): ~1 day (rendering + dropdown + tutor handoff reuse)
- Scope 4 (today briefing): ~0.5 day (existing data, light surfacing)
- Scope 5 (recent activity footer): ~0.5 day (audit log query + render)
- Scope 6 (sidebar reorder): ~0.5 day (mostly mechanical)
- Scope 7 (onboarding step 3 + push notif wiring): ~1 day (push permission flow may add complexity)
- Scope 8 (notification tier matrix): ~1 day (UI + routing)

Total ~7-8 days. Single PR, single branch.

If push notification wiring is more involved than expected, flag and gate Scope 7's notification piece behind a feature flag — don't block the rest of Wave 2 on it.

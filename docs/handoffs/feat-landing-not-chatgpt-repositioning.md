# Landing repositioning — "Not ChatGPT" thesis (mega-PR)

This is a single bundled PR rewriting the landing page around one thesis:

> **Steadii is not a general AI. It understands your context (classes, professors, syllabi, group projects) and acts autonomously — before you ask.**

Three substantial changes, shipped together. Per `feedback_handoff_sizing.md` this is mega-handoff territory — do NOT split.

## Setup

```bash
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
git status
git log --oneline -5
```

Branch: `feat-landing-not-chatgpt`. Don't push without Ryuto's explicit authorization.

---

## Strategic context

- Thesis lock decided by Ryuto 2026-05-10: differentiate from general AI, emphasize autonomy + context-awareness.
- Current LP order: Hero → Boundaries → What you do → `steadii_in_motion` → Founding CTA.
- New LP order: **Hero → Morning Briefing (NEW) → Boundaries (rewritten) → What you do (unchanged) → A Week with Steadii (NEW, replaces in-motion) → Founding CTA.**
- The "证拠 → ポジショニング → 持続性" beat: Morning Briefing proves the claim, Boundaries names it, A Week shows it's persistent.
- `feedback_self_capture_verification_screenshots.md` — you self-capture screenshots @ 1440×900, do not ask Ryuto.
- `feedback_tailwind_v4_comment_parse.md` — careful with `/app/...` patterns inside CSS comments.

---

## File map

### Modify
- `app/(marketing)/page.tsx` — reorder sections, swap imports, build new copy props for the two new components.
- `app/(marketing)/_components/boundaries-section.tsx` — 3-card grid → 2-card A/B grid, remove the Sparkles/Eye/Play icon row (the Learning/Deciding/Doing axis is gone).
- `lib/i18n/translations/en.ts` — add `morning_briefing` block, add `week` block, REPLACE `boundaries.cards` shape (learning/deciding/doing → chatgpt/steadii), DELETE `steadii_in_motion` block (no consumer after this PR).
- `lib/i18n/translations/ja.ts` — mirror all of the above.

### Create
- `app/(marketing)/_components/morning-briefing.tsx` — new server component.
- `app/(marketing)/_components/week-with-steadii.tsx` — new client component (scroll-revealed timeline).

### Delete
- `app/(marketing)/_components/proactive-mock.tsx` — only consumer is the marketing page, which is migrating to `week-with-steadii.tsx`. Verify no other ref via `rg "ProactiveMock|proactive-mock"` then delete.

---

## i18n schema changes

`MessagesShape` in `lib/i18n/translations/en.ts` — under `landing:`:

**ADD:**

```ts
morning_briefing: {
  title: string;
  subhead: string;
  card_datetime: string;
  card_greeting: string;
  card_intro: string;
  context_label: string;
  item1_headline: string;
  item1_action: string;
  item1_context: string;
  item2_headline: string;
  item2_action: string;
  item2_context: string;
  item3_headline: string;
  item3_action: string;
  item3_context: string;
  card_close: string;
};
week: {
  title: string;
  subhead: string;
  context_label: string;
  moment1_time: string;
  moment1_event: string;
  moment1_action: string;
  moment1_context: string;
  moment2_time: string;
  moment2_event: string;
  moment2_action: string;
  moment2_context: string;
  moment3_time: string;
  moment3_event: string;
  moment3_action: string;
  moment3_context: string;
  moment4_time: string;
  moment4_event: string;
  moment4_action: string;
  moment4_context: string;
  moment5_time: string;
  moment5_event: string;
  moment5_action: string;
  moment5_context: string;
};
```

**REPLACE** the existing `boundaries.cards` shape:

```ts
boundaries: {
  title: string;
  subhead: string;
  cards: {
    chatgpt: { who: string; key: string; body: string };
    steadii: { who: string; key: string; body: string };
  };
};
```

**DELETE** the entire `steadii_in_motion` block (type + values in both en.ts and ja.ts). No consumer after this PR.

Run `pnpm typecheck` after every i18n edit — TypeScript will catch any dangling references.

---

## Copy — EN

### Boundaries (rewritten)

```
landing.boundaries.title:
  "Not ChatGPT."

landing.boundaries.subhead:
  "Everyone uses ChatGPT. But ChatGPT waits for you to ask. Steadii doesn't wait — it understands your classes, your professors, your inbox, and acts the moment something matters."

landing.boundaries.cards.chatgpt.who:    "ChatGPT"
landing.boundaries.cards.chatgpt.key:    "Waits to be asked."
landing.boundaries.cards.chatgpt.body:
  "Every conversation starts from scratch. It doesn't know your CS 348 syllabus, doesn't see Prof. Tanaka's emails, doesn't watch your week. You drive every turn."

landing.boundaries.cards.steadii.who:    "Steadii"
landing.boundaries.cards.steadii.key:    "Already moving."
landing.boundaries.cards.steadii.body:
  "Knows your syllabi. Watches your inbox. Drafts replies in your voice. Surfaces what matters, hides what doesn't. You approve. It learns."
```

### Morning Briefing (NEW)

```
landing.morning_briefing.title:
  "Your morning, already organized."

landing.morning_briefing.subhead:
  "Steadii runs 24/7. By the time you check your phone, your day is already briefed — what matters, what's coming, what you owe."

landing.morning_briefing.card_datetime:  "Wed · May 13 · 7:31 AM"
landing.morning_briefing.card_greeting:  "Good morning, Ryuto."
landing.morning_briefing.card_intro:     "Three things matter today."
landing.morning_briefing.context_label:  "Knows"

landing.morning_briefing.item1_headline:
  "Prof. Tanaka moved office hours to Friday 2 PM"
landing.morning_briefing.item1_action:
  "Reply ready — confirms you can make it, asks your Q3 question."
landing.morning_briefing.item1_context:
  "your last 3 threads with Prof. Tanaka"

landing.morning_briefing.item2_headline:
  "CS 348 Assignment 3 — due tomorrow 23:59"
landing.morning_briefing.item2_action:
  "You haven't opened it. Syllabus suggests ~4 hours. Blocked 19–23 for you."
landing.morning_briefing.item2_context:
  "your CS 348 syllabus, your calendar"

landing.morning_briefing.item3_headline:
  "Group project standup, 3 PM"
landing.morning_briefing.item3_action:
  "Brief attached — where you left off Tuesday, what Mei still owes."
landing.morning_briefing.item3_context:
  "your Notion, last meeting transcript"

landing.morning_briefing.card_close:
  "This is how every morning starts."
```

### A Week with Steadii (NEW)

```
landing.week.title:
  "A week with Steadii."

landing.week.subhead:
  "Five moments from one student's week. Steadii is the line connecting them."

landing.week.context_label: "Knows"

landing.week.moment1_time:    "Mon · 8:47 PM"
landing.week.moment1_event:   "Prof. Tanaka moves the midterm to Tue 5/20."
landing.week.moment1_action:
  "Reply drafted. Conflict with your Tuesday lab surfaced. Suggested moving lab to Wednesday morning."
landing.week.moment1_context: "the existing thread, your calendar"

landing.week.moment2_time:    "Tue · 6:14 AM"
landing.week.moment2_event:   "CS 348 PS 3 due Friday — you haven't started."
landing.week.moment2_action:
  "Estimated 4 hours from the syllabus weighting. Blocked Wed 7–11 PM. Re-surfaced the prerequisite chapter you skimmed last week."
landing.week.moment2_context: "your syllabus, your study history"

landing.week.moment3_time:    "Wed · 2:58 PM"
landing.week.moment3_event:   "Group standup in 2 minutes."
landing.week.moment3_action:
  "Brief in your hand: what you finished Monday, what Mei still owes, what the team decided last Thursday."
landing.week.moment3_context: "your Notion, meeting transcripts, the last 4 Slack threads"

landing.week.moment4_time:    "Thu · 11:23 PM"
landing.week.moment4_event:   "You: 'I'm sick tomorrow.'"
landing.week.moment4_action:
  "Drafted 3 absence emails — one per Friday class. Listed missed assignments per class. Suggested asking Tomoko for ECON notes."
landing.week.moment4_context: "your timetable, your classmates"

landing.week.moment5_time:    "Sun · 7:30 AM"
landing.week.moment5_event:   "Your week is ready."
landing.week.moment5_action:
  "What's coming, what you owe, what slipped last week. Three things to look at before Monday."
landing.week.moment5_context: "your whole semester"
```

---

## Copy — JA

### Boundaries (rewritten)

```
landing.boundaries.title:
  "ChatGPT ではありません。"

landing.boundaries.subhead:
  "みんな ChatGPT を使っています。でも ChatGPT はあなたが聞くのを待ちます。Steadii は待ちません — あなたの授業、教授、受信箱を理解し、何かが起きた瞬間に動きます。"

landing.boundaries.cards.chatgpt.who:    "ChatGPT"
landing.boundaries.cards.chatgpt.key:    "頼まれないと動きません。"
landing.boundaries.cards.chatgpt.body:
  "毎回ゼロから会話が始まります。あなたの CS 348 シラバスも、田中教授からのメールも、今週の予定も知りません。すべての一手をあなたが引きます。"

landing.boundaries.cards.steadii.who:    "Steadii"
landing.boundaries.cards.steadii.key:    "すでに動いています。"
landing.boundaries.cards.steadii.body:
  "シラバスを知っています。受信箱を見ています。あなたの口調で返信を草稿します。大事なものを浮かせ、ノイズを隠します。承認はあなた、学習は Steadii。"
```

### Morning Briefing (NEW)

```
landing.morning_briefing.title:
  "朝、すでに整っています。"

landing.morning_briefing.subhead:
  "Steadii は 24時間動いています。朝スマホを見る頃には、今日大事なこと、これから来るもの、追っているものが、もう整理されています。"

landing.morning_briefing.card_datetime:  "5月13日(水) 7:31"
landing.morning_briefing.card_greeting:  "おはようございます、Ryuto さん。"
landing.morning_briefing.card_intro:     "今日大事なのは3つです。"
landing.morning_briefing.context_label:  "知っているもの"

landing.morning_briefing.item1_headline:
  "田中教授がオフィスアワーを金曜14時に変更"
landing.morning_briefing.item1_action:
  "返信草稿あります — 出席可と伝え、Q3の質問もまとめました。"
landing.morning_briefing.item1_context:
  "田中教授との過去3スレッド"

landing.morning_briefing.item2_headline:
  "CS 348 課題3 — 明日23:59 締切"
landing.morning_briefing.item2_action:
  "まだ未着手です。シラバス上は約4時間、今夜19-23時を確保しました。"
landing.morning_briefing.item2_context:
  "CS 348 シラバス、カレンダー"

landing.morning_briefing.item3_headline:
  "15時 グループプロジェクト定例"
landing.morning_briefing.item3_action:
  "ブリーフ準備済み — 火曜の進捗、Mei さんのタスク残り。"
landing.morning_briefing.item3_context:
  "Notion、前回議事録"

landing.morning_briefing.card_close:
  "毎朝、ここから始まります。"
```

### A Week with Steadii (NEW)

```
landing.week.title:
  "Steadii と過ごす一週間。"

landing.week.subhead:
  "ある学生の一週間、5つの瞬間。Steadii がそれを繋いでいます。"

landing.week.context_label: "知っているもの"

landing.week.moment1_time:    "月 20:47"
landing.week.moment1_event:   "田中教授が中間試験を5/20(火)に変更"
landing.week.moment1_action:
  "返信草稿を用意。火曜のラボとの衝突を検知、水曜午前への移動を提案しました。"
landing.week.moment1_context: "既存スレッド、カレンダー"

landing.week.moment2_time:    "火 6:14"
landing.week.moment2_event:   "CS 348 PS3 金曜締切 — まだ未着手"
landing.week.moment2_action:
  "シラバスの配点から4時間と見積もり、水曜19-23時を確保。先週流し読みした前提章も再掲しました。"
landing.week.moment2_context: "シラバス、学習履歴"

landing.week.moment3_time:    "水 14:58"
landing.week.moment3_event:   "15時のグループ定例まであと2分"
landing.week.moment3_action:
  "ブリーフ準備完了 — 月曜の進捗、Mei さんの残タスク、先週木曜の合意事項。"
landing.week.moment3_context: "Notion、議事録、過去4 Slack スレッド"

landing.week.moment4_time:    "木 23:23"
landing.week.moment4_event:   "あなた:「明日休みます」"
landing.week.moment4_action:
  "金曜3クラス分の欠席連絡草稿、未提出課題リスト、智子さんに ECON ノート依頼の提案も用意しました。"
landing.week.moment4_context: "時間割、クラスメート"

landing.week.moment5_time:    "日 7:30"
landing.week.moment5_event:   "今週の準備が整いました"
landing.week.moment5_action:
  "これから来るもの、あなたが追っているもの、先週流れたもの。月曜までに見るべき3点。"
landing.week.moment5_context: "学期のすべて"
```

---

## Component specs

### `boundaries-section.tsx` — rewrite

- Drop the lucide icon row (`Sparkles` / `Eye` / `Play`) and the `ICONS` const. The Learning/Deciding/Doing conceptual axis is gone; ChatGPT vs Steadii doesn't need iconography.
- 2-card grid: `md:grid-cols-2`.
- First card (ChatGPT, light): `background: var(--bg-raised)`, `border: 1px solid var(--line)`. Text `var(--ink-1)`.
- Second card (Steadii, dark, holo mesh): keep current dark treatment + `<HoloMesh opacity={0.45} blur={40} />`. White text.
- Card body structure:
  - `who` label — font-mono, 11px, uppercase, `tracking-[0.08em]`, muted color
  - `key` headline — 28px (md: 32px), semibold, `tracking-[-0.02em]`, JA uses `var(--font-jp)`
  - `body` paragraph — 14px, 1.5 leading, slightly muted
- Min-height card: 240px (or auto if grid forces equal height) — let cards size to content but keep them visually balanced.

### `morning-briefing.tsx` — NEW (server component)

Pattern after `boundaries-section.tsx` (server component, async, uses `getTranslations` + `getLocale`).

Section wrapper: `<section className="relative mx-auto max-w-[1280px] px-6 py-16 md:px-12">` matching boundaries.

Heading + subhead use the same scale as boundaries (32-36px h2, 16px subhead).

The brief card itself: phone-screen feel, NOT a literal phone chrome.

- Card container: `max-w-[480px] mx-auto` (centers the brief, narrow column reads like a phone), `bg-white`, `border border-black/[0.06]`, `rounded-[16px]`, `shadow-[0_30px_80px_-20px_rgba(20,20,40,0.18)]`, padding ~24px.
- Soft gradient backdrop layer underneath, similar to `proactive-mock.tsx` lines 113–121 (radial gradients with low-opacity amber + lavender).
- Card top: `card_datetime` in font-mono, 11px uppercase, muted. Small horizontal hairline below.
- `card_greeting` — 17px, semibold, `var(--ink-1)`.
- `card_intro` — 14px, `var(--ink-3)`, mt-1.
- Three numbered items (mt-5 between intro and items, gap-4 between items):
  - Item layout: number badge (small circle, font-mono `1` `2` `3`) on the left OR inline above headline. Lean: inline badge before headline, single line: `<span class="badge">1</span> <strong class="headline">...</strong>`.
  - `headline` — 15px, semibold, `var(--ink-1)`, 1.35 leading.
  - `action` — 13.5px, `var(--ink-3)`, 1.5 leading, mt-1.
  - Context tag — small mono row, mt-1.5, format: `⊙ {context_label}: {item_context}`. Use `Sparkles` lucide icon (size 11, strokeWidth 1.6) instead of `⊙` unicode for visual consistency with the rest of the app. Color: `#8579A8` (the iridescent amber-lavender accent). Font: font-mono, 11px, `tracking-[0.04em]`.
- Hairline above `card_close` (`border-t border-black/[0.06] mt-5 pt-4`).
- `card_close` — 13px, italic OR mono, `var(--ink-3)`, centered. Lean italic for a softer landing.

No animation. Static section. The card IS the proof — it doesn't need to perform.

### `week-with-steadii.tsx` — NEW (client component)

Pattern after `proactive-mock.tsx` (client component, `useEffect` + `IntersectionObserver` for scroll reveal, accepts a typed `copy` prop, honors `prefers-reduced-motion`).

Page-side (`page.tsx`) builds the `weekCopy` prop similar to how `proactiveCopy` is built today — pull each translation key into a flat object.

Component structure:

- Section wrapper matches boundaries-section.
- Title + subhead.
- 5 moments in a vertical timeline. On md+ use `max-w-[680px] mx-auto`.
- Each moment is a horizontal row card:
  - Left rail (`w-[88px] md:w-[112px]`): timestamp in font-mono, 11px uppercase, `tracking-widest`, muted (`var(--ink-4)`). Optional small connector dot.
  - Right content (`flex-1`):
    - `event` — 15-16px semibold, `var(--ink-1)`, 1.3 leading.
    - `action` — 14px, `var(--ink-3)`, 1.5 leading, mt-1.
    - Context tag — same `Sparkles + {context_label}: {context}` pattern as Morning Briefing, mt-1.5, mono 11px, `#8579A8` accent.
- Between moments: vertical connector line (1px wide, `var(--line)`) running through the left rail. Subtle dot at each timestamp anchor. Implement with absolute positioning OR with a `relative` rail container that has `before:` pseudo-element.
- **Last moment (Sunday)** gets the punchline treatment: subtle amber-tinted background (`bg-[#8579A8]/[0.04]`), softer border, slightly larger context tag. The "your whole semester" / 「学期のすべて」 line should land harder than the rest.
- Scroll reveal: IntersectionObserver fires on first viewport entry, then chain 5 fade-ins. Interval shorter than `proactive-mock.tsx` STEPS (current 400/1500/1500) — use roughly `[300, 800, 800, 800, 800]` so the timeline fills in within ~3.5s without forcing scroll-pause.
- `prefers-reduced-motion`: skip animation, render all 5 immediately.

### `page.tsx` — section reorder

1. Hero `<section>` — unchanged.
2. **Insert `<MorningBriefing />`** immediately after the hero section closes, before `<BoundariesSection />`. No outer `<main>` wrapper — it can sit at top level like BoundariesSection.
3. `<BoundariesSection />` — same call site, will internally render the rewritten 2-card layout.
4. Inside `<main>`:
   - "What you do" section — unchanged.
   - **Replace** the "Steadii in motion" section with the new Week section.
     - Drop the old section heading wrapper and `<ProactiveMock />` call.
     - Add a new `<section>` wrapper (same `landing-strip` divider + heading scale) that hosts `<WeekWithSteadii copy={weekCopy} />`.
     - Build `weekCopy` from `t("landing.week.*")` keys, same flat-object pattern used for `proactiveCopy`.
   - Drop the trailing `landing.steadii_in_motion.real_screen` line — no longer relevant.
5. `<FoundingCta />` — unchanged.
6. Footer — unchanged.

Remove the old `proactiveCopy` block entirely. Remove the `ProactiveMock` import.

---

## Visual continuity rules

- The `⊙ {context_label}: {value}` tag pattern is the moat signature. Same `Sparkles` icon, same `#8579A8` accent, same font-mono 11px in all three places (Morning Briefing items, Week moments, anywhere else context is surfaced). Define a small `ContextTag` helper component if it ends up rendered in both new files — lives in `app/(marketing)/_components/context-tag.tsx`.
- Section heading scale: 32px (md:44px), semibold, `tracking-[-0.02em]`, `var(--ink-1)`, JA uses `var(--font-jp)`. Match what's in `page.tsx` for the other section headings.
- Subhead scale: 16-18px, 1.55 leading, `var(--ink-3)`.

---

## Verification checklist

Run before declaring done. Self-capture screenshots — do not ask Ryuto.

1. **Type check**: `pnpm typecheck` — must pass. No `any` casts to silence i18n errors.
2. **Build**: `pnpm build` — must pass.
3. **EN/JA key parity**: every key in `en.ts` exists in `ja.ts` and vice versa. Visually diff the `landing` blocks.
4. **No dangling references**: `rg "steadii_in_motion|ProactiveMock|proactive-mock|boundaries.cards.learning|boundaries.cards.deciding|boundaries.cards.doing" --type ts --type tsx` returns zero results.
5. **Dev server up** via `preview_start`.
6. **Screenshots @ 1440×900** (`preview_screenshot`):
   - `/` EN — full page scroll, capture each section: Hero, Morning Briefing, Boundaries (2-card), What you do, A Week, Founding CTA.
   - `/` JA — same set, after toggling locale.
7. **Mobile @ 390×844** (`preview_resize`):
   - Morning Briefing card stacks correctly, no horizontal scroll.
   - Boundaries 2-card stacks into 1-column.
   - Week timeline left-rail timestamps remain readable; connector line still aligned.
8. **Reduced motion**: in Chrome DevTools → Rendering → Emulate `prefers-reduced-motion: reduce`. Reload. Confirm Week section renders all 5 moments without animation delay.
9. **Console**: `preview_console_logs` — no errors.

Report each step pass/fail with the screenshot file paths.

---

## Out of scope (do NOT touch)

- Hero copy / `landing.headline` / `landing.subhead` — separate decision pending.
- `HeroAnimation` video below hero — stays.
- `VoiceDemo` placement inside "What you do" — stays.
- Founding CTA — stays.
- Locale toggle, nav, footer — stay.

If you find yourself wanting to change one of these mid-PR, surface it as a follow-up note in the PR description, don't fold it in.

---

## PR

Title: `feat(landing): "Not ChatGPT" repositioning — Morning Briefing + Boundaries rewrite + Week timeline`

Body: 1-paragraph thesis + 3-bullet change summary + screenshot links from the verification step + the test-plan checklist (mark each item done).

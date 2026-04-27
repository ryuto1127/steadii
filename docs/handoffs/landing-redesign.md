# Landing Redesign — Cluely × Granola hybrid + chat-base agentic narrative

Engineer-side handoff for the marketing landing page revamp. ~3
engineer-days at memory pace (~half day at Claude Code speed).

This is the marketing surface that turns first-time visitors into α
applicants. Phase 8 just shipped the proactive-agent moat; the
landing has to communicate that capability clearly enough that
non-engineer students "get it" within 10 seconds of arrival.

---

## Why this exists

Ryuto's diagnosis from sparring 2026-04-26:

> もっと近未来的であり、さらに使い方をユーザーに明確に伝える必要が
> あります。このagentic study support appは新しく、本土の人がその
> 使い方をイメージしにくいため、動画などでも伝える必要があります。
> 特に、chat baseですべて自動でできるのは、みんなイメージしにくく、
> ほとんどの人がいまだに手動で追加したりしていると思います。

The current landing (`app/(marketing)/page.tsx`):
- Static text + mock-dashboard image
- Clean but doesn't convey "agent does work for you"
- 4 value-prop cards with feature-claim copy
- No motion, no demo, no flow

This redesign replaces that with a Cluely × Granola hybrid:
- Dark, tech-forward visual language (electric amber accent stays)
- Autoplay demo video as the hero element (not a "Watch it work"
  CTA — show, don't ask)
- Section flow that walks the reader from "what" → "how" → "why"
- Chat-base + agentic-proactive narrative threaded through

---

## Setup

```
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
git status   # clean
git log --oneline -3
```

Most recent expected: Phase 8 (`feat(agent): Phase 8 — proactive
agent + bundled polish`). If main isn't at that or later, **STOP**.

Branch: `landing-redesign`. Don't push without Ryuto's explicit
authorization.

---

## Locked design decisions (sparring → 2026-04-26)

Treat as canonical.

### V1 — Visual direction: Cluely × Granola hybrid

**Cluely contributions:**
- Autoplay product demo as hero (not a CTA — the video IS the hero)
- Dark base palette
- Tight, tech-forward typography
- Subtle neon-ish accent on key elements

**Granola contributions:**
- Calm, focused tone (not overcaffeinated startup energy)
- Demo shows the agent doing real work (not "look how cool it is"
  marketing reel)
- Generous whitespace inside dense sections

**Hold from current locked design** (`memory/project_pre_launch_redesign.md`):
- **Geist + Geist Mono** font pair (no change)
- **Electric amber** as the single accent (#F59E0B dark / #D97706
  light)
- **6-px base radius**
- **Raycast/Arc density** principle — minimal but rich

**Drop from current landing:**
- The static `<Screenshot>` mock-dashboard component (replaced by
  the real demo video)
- The 4-card "value props" grid as it stands (recomposed inside the
  new section flow)

### V2 — Section structure (7 sections)

1. **Hero** (above the fold) — autoplay demo video as the dominant
   visual; minimal copy beside or below it; one CTA.
2. **What you do** — "you talk to Steadii in chat. That's it." —
   3 chat-input examples with the agent's resulting actions.
3. **Steadii in motion** — the proactive-agent flow Ryuto outlined
   (calendar travel + syllabus exam → conflict proposal → email
   draft + reschedule option). Either a second autoplay video or a
   step-by-step animated mock.
4. **How it works** — 3 steps (Connect → Watch → Trust).
5. **Glass box** — recomposed value props (verbatim, exportable,
   transparent reasoning, you confirm every send).
6. **Founding member** — α invite-only framing + Request access CTA.
7. **Footer** — privacy / terms / contact / `α · subject to change`.

The locked tagline + subcopy + feature-line strings stay (don't
touch the i18n strings under `landing.headline` /
`landing.subhead` / `landing.value_props.yours.body`).

### V3 — Demo video strategy: hybrid (1 hero video + per-section animation)

- **One hero video** (~30 seconds, autoplay+muted+loop): captures
  the 3 user journeys Ryuto picked (email triage / chat → calendar /
  Phase 8 proactive conflict). Recorded by Ryuto himself against the
  live product (see "Demo video shot list" below).
- **Per-section CSS animations** (Framer Motion or pure CSS): small
  inline mocks reinforcing the hero — chat-input typing,
  notification pop, action-button hover, etc. Lighter than embedding
  multiple videos.

### V4 — No "Watch it work" CTA

The video plays automatically. Don't gate it behind a button. The
visitor sees Steadii doing things within 1 second of page load.
Cluely pattern.

### V5 — Locale handling: next-intl auto-detect

The existing next-intl setup resolves locale from cookie →
Accept-Language → fallback `en`. Honor the same path on landing.
Manual locale toggle goes in the **footer** (not the header — keep
the header minimal). 95% of users get correct locale from
auto-detect; the 5% bilingual override case clicks the footer
toggle.

JA primary copy quality ≥ EN at α. EN polish completes before NA
launch in Aug-Sept.

### V6 — Three user journeys for the hero video (Ryuto-confirmed)

1. **Email triage + draft** — inbox shows multiple incoming emails,
   Steadii classifies high/medium/low risk, drafts a reply for the
   high-risk professor email.
2. **Chat → Calendar** — user types one line ("金曜 14 時に田中先生と
   meeting") in the chat input; calendar event appears.
3. **Phase 8 proactive flow** — user adds a multi-day calendar
   event (a trip); Steadii detects conflict with a syllabus-listed
   midterm; surfaces a notification with multi-action menu (email
   professor / reschedule / dismiss); user picks email, draft is
   ready to send.

The third journey is the moat-revealing one — it's the journey
that demonstrates Steadii is not "just chat with a notion
plug-in" but a true agent.

---

## Section-by-section spec

### Section 1 — Hero (above the fold)

Layout: 60/40 split on desktop, vertical stack on mobile.

Left side (60% on desktop):
- Small `α — invite only` mono pill at top (matches current
  `landing.alpha` string)
- Headline (`landing.headline` — locked: "Steady through the
  semester.") in `font-display`, ~48-56px desktop / 36-40px mobile
- Subhead (`landing.subhead` — locked) in muted body color
- Single primary CTA: "Request α access" → `/request-access`
- Secondary link below: "Already approved? Sign in →" → `/login`
- (NO "Watch it work" CTA — the video plays without prompt)

Right side (40% on desktop):
- The hero video, rounded `rounded-lg` border, autoplay+muted+loop+
  playsinline. Aspect ratio 16:10 or 4:3 (whatever feels right with
  the recording — verify shot composition).
- Video file: `public/demo/hero.mp4` + `public/demo/hero.webm`
  fallback. Engineer wires `<source>` for both.
- A subtle dark overlay (10-15% opacity) over the video to keep the
  amber CTA on the left readable across video frames.

Mobile: video stacks ABOVE copy.

### Section 2 — What you do ("you talk; Steadii acts")

Three cards, side-by-side on desktop, stacked on mobile. Each card
shows ONE chat input → one resulting action.

```
┌─────────────────────────────────┐  ┌─────────────────────────────┐  ┌─────────────────────────────┐
│ You type:                       │  │ You type:                   │  │ You type:                   │
│ "金曜 14 時に田中先生と meeting" │  │ "数学 II の試験範囲どこ?"   │  │ "明日大学行けないかも"      │
│                                 │  │                             │  │                             │
│ ──→ [Calendar event added]      │  │ ──→ Reads your syllabus     │  │ ──→ Drafts emails to today's│
│                                 │  │     ──→ "Chapter 3-5,       │  │     professors + offers     │
│                                 │  │     midterm 5/16, focus on  │  │     calendar absence-mark   │
│                                 │  │     §3.4 limits"            │  │                             │
└─────────────────────────────────┘  └─────────────────────────────┘  └─────────────────────────────┘
```

Each card uses subtle CSS animation: when the card enters viewport
(IntersectionObserver), the chat-input text "types in" character by
character (~30ms per char) followed by the resulting action sliding
in. Plays once per page-view. Resets if user re-scrolls past it.

Section header: "Just chat. Steadii does the rest." / "話すだけ。あとは Steadii が動く。"

Subhead: "No buttons to find, no menus to navigate. The chat input is the entire app." / "ボタン探しもメニュー操作も不要。チャット入力だけが Steadii の操作画面。"

### Section 3 — Steadii in motion (the moat reveal)

The Phase 8 agentic flow. Either:

A. **Second video** — a separate ~20-second clip showing Ryuto
   adding a trip to calendar, the inbox notification appearing,
   the multi-action proposal expanding, the email draft loading.

B. **Animated mock** — pure CSS / Framer Motion sequence walking
   through the same flow with Steadii UI screenshots.

Engineer's call. (A) is more authentic; (B) is more controllable
and faster-loading. (B) is also a fallback if the live recording
quality is variable.

Section header: "And it watches your back." / "そして、先回りもする。"

Body copy (under header, ~80-100 chars):

EN: "Steadii reads your syllabus, calendar, and recent mistakes —
then surfaces what you'd otherwise miss."

JA: "シラバス、カレンダー、過去の間違い。Steadii はそれを横断して読み、
あなたが見落とすことに気づきます。"

Then the demo (video or animated mock).

Below the demo, a small grey caption: "Real screen. No mocks." /
"実画面。モックではありません。" — emphasizes authenticity.

### Section 4 — How it works (3 steps)

Three numbered cards horizontally:

```
1. Connect
   Sign in with Google. Steadii reads your inbox + calendar.
   Setup ≈ 90 seconds.

2. Watch
   Steadii triages your emails, watches for conflicts, drafts
   replies. You see everything; nothing sends without you.

3. Trust
   Use the dismiss button when Steadii is wrong. It learns. The
   more you use it, the more it gets you.
```

Each step has a small lucide icon (Plug / Eye / Sparkles) in
electric amber, centered above the number.

Optional: a thin connector line between steps on desktop.

### Section 5 — Glass box

Single section, NOT a 4-card grid. Header + 4 short paragraphs OR
a small accordion.

EN copy:

> ## Glass box, all the way down.
>
> Every reason behind every decision is visible. Click the
> reasoning panel under any draft and you see what the agent read,
> what it weighed, and which past emails it cited.
>
> Your data stays yours. Verbatim mistakes, syllabi, and
> assignments. Yours to read, search, and export — never locked in.
>
> Nothing sends without you. Every outgoing message rides a 20-second
> undo and your explicit approval. The staged-autonomy mode that
> auto-sends low-stakes drafts is opt-in and per-user.

JA copy mirrors this structure.

The locked feature-line ("Verbatim mistakes, syllabi, and
assignments. Yours to read, search, and export — never locked in.")
is preserved as the second paragraph.

### Section 6 — Founding member CTA

A single small block, electric-amber-accented:

```
α is invite-only — 10 students this round.

Founding members get permanent price-lock at signup rate, plus
early access to every feature ahead of NA public launch (Sept 2026).

[Request α access]
```

CTA → `/request-access` (same as hero).

### Section 7 — Footer

Keep the existing footer mostly intact:
- Privacy
- Terms
- Contact (mailto:hello@mysteadii.xyz)
- `α · subject to change` mono pill on the right
- **NEW**: locale toggle on the right (next to the α pill)

Locale toggle: small `EN / JA` text-button pair, current locale in
foreground color, other in muted; click sets the locale cookie and
reloads.

---

## Demo video shot list (for Ryuto to record)

Total runtime ~30 seconds. Shoot at desktop 1280×800 incognito
window (clean Chrome state, no extensions visible).

**0:00–0:08 — Email triage**
- Open `/app/inbox` with at least 6 fresh emails (mix of professor
  / TA / newsletter). Steadii has already classified them — High /
  Medium / Low badges visible.
- Cursor hovers, then clicks the High-tier email at the top.
- Detail page opens: tier badge, subject, body, ThinkingBar, draft
  pre-rendered.
- Don't click Send (not part of this clip — leave the queue look
  at "ready to act").

**0:08–0:18 — Chat → Calendar**
- Cut to chat (`/app/chat/[some chat]` or new chat).
- Cursor types: "金曜 14 時に田中先生と meeting" into the input
  (real keystrokes, not edited paste).
- Submit; agent response streams in: short ack + tool-call indicator
  for `calendar_create_event`.
- Cut to `/app/calendar`; the new event is visible on Friday 14:00.
- (Implicitly demonstrates D13 — agent acts on the chat message
  immediately, no buttons clicked.)

**0:18–0:30 — Phase 8 proactive conflict**
- Cut to `/app/calendar`; cursor adds a multi-day event (Tokyo
  trip, e.g. 5/15–5/17).
- Subtle fast-forward visual ("…数秒後…") if the scanner takes >5s
  in real life. Otherwise keep it real-time.
- Inbox notification ("⭐ Important — 5/16 Math II 中間試験と旅行
  が重なります") appears.
- Click → detail page. The proactive proposal renders: issue
  summary, reasoning citing syllabus + calendar, multi-action menu
  (email professor / reschedule trip / dismiss).
- Cursor hovers over "email professor"; the email-draft modal
  starts loading.
- Fade to brand mark + α invite copy.

**Recording tools:**
- macOS QuickTime (File → New Screen Recording)
- Or Loom (built-in fast-edit, but exports with a small Loom logo
  unless paid)
- Or `cmd+shift+5` (macOS native) for full-screen with audio

**Editing notes:**
- No audio narration. Background silence or a very subtle ambient
  loop (royalty-free) at -25dB.
- 1280×800 base, scale to 1280×720 if 16:9 looks better in the
  hero layout.
- Export: H.264 MP4 + VP9 WebM, both ~3-5MB target. Use HandBrake
  for the WebM if needed.
- Drop both files at `public/demo/hero.mp4` and
  `public/demo/hero.webm`.

If recording quality is uneven, fall back to per-segment animated
mocks (per V3 — Section 3 alternative B). Engineer wires the
`<video>` and the page works either way; missing video = poster
image fallback (`public/demo/hero-poster.png`, also Ryuto-supplied).

---

## i18n key plan

Most existing keys under `landing.*` stay. Add:

```ts
landing: {
  ...existing,
  cta_request_access: "Request α access" / "α アクセスをリクエスト",   // exists
  cta_already_approved: "Already approved? Sign in" / "既に承認済の方: サインイン",  // exists
  what_you_do: {
    title: "Just chat. Steadii does the rest." / "話すだけ。あとは Steadii が動く。",
    subhead: "No buttons to find, no menus to navigate. ..." / "...",
    cards: {
      calendar: { input: "金曜 14 時に田中先生と meeting", action: "Calendar event added" / "予定に追加" },
      syllabus: { input: "数学 II の試験範囲どこ?", action: "Reads your syllabus and tells you. ..." / "シラバスを読んで答える。..." },
      absence: { input: "明日大学行けないかも", action: "Drafts emails to today's professors and offers a calendar absence-mark." / "今日の教授に一斉欠席連絡 draft + カレンダー mark を提案。" },
    },
  },
  steadii_in_motion: {
    title: "And it watches your back." / "そして、先回りもする。",
    body: "Steadii reads your syllabus, calendar, and recent mistakes — then surfaces what you'd otherwise miss." / "シラバス、カレンダー、過去の間違い。...",
    real_screen: "Real screen. No mocks." / "実画面。モックではありません。",
  },
  how_it_works: {
    title: "How it works",
    steps: {
      connect: { title: "Connect", body: "Sign in with Google. ..." / "..." },
      watch: { title: "Watch", body: "Steadii triages your emails, watches for conflicts. ..." / "..." },
      trust: { title: "Trust", body: "Dismiss when Steadii is wrong. It learns. ..." / "..." },
    },
  },
  glass_box: {
    title: "Glass box, all the way down." / "全部、ガラス箱の中。",
    paragraph_reasoning: "...",
    paragraph_yours: "...",  // = existing `value_props.yours.body`
    paragraph_confirm: "...",
  },
  founding: {
    headline: "α is invite-only — 10 students this round." / "α は招待制 — 今回は 10 名のみ。",
    body: "Founding members get permanent price-lock at signup rate, ..." / "...",
    cta: "Request α access" / "α アクセスをリクエスト",   // = cta_request_access
  },
  locale_toggle: { en: "EN", ja: "JA" },
},
```

Keep the existing `landing.alpha` / `landing.headline` / `landing.subhead` /
`landing.value_props.*` keys live (still referenced from header and
glass-box composition).

The existing `landing.mock.*` keys can be removed — the
`<Screenshot>` mock dashboard goes away. Verify no other consumer
references them before deletion (`grep -r "landing.mock"`).

---

## Animation patterns

Use **Framer Motion** if it's already a dependency; if not, hand-roll
with CSS `@keyframes` + IntersectionObserver — don't add a new
dependency for the first pass.

Animations to wire:

- **Hero CTA** — gentle pulse on the "Request α access" button (1
  cycle per ~3s, very subtle scale 1.0 → 1.02 → 1.0). Stops on hover.
- **Section 2 chat-input typing** — text appears char-by-char over
  ~1s when the card enters viewport. Then the action arrow slides
  in. Plays once per session per card.
- **Section 3 demo (if option B)** — sequenced reveal: calendar
  event slides in → inbox notification pops in → detail page
  expands → action menu unfurls → cursor hovers email button. ~6s
  total loop with a 2s pause before restart.
- **Footer locale toggle** — instant (no animation; just a state
  flip).

All animations respect `prefers-reduced-motion` — when the user has
that set, animations skip to their final state.

---

## Implementation notes

**Routing**: The existing `app/(marketing)/page.tsx` IS the route
`/`. Replace its body wholesale; keep the `(marketing)` layout file
as-is (it provides the global font + theme wrapper).

**Video element**:
```tsx
<video
  autoPlay
  muted
  loop
  playsInline
  preload="auto"
  poster="/demo/hero-poster.png"
  className="w-full rounded-lg border border-[hsl(var(--border))]"
>
  <source src="/demo/hero.webm" type="video/webm" />
  <source src="/demo/hero.mp4" type="video/mp4" />
</video>
```

**Locale toggle**: Set the `STEADII_LOCALE` cookie (or whatever the
existing next-intl config uses — verify in `lib/i18n/request.ts`),
then `router.refresh()` to re-render with the new locale. No
client-side state hack — let the server resolve it.

**Server vs client**: Section 1 hero, Section 4 how-it-works,
Section 5 glass-box, Section 6 founding, Section 7 footer can all
stay server-rendered. Sections 2 and 3 need client components for
the IntersectionObserver-driven animations. Mark only the necessary
subtrees `"use client"`.

**Dark theme as default for landing**: The current site supports
both light and dark per user preference (Settings → Appearance),
but the LANDING should lean dark for the futuristic feel — Cluely
pattern. Force the landing route to dark via a wrapper class even
if the user's app preference is light. Inside `/app/*`, the user's
preference still wins.

The simplest implementation: wrap the landing page tree with a
`className="dark"` and the existing CSS variables resolve to the
dark palette. Or scope a `.landing-dark { ... }` class. Engineer
picks the cleaner option.

---

## PR plan

Two PRs.

### PR 1 — Static restructure (~1 day)
Branch: `landing-redesign-structure`

- Wholesale rewrite of `app/(marketing)/page.tsx`
- New i18n keys in `lib/i18n/translations/{en,ja}.ts`
- 7 sections renderable, hero video tag with **placeholder src** /
  poster (Ryuto records video later)
- Locale toggle in footer
- Forced-dark wrapper for landing route
- Animations on Sections 2 + 3 (Section 3 = animated mock fallback;
  swap to second video later if Ryuto records that too)
- Remove the existing `<Screenshot>` mock and its
  `landing.mock.*` i18n keys

Smoke-test with the placeholder; deploy looks identical functionally
(routes work, copy renders, layout responds), just with a poster
image where the video will go.

### PR 2 — Video integration + final polish (~0.5 day)
Branch: `landing-redesign-video`

- Drop the actual `hero.mp4` + `hero.webm` + `hero-poster.png` into
  `public/demo/` (Ryuto-supplied)
- Wire `<source>` tags
- Verify autoplay works on Safari (iOS + macOS), Chrome, Firefox
  — `playsInline` + `muted` + `autoPlay` should be sufficient on
  modern browsers
- (Optional) Replace Section 3 animated mock with a second short
  video if Ryuto records one
- Lighthouse pass on `/` desktop + mobile, target Performance ≥85,
  Accessibility ≥90
- Final completion report at
  `docs/handoffs/landing-redesign-completion-report.md`

PR 2 can land asynchronously after PR 1 — the placeholder works
fine until video is ready.

---

## Out of scope

- **A/B testing** of headline / CTA variants — α scale doesn't
  warrant it
- **Tracking pixels / analytics** beyond the existing Sentry
  instrumentation — α invite-only, no marketing funnel needed
- **Press kit / brand asset page** — defer to public launch
- **Demo video for "syllabus auto-import" or "ask_clarifying" flows**
  — not in the chosen 3 journeys; can be added post-α if observation
  shows they're worth surfacing
- **Animated gradient hero background** — over-design, conflicts
  with the dark-with-amber accent palette
- **Full Lottie animation library wiring** — out of scope for v1;
  CSS + IntersectionObserver covers what we need
- **Internationalization beyond JA + EN** — Phase B (Japan launch
  derivative) territory if it ever happens; α stays bilingual as is

---

## Constraints

- Locked decisions in `memory/project_pre_launch_redesign.md` are
  sacred. The Geist font pair, electric-amber accent, and 6-px
  base radius do NOT change. The locked tagline ("Steady through
  the semester.") and feature-line ("Verbatim mistakes...") do NOT
  change.
- Pre-commit hooks must pass; no `--no-verify`.
- Conversation Japanese; commits + PR body English.
- Don't push without Ryuto's explicit authorization.
- The video file path is `/demo/hero.{mp4,webm}`. If it's not
  there at deploy time, the `<video>` falls back to the poster
  image gracefully (browser default behavior — verify in Safari
  too).

---

## Context files to read first

- `app/(marketing)/page.tsx` — current landing, replace
- `app/(marketing)/layout.tsx` if exists — check for global font /
  theme wrapper
- `lib/i18n/translations/{en,ja}.ts` — add new keys, remove
  `landing.mock.*` after smoke-testing
- `lib/i18n/request.ts` — verify the cookie name + locale-
  resolution chain for the footer toggle
- `components/theme/theme-toggle.tsx` if relevant — pattern for
  client-side preference flip
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_pre_launch_redesign.md`
  — locked visual constraints (Geist, amber, radius, density)
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_steadii.md`
  — phase state (Phase 8 just shipped)
- `AGENTS.md`, `CLAUDE.md` if present

---

## When done

After PR 2 lands (or PR 1 if PR 2 is deferred), report back with:

- All PR URLs + commit hashes
- Verification log:
  - Lighthouse Performance ≥85 desktop + ≥85 mobile
  - Lighthouse Accessibility ≥90 both viewports
  - Hero video autoplays in Safari (iOS + macOS), Chrome, Firefox
  - Section 2 chat-input animation triggers on viewport entry,
    only once per session
  - Section 3 demo (animated mock or video) loops correctly
  - Locale toggle in footer flips the page locale and persists via
    cookie
  - Forced-dark wrapper applies to `/` only — `/app/*` still
    respects user theme preference
  - All copy renders in EN and JA without missing-key errors
- Deviations from this brief + one-line reason for each
- Open questions for the next work unit (likely α invite send +
  observation)

The next work unit (α invite send + Ryuto's first 10 invitations
going out) picks up from there.

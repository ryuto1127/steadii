# Rebrand — skin-swap (visual layer only, behavior locked)

> **STATUS: SUPERSEDED 2026-05-02 — Path A taken (engineer-22 cut entirely).**
>
> Ryuto evaluated the lighter color-calm intervention (PR #122 — `polish(landing): tone down hero palette`) and decided it satisfied the "too colorful" complaint that triggered this rebrand effort. Full holographic rebrand (Claude Design's cascade arcs / Logomark refresh / voice-modal vibe upgrade / `/app` token swap) is **not shipping**. Engineer-22 cycle skipped; queue advances directly to engineer-23 (Wave 5 — `wave-5-launch-prep.md`).
>
> This doc is kept as historical reference. If a future cycle revisits the holographic direction, the operating principle, do-not-touch list, color-restraint directive, and phase structure below remain reusable.

---

**Read these first** (memory):
- `feedback_role_split.md`, `feedback_prompts_in_english.md`, `feedback_self_capture_verification_screenshots.md`
- `project_secretary_pivot.md` — Steadii positioning (chief of staff, not tutor)
- `project_pre_launch_redesign.md` — **SUPERSEDED visual lock**. Sidebar IA still valid. Visual aesthetic NO LONGER VALID — replaced by Claude Design output (this PR ships the replacement).
- `feedback_ai_aesthetic_unreliable.md` — visual judgment is Ryuto's eye via Claude Design, not engineer guess. Don't substitute taste; implement what Claude Design specified.
- `project_wave_2_home_design.md` / `project_wave_3_design.md` — behavioral specs, **must not regress**.
- AGENTS.md §11–§13 (conventions, handoff contract, screenshot capture).

---

## The single operating principle

> **Logic stays. Style swaps. Behavioral tests stay green; visual regressions are expected and OK.**

If you find yourself touching:
- Component props / interfaces
- Routes / navigation structure
- Form handlers / submission logic
- Queue archetype behavior, command palette behavior, scope detection logic
- i18n keys (parity gate from polish-19 still in force)
- Test logic in `tests/`

…**stop.** That's behavior, not skin. Out of scope.

If you're touching:
- CSS tokens (color / radius / shadow / gradient / motion timing values)
- Tailwind utility classes on existing components
- SVG / decorative elements (cascade arcs, holo gradients)
- Logomark assets
- Font loading

…that's skin. In scope.

---

## Visual restraint directive (Ryuto, 2026-05-02)

The Claude Design output is correct in **direction** (holographic, voice-demo signature, three nested gradient arcs) but **too colorful** as currently tuned. Ryuto's correction:

1. **Reduce distinct color count.** The 3-anchor palette (`--holo-1` / `--holo-2` / `--holo-3` — likely cyan / magenta / lime in the design source) reads as too saturated, too chromatic, too playful. The Steadii vibe needs to be calm secretary, not party app.
2. **Substitute distinct colors with gradients of pale tones.** Where the design uses 3 separate hues, instead use a single gradient that traverses pale / desaturated stops within a narrower hue range. Think pearlescent / iridescent surface, not a rainbow.
3. **Specifically:**
   - `<CascadeArcs>`: instead of 3 colored arcs (cyan / magenta / lime), use 3 arcs that are gradients of the SAME pale family at different opacities / blend modes — the "holographic shimmer" comes from gradient layering, not distinct colors
   - `<HoloText>` gradient: 2 stops max, both pale / low saturation. Don't run a 3-color rainbow through display type
   - `<HoloMesh>`: keep the atmospheric blur but tune saturation way down — should read as "warm neutral with a hint of color" not "neon plasma"
   - `<Waveform>` bars: single pale color OR 2-stop gradient, not cycling through 3 distinct hues
4. **Use the existing amber (`hsl(32 95% 44%)`) primary as a quiet anchor**, not a loud accent. It can warm the gradient family rather than being replaced.
5. **Test by squinting**: if the page reads as "many colors" rather than "one calm surface with subtle iridescence", the saturation is still too high. Dial back further.

This is taste, not behavior — Ryuto's eye per `feedback_ai_aesthetic_unreliable.md` is the source of truth. If a specific decision is unclear, capture both versions as screenshots and let sparring forward to Ryuto. Don't ship the louder version "to play it safe" — error toward calmer.

---

## Recommended split: ship landing FIRST as a focused PR

The landing (Phase 4) is most public-facing and the immediate aesthetic decision gate. Per `feedback_handoff_sizing.md`, when a decision gate applies, splitting is justified.

**Suggested PR sequencing:**

- **PR 1 (this branch, `rebrand-skin-swap`)** — Phase 1a–1d (token additions only, no value swaps to existing tokens) + Phase 2 (visual primitives) + Phase 4 (landing). Phase 3 (existing /app surfaces) and Phase 5 (voice modal) NOT in this PR.
- **PR 2 (follow-up branch, `rebrand-app-surfaces`)** — Phase 1 token VALUE swaps + Phase 3 (/app surfaces) + Phase 5 (voice modal). Lands after Ryuto evaluates PR 1's landing aesthetic.

Why split: PR 1's landing is the visual judgment moment. If Ryuto evaluates the landing and the calm/gradient direction is wrong, PR 2 hasn't shipped yet and the token VALUE swaps can be re-tuned without touching all of /app. Recovery granularity.

If you (engineer) disagree with the split based on what you see during implementation, flag it in the final report — don't unilaterally bundle.

---

## Setup

```bash
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
git status
git log --oneline -5
```

Most recent expected: PR #121 (Wave 3) or any sparring inline hotfix landing after. If main isn't there, **STOP**.

Branch: `rebrand-skin-swap`. Don't push without Ryuto's explicit authorization.

---

## Inputs from Claude Design (ATTACHED separately by Ryuto / sparring)

This handoff depends on three artifacts that sparring will paste into the chat **alongside** this doc:

1. **`tokens.css`** — Claude Design's full token sheet (palette / type / radius / shadow / gradient / motion). Source of truth for all visual values.
2. **`Steadii Home.html` rendered** + component source (`home.jsx`, `queue-cards.jsx`, `components.jsx`, `tweaks-panel.jsx`) — the `/app` visual reference.
3. **`Landing.jsx`** — full landing source. Already shared in chat; if you don't have it, ask sparring to repaste.

Plus: rendered screenshots @ 1440px width of both Home and Landing. Use these as visual ground truth when restyle output diverges.

If any of the above is missing when you start, **STOP and ask sparring**.

---

## Phase 1 — Token foundation (THE prerequisite)

Everything else depends on this phase landing first.

Current token shape (`app/globals.css`):
- Tailwind v4 `@theme` block with `--font-*`, `--radius`
- `:root` / `.dark` blocks with HSL components consumed via `hsl(var(--background))` pattern
- Amber primary, warm cream canvas

Claude Design `tokens.css` uses different names (`--bg-page`, `--ink-1`, `--holo-1`, etc.) and likely hex/oklch values.

**Strategy: map by role, not by name.** Existing component code consumes `var(--background)`, `var(--foreground)` etc. — do NOT rename across the codebase. Instead:

### 1a. Replace token VALUES in `:root` / `.dark`

For each existing token, swap its value to the Claude Design equivalent:

| Existing | Claude Design role-equivalent |
|---|---|
| `--background` | `--bg-page` |
| `--surface` | `--bg-raised` (the floating island) |
| `--surface-raised` | `--bg-sunken` or whatever Claude Design uses for hover/tile |
| `--border` | `--line` |
| `--foreground` | `--ink-1` |
| `--muted-foreground` | `--ink-2` or `--ink-3` (pick the closer match — Claude Design likely has a 4-step ink scale) |
| `--primary` | the **single accent** Claude Design uses for CTAs (likely a holo gradient anchor color; pick the solid-fallback) |
| `--destructive` | `--critical` |
| `--ring` | match `--primary` |

Convert Claude Design values to HSL components if they're hex/oklch — keep the `hsl(var(--background))` consumption pattern intact. (Claude Design may already use oklch — Tailwind v4 supports it; if so, you can switch consumption from `hsl(var(--background))` to `var(--background)` directly, but only if you do it consistently. Pick one and stay there.)

### 1b. Add NEW Claude Design tokens

Anything that doesn't have an existing equivalent gets ADDED to `:root` / `.dark`:

- `--holo-1`, `--holo-2`, `--holo-3` (the 3 chromatic anchors — cyan/magenta/lime per `project_pre_launch_redesign.md` SUPERSEDED note, but trust whatever Claude Design's `tokens.css` actually says)
- `--gradient-holo`, `--gradient-holo-mesh` (the signature gradients used in cascade arcs / atmospheric blur)
- `--shadow-1`, `--shadow-2`, `--shadow-3` (the depth scale from voice modal etc.)
- `--r-3`, `--r-4` (radius scale used by Claude Design components)
- `--font-jp` if Claude Design specifies a JP-specific font stack
- Any motion / easing tokens

Keep these in `.dark` if Claude Design provides dark variants; mirror what they do.

### 1c. Update `@theme` block

Tailwind v4's `@theme` block exposes tokens as Tailwind utilities. Add:
- New radius scale
- New shadow scale if the Claude Design scale is named differently
- Holo colors if Claude Design intends them as Tailwind classes (e.g. `bg-holo-1`)

### 1d. Logomark replacement

Existing logo: `app/icon.svg` + any inline SVG in `components/layout/` sidebar.

Replace with Claude Design's "three nested gradient arcs" logomark. Generate at:
- `app/icon.svg` (favicon, 32×32)
- `app/apple-icon.png` (Apple touch, 180×180)
- `app/opengraph-image.tsx` (OG, 1200×630) — update inline SVG / text rendering
- Sidebar usage in `components/layout/sidebar*.tsx` — replace inline logo

Match what Claude Design's `Logomark` component renders. If size prop differs, plumb it.

### 1e. Font loading

If Claude Design uses different fonts (e.g. JP serif accent), update `app/layout.tsx`'s font imports. Otherwise leave Geist.

---

## Phase 2 — Visual primitive library

Claude Design's output uses several reusable visual primitives that aren't currently in the repo. Extract these to `components/ui/visual/` so all surfaces can consume:

- `<CascadeArcs />` — the SVG cascade of 3 gradient arcs from voice demo. Animated. Source: Claude Design `landing.jsx` `CascadeArcs` function.
- `<HoloMesh />` — atmospheric blurred gradient background. Used in hero / Founding CTA. Pure CSS, can be a styled `<div aria-hidden>`.
- `<Waveform />` — animated voice waveform bars. Source: `landing.jsx` `Waveform` function.
- `<HoloText>` — wrapper that applies the gradient text treatment to children. Likely a className like `holo-text` defined in globals.css.
- `<Logomark size={n} />` — already needed by Phase 1d, formalize the component here.
- `<CitationPill source="syllabus" id="3" />` — mono pill for citations (`syllabus·3`, `email·42`). Replace any existing citation chips.

Each should accept className passthrough, a11y-correct (`aria-hidden` for purely decorative), and have a sane default size.

Write minimal Vitest snapshot tests for visual smoke (component renders, no console errors). Behavioral tests aren't relevant for these.

---

## Phase 3 — Surface restyle (existing `/app`)

Walk every existing surface and apply the new tokens + selectively add visual primitives where natural. The component logic is untouched; only utility classes / inline styles change, plus optional decorative elements added.

**Order of restyle (P1 → P3):**

### P1 surfaces (must land in this PR)
- `app/app/page.tsx` (Home — Wave 2 design, queue cards) — apply new tokens; add `<CascadeArcs />` + `<HoloMesh />` to empty state and ambient atmosphere; archetype card titles get `<HoloText>` on accent words; queue card edges adopt confidence-indicator visual (4px gradient edge / 2px low-op / no edge per Claude Design)
- `components/layout/sidebar*.tsx` — new tokens; logomark swapped (Phase 1d)
- `app/app/chat/[id]/page.tsx` — new tokens; loading states (`Drafting…`, `Listening…`) get `<HoloText>`; citations replaced with `<CitationPill>`
- `app/app/inbox/` (if it exists post-Wave-3) — new tokens

### P2 surfaces
- `app/app/calendar/page.tsx` — tokens
- `app/app/classes/[id]/page.tsx` — tokens
- `app/app/settings/**` — tokens
- `app/(auth)/**` — tokens; logomark
- Onboarding flows — tokens; logomark
- Empty states project-wide — `<CascadeArcs />` where there's natural breathing room

### P3 surfaces
- `app/access-pending/`, `app/access-denied/` — tokens
- `app/invite/[code]/` — tokens
- Error states (`global-error.tsx`) — tokens
- Email templates if any (server-rendered) — tokens

**Rule: never invent.** If a surface doesn't have a Claude Design reference, apply tokens only; do NOT add holo decorations on your own judgment. Per `feedback_ai_aesthetic_unreliable.md`, visual taste isn't engineer's call.

---

## Phase 4 — Landing skin-swap (existing → Claude Design)

Existing landing: `app/(marketing)/page.tsx` (last touched in `landing-redesign-pr2-holographic.md`).

Claude Design provides a complete `Landing.jsx` reference. **Do not paste Landing.jsx as-is** — it's a design-tool prototype with inline styles, demo state, and hardcoded copy. Instead:

1. Use existing `app/(marketing)/page.tsx` as the structural baseline (data sources, routes, i18n keys, form submissions, auth wiring all stay)
2. Refactor section by section to match Claude Design's `Landing.jsx` visual composition:
   - `LandingNav` — match nav structure if existing matches (logo, link list, lang toggle, CTA); reuse existing if shape aligns, else borrow Claude Design's layout
   - `Hero` — replace existing hero with voice-demo composition (cascade arcs + transcribing text + materializing queue card). Use `<CascadeArcs />`, `<Waveform />` from Phase 2. The transcribing demo text + animation states should be a small client component (`HeroVoiceDemo`); reference `Landing.jsx`'s `VoiceDemo` function for state machine (listening → transcribing → drafting → done with timing constants `700ms`, `32ms`, `350ms`, `1500ms`, `5500ms`)
   - `ValueProps` — 4-column grid as in `Landing.jsx`; use existing i18n keys for content; eyebrow gets `<HoloText>`
   - `WhatYouDo` — 3-card "you / Steadii" composition; third card is dark with `<HoloMesh />` per `Landing.jsx`
   - `SteadiiInMotion` — embeds the Home page at scale. **Use existing Home component**, scaled via CSS transform per `Landing.jsx` (`transform: scale(0.86)`). Don't fork; same source = always-fresh marketing peek
   - `FoundingCTA` — dark + holo-mesh; CTAs wired to existing routes (`/request-access`, `/invite/[code]` if applicable)
   - `Footer` — new tokens; minimal

3. **Copy / fact-check is OUT of scope** for this PR. Use existing copy / i18n keys verbatim. Sparring's separate copy review will land in a follow-up. If `Landing.jsx` hardcodes claims like "200 early students at Todai/Keio/Waseda", **don't carry those over** — keep existing copy.

4. Bilingual: existing JA/EN `next-intl` wiring stays. Claude Design's Landing.jsx hardcodes `lang === "ja"` branches — translate those into i18n keys against `lib/i18n/translations/{en,ja}.ts`. **i18n parity gate (polish-19) must stay green** — `pnpm i18n:audit` returns 0 findings.

---

## Phase 5 — Voice modal vibe upgrade

Voice input was already shipped (post-α plan in memory but actually shipped earlier — verify in repo, likely under `components/voice/` or similar).

The existing voice modal stays functionally identical; the visual composition gets upgraded to match Claude Design's voice demo:
- Cascade arcs background
- Holo-text on phase indicator (`Listening…`, `Transcribing`, `Drafting…`)
- Waveform bars use `<Waveform />` from Phase 2 (3-color holo, not single color)
- Materializing queue card on completion uses new card token treatment

**Audio capture, transcription pipeline, error handling, hold-to-talk gesture — all untouched.** Only DOM + CSS.

---

## DO NOT TOUCH (CRITICAL)

These are behavioral / structural; out of scope per the operating principle:

- `lib/agent/**` (orchestrator, tools, prompts, models, scope detection)
- `lib/billing/**` (effective-plan, credits, academic-email)
- `lib/db/**` (schema, migrations)
- `lib/i18n/translations/**` *content* — keys can be reorganized only if both EN + JA stay parallel; values stay identical
- API routes (`app/api/**`)
- Auth wiring (`app/(auth)/**` *logic* — only `(auth)` layout/styles in scope)
- Test logic in `tests/` — visual snapshot tests will need baseline regeneration; behavioral tests must all stay green
- Wave 1–3 behavioral specs: queue archetypes A–E, command palette, scope detection (engineer 18), pre-brief / group projects / office hours (engineer 21)
- Tweaks panel from Claude Design output — **dev tool, do not ship**

If a behavioral component needs visual changes that require touching its props/state, surface it in your final report under "behavioral-skin overlap" — sparring will decide whether to scope-creep or defer.

---

## Verification

Capture screenshots @ **1440 × 900** in BOTH locales (EN + JA), per AGENTS.md §13.

Required captures (paired EN+JA):
- Landing — full page (long screenshot via `preview_eval` scrolling)
- Landing — hero alone (above the fold)
- Home (`/app`) — populated queue state
- Home — empty state (cascade arcs + holo-mesh visible)
- Sidebar — collapsed + expanded
- Voice modal — listening state
- Voice modal — drafting state
- Voice modal — done state with materialized card
- Chat — citation pills visible
- Settings — Inbox section
- Onboarding step 1
- Onboarding step 2
- Auth — Google sign-in screen
- Dark mode versions of: Landing hero, Home, Sidebar (verify dark token map works)

If a surface doesn't have realistic data, use existing `app/dev/...` mock fixtures. If none exist, add minimal one to drive the screenshot — but don't ship behavior changes.

---

## Tests

- `pnpm typecheck`: 2 pre-existing `handwritten-mistake-save` errors stay (don't fix, out of scope)
- `pnpm test`: stay above 856 / 856 pass — **all behavioral tests green**
- `pnpm i18n:audit`: must be 0 findings
- `pnpm build`: must succeed
- New Vitest snapshots for `components/ui/visual/*` Phase 2 primitives (smoke tests only)
- If existing visual snapshot tests break: regenerate baselines, verify diffs are visual-only (no DOM structure change), commit baselines

---

## Final report format (per AGENTS.md §12)

1. **Branch / PR name**: `rebrand-skin-swap`
2. **Summary**: per-phase what shipped (Phase 1 tokens / Phase 2 primitives / Phase 3 surfaces / Phase 4 landing / Phase 5 voice modal)
3. **Verification screenshots**: full list above, all 1440×900, EN + JA pairs, dark mode where flagged
4. **Behavioral-skin overlap flags**: anything where visual change required touching component props/state — list each + your judgment
5. **Tests added**: Phase 2 visual snapshots + any baseline regenerations
6. **Memory entries to update**:
   - `project_pre_launch_redesign.md` — note that the SUPERSEDED visual lock is now actually replaced (commit `<sha>`); old entry can be deleted or marked historical
   - `MEMORY.md` index — same line update
   - Any other deltas you find while implementing
7. **Out-of-scope flags**: anything that wanted to be done but is behavioral (defer to engineer 23 = Wave 5 or post-α)
8. **Token coverage gaps**: any existing surface where Claude Design didn't provide guidance and you applied tokens "by analogy" — flag for sparring/Ryuto review

---

## Sequence after this PR

1. `rebrand-skin-swap` PR merges to main
2. Sparring updates `project_pre_launch_redesign.md` per Memory entries to update
3. Engineer 23 (Wave 5) handoff (`docs/handoffs/wave-5-launch-prep.md`) gets a light touch-up to reference new design tokens / primitives where the wave's own UI work needs them (auto-archive Settings toggle, Hidden filter chip, weekly digest preview, etc.) — sparring updates the doc, engineer 23 picks it up
4. Engineer 23 ships Wave 5
5. Parallel Ryuto track (CASA / Google verification / Stripe KYC) completes
6. Public launch

---

## LLM cost

Zero. This is a visual layer change — no agent / classifier / prompt changes. If `pnpm test` flags cost regressions, that's a sign of accidental scope creep.

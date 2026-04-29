# Landing redesign PR 2 — Holographic glass aesthetic

Major visual revamp of the marketing landing surface. Discards the dark+amber dev-tool aesthetic that PR 1 shipped (which read as derivative / not modern enough on review). Adopts a **holographic glass** language: white base, large iridescent gradient hero, full-bleed video, big modern type, black solid CTA, electric-violet accent.

α invite send is 1-2 days out. This is the last redesign before launch.

## Setup

```
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
git status   # clean
git log --oneline -3
```

Most recent expected: `04b84db Merge pull request #77 from ryuto1127/hotfix/landing-polish-undo-10s` or later. If main isn't there or later, **STOP**.

Branch: `landing-redesign-pr2-holographic`. Don't push without Ryuto's explicit authorization.

---

## Strategic context

Ryuto's diagnosis (2026-04-28): "黒×オレンジ基調はやめませんか？なんか古臭く感じます。landing pageは new を全力で出していきたいです。一番最初の動画の配置も、cluely のように画面全体になるように."

We sparred and locked these direction choices:

1. **Drop dark + amber on landing** — reads as "data tool" / dev-product, not "agent that gets me"
2. **Steadii-original palette** (NOT Cluely-style sunset, which would feel derivative)
3. **Translucent + colorful** — peak modern
4. **Hero video full-bleed** — Cluely pattern, dominant visual
5. **Amber accent removed entirely** from landing — separate brand color

In-product (`/app/*`) design is unchanged — D1 Raycast/Arc dark+amber stays. Only the marketing edge (`/`, `/login`, `/request-access`, `(marketing)/*`) is in scope here.

The locked decisions live in `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_pre_launch_redesign.md` under the "Landing visual language — Holographic" section. Read those first.

---

## Locked design system

### Palette

- **Base**: white (#FAFAF9)
- **Hero gradient (mesh, translucent layers)**:
  - Cyan #06B6D4
  - Magenta #D946EF
  - Lime #BEF264
  - Blue #3B82F6
  - Layered as a soft mesh (~50-70% opacity each), so the white base reads through. Iridescent feel.
- **Hero ground tone**: subtle radial fades from the corners; center stays brighter.
- **Section 2-7 bg**: white, with **optional** gradient accent strips (~80px tall, 15% opacity) at section dividers — keeps continuity without fatigue.
- **Foreground**: deep charcoal (#1A1814) for text on white. White (#FFFFFF) for any text on the gradient.
- **Brand accent (single signature)**: **electric violet #7C3AED** — replaces amber on landing. Used for micro-tags, link hover, footer details.
- **CTA primary**: solid black pill (#0A0A0A bg, #FFFFFF text). Sharp contrast against the iridescent bg.
- **CTA secondary**: transparent text-link with violet accent on hover.

### Typography

- **Font family**: Geist sans (existing) — DO NOT introduce serif. Same as in-product but punch sizes for landing.
- **Headline (hero)**: 64-80px desktop / 48-56px mobile. Tight tracking (-0.02em). Geist 600 or 700 weight.
- **Section h2**: 40-48px desktop / 32-36px mobile. Same weight + tracking as hero.
- **Body**: 16-18px landing body (slightly larger than the 14-15px in-product).
- **Mono**: Geist Mono for α pill, "REAL SCREEN. NO MOCKS.", footer micro-text.

### Layout

- **Header / nav** (top of page):
  - Steadii wordmark (Geist 600, 17px) on left
  - Sign in link on right (deep charcoal, hover violet)
  - Transparent bg, sits over the gradient
- **Hero (Section 1) — full-bleed video as primary**:
  - **MAJOR LAYOUT CHANGE FROM PR 1**: The current 60/40 split (text left, small video right) is replaced by a **stacked layout where the video occupies the full width below the headline + CTA**, OR a near-full-width video with text overlay (Cluely-style).
  - Recommended: text-then-video stacked. Headline + subhead + CTA centered or left-aligned at the top, then the video spans the full container width (max-width ~1200-1400px), aspect ~16:10 or 21:9.
  - The hero gradient mesh sits behind everything, video sits on top with a subtle drop shadow + 12px radius.
  - Mobile: video stacks below text, full-bleed minus 16px side padding.
- **Sections 2-7**: keep the current section structure (chat-cards / proactive-mock / how-it-works / glass-box / founding / footer) but restyle:
  - White bg, gradient accent strip at top of each section (15% opacity, 80px tall)
  - Cards become softer (more padding, lighter borders, occasional gradient halo)
  - Section headers use the new big type scale

### Motion

- **Hero gradient drift**: very slow rotation / shift (~30s cycle, almost imperceptible). CSS `@keyframes` on the gradient mesh background.
- **Hero CTA pulse**: keep the gentle 3s pulse from PR 1.
- **Section reveals**: gentle parallax fade-in on viewport entry (200-300ms ease-out).
- All motion respects `prefers-reduced-motion: reduce`.

### Theme

- **Landing is LIGHT ONLY**. Remove the current `<div className="dark">` wrapper at `app/(marketing)/page.tsx:60-67`. Replace with an explicit light wrapper that overrides the user's app-level theme for marketing routes.
- App-level routes (`/app/*`) continue to honor the user's theme preference (D1 unchanged).

### Radius

- 8px landing (slightly softer than 6px in-product)
- 12px on the hero video container
- 999px (full pill) on CTA buttons

---

## Implementation steps

### Step 1 — Layout wrapper

Edit `app/(marketing)/layout.tsx` (or the specific marketing route layout — whichever currently exists; create one if missing). Apply:

- Force light theme on this layout (override `<div className="dark">` from page.tsx)
- Set `--background` and other CSS vars to the new landing palette
- Keep the existing locale resolution + nav + footer slots

### Step 2 — Hero gradient mesh

Add a new component `app/(marketing)/_components/hero-mesh.tsx` (client, for the slow drift animation). Implementation outline:

```tsx
"use client";
export function HeroMesh() {
  return (
    <div
      aria-hidden
      className="absolute inset-0 -z-10 overflow-hidden"
      style={{ background: "white" }}
    >
      {/* Layered radial gradients with translucent colors */}
      <div
        className="absolute inset-0 opacity-60 motion-safe:animate-[mesh-drift_30s_ease-in-out_infinite]"
        style={{
          background: `
            radial-gradient(circle at 20% 30%, #06B6D4cc 0%, transparent 40%),
            radial-gradient(circle at 80% 20%, #D946EFcc 0%, transparent 45%),
            radial-gradient(circle at 50% 70%, #BEF264bb 0%, transparent 50%),
            radial-gradient(circle at 90% 80%, #3B82F6bb 0%, transparent 40%)
          `,
        }}
      />
    </div>
  );
}
```

Add the `@keyframes mesh-drift` to `globals.css` (subtle scale + rotation, ~30s cycle, ease-in-out). Keep total opacity drift small enough that text on top stays readable.

### Step 3 — Hero section restructure

Replace the current 60/40 grid in `app/(marketing)/page.tsx:81-129` with a stacked layout:

```tsx
<section className="relative pt-12 pb-24 md:pt-20 md:pb-32">
  <HeroMesh />
  <div className="mx-auto max-w-5xl px-6 text-center md:text-left">
    <p className="font-mono text-[11px] uppercase tracking-widest text-[hsl(var(--accent))]">
      {t("landing.alpha")}
    </p>
    <h1 className="mt-6 font-display text-[56px] leading-[1.05] tracking-tight md:text-[80px]">
      {t("landing.headline")}
    </h1>
    <p className="mt-6 max-w-2xl text-[18px] text-[hsl(var(--foreground)/0.7)]">
      {t("landing.subhead")}
    </p>
    <div className="mt-10 flex flex-wrap items-center justify-center gap-4 md:justify-start">
      <Link
        href="/request-access"
        className="rounded-full bg-[#0A0A0A] px-6 py-3 text-[15px] font-medium text-white transition-hover hover:scale-[1.02]"
      >
        {t("landing.cta_request_access")}
      </Link>
      <Link
        href="/login"
        className="text-small text-[hsl(var(--foreground)/0.6)] transition-hover hover:text-[hsl(var(--accent))]"
      >
        {t("landing.cta_already_approved")}
      </Link>
    </div>
  </div>
  <div className="mx-auto mt-16 max-w-6xl px-6">
    <div className="overflow-hidden rounded-[12px] shadow-[0_20px_60px_rgba(0,0,0,0.15)]">
      <video
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        poster="/demo/hero-poster.png"
        aria-label="Steadii product demo"
        className="block aspect-[16/10] w-full object-cover"
      >
        <source src="/demo/hero.webm" type="video/webm" />
        <source src="/demo/hero.mp4" type="video/mp4" />
      </video>
    </div>
  </div>
</section>
```

(Adapt to the existing project's CSS-var conventions — `--accent` may need to be defined as the new violet `#7C3AED`.)

### Step 4 — Sections 2-7 restyle

For each existing section (`what_you_do`, `steadii_in_motion`, `how_it_works`, `glass_box`, `founding`, footer):

1. White background (remove the `bg-[hsl(var(--surface))]` etc. dark colors)
2. Add a thin gradient accent strip at the section divider (border-top alternative): `<div className="h-1 w-full bg-gradient-to-r from-cyan-400/30 via-fuchsia-400/30 to-blue-400/30" />` between sections.
3. Card components inside each section get lighter borders (`border-black/10` or similar), more padding, soft shadow.
4. Section h2 uses the bigger type scale (40-48px desktop).
5. CTA buttons inside sections use the same black-pill primary / violet-link secondary pattern.

### Step 5 — CSS variable overrides

In `globals.css` (or a new `(marketing)/landing.css` imported only by the marketing layout):

```css
.landing-light {
  --background: 60 9% 98%;       /* #FAFAF9 */
  --foreground: 30 12% 9%;       /* #1A1814 */
  --surface: 0 0% 100%;
  --border: 0 0% 90%;
  --muted-foreground: 30 6% 40%;
  --accent: 262 83% 58%;          /* #7C3AED electric violet */
  --primary: 0 0% 4%;             /* #0A0A0A black for CTA */
  --primary-foreground: 0 0% 100%;
}
```

The marketing layout wrapper applies `className="landing-light"`. This shadows the in-product CSS vars without touching them globally.

### Step 6 — Drop the `dark` wrapper

Remove lines 60-67 in `app/(marketing)/page.tsx` (the `<div className="dark min-h-screen ...">` + the inline `<style>` forcing dark on html/body). Replace with the new light wrapper from Step 5.

### Step 7 — Existing component restyle

Touch but don't restructure:
- `_components/proactive-mock.tsx` — restyle Phase1/2/3 card backgrounds (white with subtle gradient halo instead of dark surface)
- `_components/chat-action-cards.tsx` — same restyle for the 3 cards
- `_components/locale-toggle.tsx` — restyle (text on light bg, violet hover)

The animation timings and structure stay intact. Only colors / borders / shadows change.

### Step 8 — Footer

Existing 7-section footer keeps its layout. Restyle:
- White bg
- Privacy / Terms / Contact links in muted charcoal, violet on hover
- Locale toggle moved per the existing layout
- "α · subject to change" mono text in violet

---

## What NOT to change

- **Locked copy**: tagline, hero feature line, founding copy, etc. — all live in `lib/i18n/translations/{en,ja}.ts` `landing.*` namespace and stay verbatim.
- **7-section structure**: hero / what_you_do / steadii_in_motion / how_it_works / glass_box / founding / footer — order preserved.
- **i18n keys**: do NOT remove or rename existing keys. Only add new keys if a new visual element needs copy.
- **Locale resolution**: cookie → Accept-Language → fallback `en` chain stays unchanged.
- **Footer locale toggle**: stays at footer right.
- **`/app/*` design**: do NOT touch any in-product page or component. D1 dark+amber preserved.

---

## Verification

1. `pnpm typecheck` — clean (only pre-existing handwritten-mistake-save errors)
2. `pnpm test` — green; existing tests must still pass
3. `pnpm build` — clean
4. Manual smoke (dev server):
   - Open `/` in EN and JA via footer toggle — both render with the holographic gradient hero
   - Hero video plays full-width
   - Scroll through sections 2-7 — white bg with gradient accent strips, no dark amber bleed
   - CTA "Request α access" is a black pill, hover scales subtly
   - Open `/app` (after login) — design is unchanged (D1 dark+amber intact)
   - Open `/login` and `/request-access` — landing palette applied (light + gradient + black CTA)
   - Resize to 375px (mobile) — layout collapses gracefully, hero video stacks below text
   - `prefers-reduced-motion: reduce` on browser → mesh drift + CTA pulse stop

---

## Out of scope

- Replacing the hero video itself (Ryuto records separately; treat existing `public/demo/hero.{mp4,webm}` as the source)
- Adding a serif font (Geist sans only — no serif headlines)
- Changing the existing `proactive-mock.tsx` animation timing (already tuned in polish hotfix)
- Changing in-product (`/app/*`) anything
- Localizing additional surfaces beyond what landing already has
- A/B testing variants
- Adding analytics / tracking pixels

---

## Constraints

- Locked decisions in `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/` are sacred — especially the new "Landing visual language — Holographic" section in `project_pre_launch_redesign.md`
- Pre-commit hooks must pass; no `--no-verify`
- Conversation Japanese; commits + PR body English
- Don't push without Ryuto's explicit authorization
- The hero gradient mesh must stay subtle enough that text on top reads cleanly — if `text-shadow` or backdrop-blur is needed for readability, add it
- Mobile is first-class — landing must look good at 375px width
- Performance budget: Lighthouse Performance ≥85 desktop + ≥85 mobile, Accessibility ≥90 both

---

## Context files to read first

- `app/(marketing)/page.tsx` — the file you'll edit most (full restructure of the hero, restyle of sections)
- `app/(marketing)/_components/proactive-mock.tsx` — restyle card colors
- `app/(marketing)/_components/chat-action-cards.tsx` — same
- `app/(marketing)/_components/locale-toggle.tsx` — same
- `lib/i18n/translations/{en,ja}.ts` — `landing.*` namespace (read only — do not modify copy)
- `app/globals.css` — add the `.landing-light` CSS var overrides + `@keyframes mesh-drift`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_pre_launch_redesign.md` — the new "Landing visual language — Holographic" section is the source of truth
- `app/(marketing)/layout.tsx` if it exists; otherwise consider whether to create one for the new wrapper

---

## When done

Report back with:
- Branch name + final commit hash
- Verification log (typecheck, test, build, manual smoke for each scenario above)
- Lighthouse scores (desktop + mobile, Performance + Accessibility)
- Any deviations from this brief + 1-line reason each
- Confirmation that:
  - `/` and `/app/*` look completely different (intended)
  - Hero video is full-width on desktop
  - Mesh gradient drifts subtly (or stays static if `prefers-reduced-motion`)
  - No dark+amber bleed anywhere on the landing
  - All locked copy preserved verbatim

The next work unit after this lands is α invite send (10 JP students). The landing must feel "new を全力で出す" by the time invites go out.

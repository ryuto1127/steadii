# Polish — Landing animation follow-up (4 fixes, 1 PR)

Ryuto reviewed the landing animation (PR #87) on production and surfaced 4 issues. Bundle into one PR.

## Setup

```
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
git status
git log --oneline -5
```

Branch: `polish-landing-animation-followup`. Don't push without Ryuto's explicit authorization.

---

## Fix A — File pill should disappear from chat input after submit

### Symptom

In `components/landing/hero-animation.tsx`, the chat input's attached-file pill (`MAT223_Syllabus_Spring2026.pdf`) stays visible during the `extracting` and `extracted` phases. It should disappear at submit, like the real app: once you press send, the attachment moves into the message stream and the input becomes empty/ready for the next message.

### Root cause

`hero-animation.tsx:201`:

```ts
const attached = idx >= PHASE_INDEX.attached && idx < PHASE_INDEX.classesUp;
```

The pill is visible across attached → extracting → extracted phases. Should only be visible during the brief `attached` window, then vanish at the same moment the submit pulse fires (or just after, when extraction starts).

### Fix

Tighten the condition so the pill only shows during `attached` and at most a brief overlap with the send pulse. Pick whichever reads more naturally:

```ts
const attached = phase === "attached";
```

Or, for a smoother transition that overlaps with the send pulse:

```ts
const attached = phase === "attached" || phase === "pdfDragging";
// keep visible briefly through send-pulse, then transition out as extracting starts
```

The existing `transition: max-width / opacity / padding` on the pill at `hero-animation.tsx:267` will animate the disappearance smoothly. No new motion code needed.

### Verify

- Visit `/` → after the cursor presses send (the small pulse on the send button), the pill smoothly collapses out of the input
- The "Message Steadii…" placeholder fades back in (already wired via `attached ? 0 : 1` opacity)

---

## Fix B — Top-left "logo" bar should be the real app's brand mark, diamond-shaped

### Symptom

`hero-animation.tsx:181`:

```tsx
<div className="mb-2 h-1.5 w-4 rounded-full bg-[#0A0A0A]/85" />
```

This renders a tiny black pill at the top of the sidebar. The real app uses `<Logo />` (`components/layout/logo.tsx`) — a warm-gradient, hue-cycling brand mark. The landing animation should use the same visual so users recognize Steadii's identity continuously between landing and product.

### Fix

Replace the placeholder bar with `<Logo />`. Pick a sidebar-rail-appropriate size (~16-18px to fit the `w-[8%] min-w-[44px]` sidebar). Example:

```tsx
import { Logo } from "@/components/layout/logo";
// …
<Logo size={18} className="mb-2" />
```

The `steadii-logo` CSS class on `Logo` already provides the warm gradient + 14s hue rotation (per `app/globals.css:199-217`). After Fix C below, it'll also be diamond-shaped. No additional landing-side styling needed.

### Verify

- Top-left of sidebar in the hero animation shows the warm pink-orange-yellow gradient (animated hue) instead of the black pill
- Size feels balanced against the surrounding sidebar icons (~13px lucide icons in 28px containers per the existing layout)

---

## Fix C — Brand mark shape: rounded square → diamond (affects landing AND in-app)

### Scope

This change touches the actual app, not just the landing. Per Ryuto's directive, the brand mark identity moves from rounded square to diamond globally. After this lands, every `<Logo>` placement (sidebar, layout, anywhere) renders as a diamond.

### File

`app/globals.css:205-217`:

```css
.steadii-logo {
  border-radius: 7px;
  background:
    radial-gradient(circle at 30% 25%, #ffe28a 0%, transparent 55%),
    linear-gradient(135deg, #ff5db1 0%, #ff7a3d 55%, #ffc861 100%);
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.18),
    0 1px 2px rgba(0, 0, 0, 0.08);
  animation: steadii-logo-hue 14s linear infinite;
}
```

### Fix

Change to diamond. Pick the cleanest approach:

**Option 1 — `clip-path` polygon** (preserves bounding box, keeps `box-shadow` on the clip edge — though inset shadow may visually diminish):

```css
.steadii-logo {
  /* drop border-radius — clip-path handles the shape */
  clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);
  background: …;
  /* drop box-shadow inset (clipped); keep outer shadow if visible enough */
  animation: steadii-logo-hue 14s linear infinite;
}
```

**Option 2 — `transform: rotate(45deg)` on the square**:

The element rotates 45deg in place, becoming a diamond. The bounding box grows by ~√2; existing `width: size, height: size` from the React component still applies but the visual extends beyond. Layout in the sidebar may shift slightly; verify visually.

```css
.steadii-logo {
  border-radius: 2px; /* slight softening on diamond points */
  transform: rotate(45deg);
  background: …;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.18), 0 1px 2px rgba(0, 0, 0, 0.08);
  animation: steadii-logo-hue 14s linear infinite;
}
```

**Recommended: Option 2 with slight `border-radius: 2px`** — the inset highlight survives, the diamond has gently softened points (modern, not razor-sharp), and the `transform` plays well with the existing `hue-rotate` filter animation. The bounding box growth is minor (~3-4px) and the existing sidebar layout has enough breathing room.

If Option 2's bounding-box growth causes layout issues, fall back to Option 1.

### Verify

- Real app `/app`: sidebar logo at the top renders as a diamond, hue cycles 14s as before
- Landing animation `/`: top-left logo (after Fix B) also diamond, same hue cycle
- Consistency check: the diamond shape feels intentional, not accidental — slightly softened points, properly centered, doesn't break sidebar layout
- Reduced-motion check: `prefers-reduced-motion: reduce` still kills the animation (`globals.css:215-217` rule unaffected by shape change)

---

## Fix D — `proactive-mock.tsx` first window appears too slowly

### Symptom

On the "And it watches your back." section, the first reveal (calendar window) takes ~1.8s after the section enters viewport. Feels too slow — user often scrolls past before anything appears.

### Root cause

`app/(marketing)/_components/proactive-mock.tsx:22`:

```ts
const STEPS = [1800, 1800, 1800] as const;
```

Phase 0 → 1 transition fires at 1800ms after viewport entry. Subsequent phases stagger at 1.8s each.

### Fix

Shorten the first step. The subsequent steps can stay at 1.8s for the rhythm. Suggested:

```ts
const STEPS = [400, 1500, 1500] as const;
```

- 400ms first reveal — feels responsive to scroll, just enough delay so it doesn't pop instantly (jarring) but doesn't make the user wait
- 1500ms subsequent — slight tightening of the overall sequence; total runs in 3.4s instead of 5.4s, holds on phase 3

If 400ms feels too snappy in testing, dial up to 600ms. If 1500ms feels too tight, restore to 1800ms for steps 2-3 only.

### Verify

- Scroll to the "And it watches your back." section → first calendar window appears within ~0.4s
- Subsequent two windows still feel paced (not staccato)
- Final state holds (phase 3) — no looping
- Reduced-motion still jumps straight to phase 3 (existing behavior at line 35-38)

---

## Constraints

- Locked decisions in `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/` are sacred
- Pre-commit hooks must pass; no `--no-verify`
- Conversation Japanese; commits + PR body English
- Don't push without Ryuto's explicit authorization
- The brand mark shape change (Fix C) affects the entire app — verify the sidebar layout doesn't visibly shift in `/app/*` after the change

## Verification plan

After implementing all 4:

1. `pnpm typecheck` — clean
2. `pnpm test` — green
3. `pnpm dev` → manual smoke:
   - `/` hero animation: file pill disappears at submit (A); top-left shows hue-cycling diamond logo (B + C)
   - `/` "And it watches your back." section: first window appears within ~0.4s (D)
   - `/app` (signed in): sidebar logo is now diamond (C), no layout shift around the logo placement
4. `prefers-reduced-motion: reduce` — both animations honor the static fallback (existing behavior)

## When done

Per AGENTS.md §12, your final report MUST include "Memory entries to update":

- Likely candidate: `project_pre_launch_redesign.md` "Holographic landing" section — the hero animation bullet might want a "(diamond brand mark, file pill collapses at submit)" addendum if the change is visually defining. If the change is just polish without spec impact, write "none".
- Likely candidate: `project_pre_launch_redesign.md` D1 visual language — the brand mark shape changed from rounded square to diamond. Add a note: "Brand mark: diamond shape (was rounded square pre-2026-04-29 polish)."

Plus standard report bits.

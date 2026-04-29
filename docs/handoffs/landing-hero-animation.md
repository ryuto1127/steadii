# Landing — replace hero `<video>` with React animation (syllabus upload demo)

## Why

Real screen recording felt too "literal" for the holographic landing aesthetic. Modern SaaS landings (Linear / Vercel / Raycast / Cluely) use stylized React animations that show the product's truth without showing pixel-perfect production data. Sparring decision (2026-04-29):

- **Stack**: `motion` (the renamed Framer Motion v11+) + Tailwind + simplified React component
- **Fidelity**: clone-寄り — real Geist font, amber accent, rounded-2xl cards, real component shapes; only the *data* is stylized (generic class names, dummy times)
- **Scope**: 1 hero animation only. Email-triage / proactive-suggestion variants are out of scope (revisit post-α if section 4-5 wants more)
- **Mobile**: same animation scaled responsively. Light-only per landing spec; the existing `<div className="dark">` hack is already off the marketing page
- **a11y**: `prefers-reduced-motion: reduce` → render the final frame as a static composition (no looping motion)

## Setup

```
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
git status
git log --oneline -5
```

Branch: `landing-hero-animation`. Don't push without Ryuto's explicit authorization.

## Dep

```
pnpm add motion
```

`motion` v11+ is the current package (Framer Motion was renamed). ~20kb gzipped for the API used here.

## Component

Create `components/landing/hero-animation.tsx`. Single client component, default export `HeroAnimation`. Keep the file ~200-350 lines.

### Scene choreography (~13s loop)

| time | event |
|---|---|
| 0:00 → 0:01 | `/app` chat surface visible: sidebar (6 icons, no labels), main chat panel empty with input at bottom, fake "cursor" near center |
| 0:01 → 0:02 | A stylized PDF icon (rounded rect with title "MAT223_Syllabus_Spring2026.pdf") follows the cursor and drops onto the input area |
| 0:02 → 0:03 | Attachment pill appears in the input. Cursor "presses" the send button (faux ↑ icon pulse) |
| 0:03 → 0:05 | A tool card appears in the chat: row with subtle Lucide-style spinner + monospace text "Extracting syllabus..." |
| 0:05 → 0:06 | Tool card morphs (height transition + opacity crossfade) to show the extraction result: "取り込みました。シラバス: Math II (Linear Algebra). スケジュール項目: 7件" |
| 0:06 → 0:07 | A second glass-card overlay slides up from the bottom containing a stylized `/app/classes` view (3-4 dim existing rows already in the list) |
| 0:07 → 0:08 | A new row "Math II · Linear Algebra · 〇" (blue dot from class color taxonomy `#3B82F6`) slides in at the top of that list with a faint amber pulse |
| 0:08 → 0:09 | Cross-fade to a `/app/calendar` view (week strip, 7 day columns, time grid hint) |
| 0:09 → 0:12 | 7 events fade in one-by-one (~400ms apart), each labeled `[Steadii] Math II` (or short variants) with a small blue dot to the left |
| 0:12 → 0:13 | Hold ~600ms, then cross-fade back to frame 0:00. Loop |

### Visual constraints (must match)

- Font: Geist sans (real `font-sans` from existing `app/layout.tsx`); Geist Mono for tool card text
- Class color taxonomy from `project_pre_launch_redesign.md`: primary blue `#3B82F6`, accent amber `#F59E0B`
- Holographic palette only as a subtle bg hint behind glass, NOT as primary fill (the surrounding hero gradient already does that)
- D1 motion spec: 120-180ms `cubic-bezier(0.16, 1, 0.3, 1)` ease-out per element, **no springs/bounces**, no overshoot
- Container aspect: ~16/10 (matches existing `<video>` aspect — keep landing layout intact)
- Inside the existing glass card frame in `app/(marketing)/page.tsx:104-118`: `rounded-[16px] bg-white/40 shadow-[0_30px_80px_-20px_rgba(20,20,40,0.25)] ring-1 ring-black/5 backdrop-blur-sm` — render the animation INSIDE the same frame; don't introduce a different chrome

### Implementation hints

- Use `motion` from `motion/react` for components. Keyframes via `<motion.div animate={...} transition={...}>` or `useAnimate()` for sequenced choreo
- Single master timeline with `AnimatePresence` for the cross-fades (between syllabus → classes view → calendar view)
- For the loop: detect last animation end, reset all state, start over (no setInterval — chain cleanly)
- For reduced-motion fallback: detect via `useReducedMotion()` from motion. If true, render only the final calendar view static state
- Don't rely on `setTimeout` for sequencing — use motion's built-in `delay` and chain via async/await or animate sequence

### Layout

Replace lines 104-118 of `app/(marketing)/page.tsx`:

```tsx
<div className="overflow-hidden rounded-[16px] bg-white/40 shadow-[0_30px_80px_-20px_rgba(20,20,40,0.25)] ring-1 ring-black/5 backdrop-blur-sm">
  <video ... >
    <source src="/demo/hero.webm" ... />
    <source src="/demo/hero.mp4" ... />
  </video>
</div>
```

with:

```tsx
<div className="overflow-hidden rounded-[16px] bg-white/40 shadow-[0_30px_80px_-20px_rgba(20,20,40,0.25)] ring-1 ring-black/5 backdrop-blur-sm">
  <HeroAnimation />
</div>
```

The existing `aspect-[16/10] w-full object-cover` should move to the HeroAnimation root (same aspect ratio constraint).

### Cleanup

- Remove `public/demo/` directory entirely (the `hero-poster.png` referenced in current code never existed; `hero.webm` / `hero.mp4` are no longer needed). Keep `README.md` if you want, but rewrite it to reflect "Hero is now a React component at `components/landing/hero-animation.tsx`. No assets needed here." Or just delete the folder.
- Do not introduce any new image/video asset

## Tests

Snapshot test in `tests/landing-hero-animation.test.tsx` (mirror existing component-render tests if any — `grep -rln "render\|@testing-library" tests/`):

- Renders without crashing
- Reduced-motion mode renders the static fallback (no animation classes)
- All required text strings present: "MAT223_Syllabus_Spring2026.pdf", "Extracting syllabus", "Math II", "Linear Algebra", "[Steadii]"

If component-render testing infrastructure isn't in tests/ yet, add the minimum harness; do NOT block this PR on a full test setup. Snapshot the component structure as text fallback if needed.

## Manual verify

- `pnpm dev` → visit `/` → hero animation runs at ~13s loop, smooth, no jank
- `prefers-reduced-motion: reduce` (System Settings → Accessibility → Reduce Motion on macOS) → verify static fallback
- Mobile breakpoint 375x812 → animation scales down, still legible
- Tablet 768x1024 → ditto
- Lighthouse `/` → perf doesn't drop more than 5 points vs current main (animation should be cheaper than the planned 6-10MB video, so likely improves)

## Constraints

- Locked decisions in `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/` are sacred
- Pre-commit hooks must pass; no `--no-verify`
- Conversation Japanese; commits + PR body English
- Don't push without Ryuto's explicit authorization
- Don't redesign the hero section layout — the glass card frame stays

## When done

Per AGENTS.md §12:

**Memory entries to update**:
- `project_pre_launch_redesign.md` "Holographic landing" section: replace the "Hero video: full-bleed... autoplay+muted+loop+playsInline... aspect ~16:10 or 21:9 cinematic" bullet with "Hero animation: stylized React component (`components/landing/hero-animation.tsx`) using `motion`. ~13s loop, syllabus-upload-demo choreography. Same glass-card frame, same 16:10 aspect."

Plus standard report bits (branch, commits, verification log, deviations).

The next work unit is the **critical-path code review** (sparring-driven) before α invite — landing animation lands as part of pre-α polish.

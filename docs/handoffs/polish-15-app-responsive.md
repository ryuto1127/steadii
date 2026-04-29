# Polish-15 — `/app/*` mobile / tablet responsive audit

The marketing landing was rebuilt for full mobile / tablet responsiveness in the holographic redesign PR. The in-product `/app/*` surface needs a parallel pass — α invitees will hit Steadii from phones during the day (between classes, in transit), and any page that breaks on a 375px viewport degrades the trust we built with the polished marketing surface.

This is an audit-then-fix PR. Most pages will need only minor breakpoint adjustments; some (sidebar, inbox detail, classes detail tabs) need real layout shifts.

## Setup

```
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
git status   # clean
git log --oneline -3
```

Most recent expected: the landing PR 2 (holographic) merge or later. If main isn't there, **STOP**.

Branch: `polish-15-app-responsive`. Don't push without Ryuto's explicit authorization.

---

## Scope

Audit and fix every page under `/app/*` for breakpoints **mobile (375px), tablet (768px), small desktop (1024px), large desktop (1280px+)**. Concrete targets:

### High-touch pages (must work mobile)

- **Sidebar** (`components/layout/sidebar.tsx`) — currently desktop-only nav rail. Mobile needs collapse / drawer / bottom-nav pattern. Critical because every page uses it.
- **Inbox list** (`app/app/inbox/page.tsx`) — dense list with metadata, currently relies on horizontal space. Mobile needs row condensation.
- **Inbox detail** (`app/app/inbox/[id]/page.tsx`) — has email body, reasoning panel, draft form, suggestion pills. Mobile needs vertical stacking.
- **Chat new** (`app/app/page.tsx` Home) — chat input + dashboard cards. Mobile needs the dashboard to stack and the chat input to dock to bottom.
- **Chat thread** (`app/app/chat/[id]/page.tsx`) — long messages, attachments. Mobile already partially works; verify code blocks, attachment thumbnails, send button placement.
- **Classes list** (`app/app/classes/page.tsx`) — timeline strip + dense row list. Mobile needs the timeline to scroll horizontally and the rows to condense.
- **Classes detail** (`app/app/classes/[id]/page.tsx`) — 4 tabs (Syllabus / Assignments / Mistakes / Chats). Mobile tabs should stay tabs (not collapse to dropdown), but the tab content needs to reflow per tab.
- **Calendar** (`app/app/calendar/page.tsx`) — month / week views. Mobile may need to default to day view.
- **Tasks** (`app/app/tasks/page.tsx`) — list view. Mobile straightforward.
- **Settings** (`app/app/settings/page.tsx`) — long page with many sections. Mobile each section stacks; sliders/toggles need touch-friendly hit targets (44px+).

### Lower-touch pages (verify they don't break)

- `/app/admin/*` (Ryuto-only, desktop assumed but shouldn't crash)
- `/app/syllabus/new` (form)
- `/app/mistakes/[id]` (markdown editor)
- `/app/inbox/proposals/[id]` (proactive proposal detail)
- `/app/settings/billing` (Stripe Customer Portal redirect, mostly external)
- `/app/settings/connections` (OAuth + iCal — already responsive-touched in polish-13a but verify)
- `/app/settings/how-your-agent-thinks` (read-only transparency page)

### Out of scope

- Marketing pages (already done in landing PR 2)
- `/login`, `/request-access`, `/onboarding`, `/invite/[code]`, `/access-pending`, `/access-denied` — these are auth-flow pages, verify they look OK on mobile but don't restructure
- Privacy / Terms pages
- Email digest templates (those are server-rendered HTML for email clients, separate concern)

---

## What "responsive" means here

Per locked design (`~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_pre_launch_redesign.md`):

- **Mobile (≤640px)**: sidebar collapses to a hamburger / drawer or bottom-nav, all multi-column layouts stack, font sizes step down 1-2 levels, touch targets ≥ 44px, padding reduces from 24px to 16px on cards
- **Tablet (640-1023px)**: sidebar stays expanded but narrower, multi-column layouts use 2 columns instead of 3, otherwise mostly desktop layout
- **Desktop (≥1024px)**: current layouts stay as-is

The in-product design system is **D1 Raycast/Arc dark+amber** (locked). DO NOT shift palette to the marketing-edge holographic — `/app/*` keeps its identity. Mobile responsiveness is purely about layout reflow + touch sizing, not palette change.

---

## Implementation approach

### Step 1 — Audit

Open the dev server. For each of the 10 high-touch pages, take 4 screenshots at 375 / 768 / 1024 / 1280. Catalog every layout break:
- Text overflow / horizontal scroll
- Touch targets <44px
- Sidebar / nav not accessible
- Multi-column refusing to stack
- Cards extending past viewport
- Modal overlays cropped

Write the catalog as a checklist at the top of your final PR description.

### Step 2 — Sidebar (the big one)

`components/layout/sidebar.tsx` and `components/layout/sidebar-nav.tsx` currently render a fixed left rail. Mobile needs one of:

- **A. Drawer pattern** (recommended): hamburger button in top-left, sidebar slides in over content, click-outside closes
- **B. Bottom nav**: fixed bar at bottom with the 6 core items as icons (Inbox / Home / Chats / Classes / Calendar / Tasks)

Recommendation: **A drawer** because (a) bottom nav can't accommodate Settings + account dropdown without overflow, (b) drawer matches Linear / GitHub / Notion mobile pattern (which our users know).

Implementation: add a client-side `useMediaQuery` (or use Tailwind `md:` modifier) to toggle between fixed rail (desktop) and drawer (mobile).

### Step 3 — Inbox detail vertical stack

`app/app/inbox/[id]/page.tsx` currently lays the email body + reasoning panel side-by-side or in a tight column. Mobile: stack everything vertically with consistent vertical rhythm. Reasoning panel collapses by default on mobile (toggle to expand).

### Step 4 — Classes list timeline

`app/app/classes/page.tsx` timeline strip — make horizontally scrollable on mobile (overflow-x-auto + snap), the row list below stacks naturally.

### Step 5 — Classes detail tabs

`app/app/classes/[id]/page.tsx` — keep the 4 tabs at the top, but on mobile the tab content needs to reflow:
- Syllabus tab: list with kebab menu, already stacks OK
- Assignments tab: card per row
- Mistakes tab: 1-column grid on mobile, 2-column on tablet, 3+ on desktop
- Chats tab: list with chat preview, mobile-friendly already

### Step 6 — Calendar

`app/app/calendar/page.tsx` — most complex. Recommendation:
- Default to day view on mobile (≤640px)
- Default to week view on tablet
- Month view stays for desktop
- View switcher buttons in the header

If day view doesn't yet exist, ship as part of this PR.

### Step 7 — Touch target sweep

For every interactive element in `/app/*`, verify minimum 44×44px touch target. Common offenders: kebab menus, close buttons, small chips. Add `p-2` or similar to bring them up to size.

### Step 8 — Settings page sections

`app/app/settings/page.tsx` is long. Each section card already stacks. Verify:
- Sliders (notification timing, undo window) are touch-friendly
- Toggles have ≥44px height
- The Connections section's "Connect" / "Disconnect" buttons aren't too small
- The danger-zone modal works on mobile (the wipe-data confirmation flow)

---

## Out of scope (for this PR specifically)

- Adding new responsive breakpoints to Tailwind config (use existing `sm` `md` `lg` `xl`)
- Redesigning any page's information architecture (just reflow existing content)
- Changing the design system palette / typography (D1 stays)
- Adding offline / PWA support (post-α, separate concern)
- Touch gesture support (swipe to dismiss, pull-to-refresh) — defer
- Native mobile shell (Expo) — gated on web mobile being solid first

---

## Verification

For each high-touch page:

1. `pnpm typecheck` — clean
2. `pnpm test` — green
3. `pnpm build` — clean
4. Manual smoke at 375 / 768 / 1280 in dev:
   - No horizontal scroll
   - All text legible without zoom
   - All interactive elements ≥44×44 touch target
   - Sidebar accessible via drawer on mobile
   - Modals fit viewport (don't crop)
5. Lighthouse mobile audit on `/app` (after login) — Performance ≥80, Accessibility ≥90

---

## Constraints

- Locked decisions in `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/` are sacred — especially D1 dark+amber palette stays for `/app/*`
- Pre-commit hooks must pass; no `--no-verify`
- Conversation Japanese; commits + PR body English
- Don't push without Ryuto's explicit authorization
- Use Tailwind responsive utilities (`sm:` `md:` `lg:`) — do not introduce a separate mobile.css
- Keep server components server, client components client — don't add `"use client"` for the sake of media queries (Tailwind handles it)
- Touch targets: 44×44 minimum (Apple HIG)
- Test on real iPhone if possible (Safari Mobile has its own quirks)

---

## Context files to read first

- `components/layout/sidebar.tsx` + `sidebar-nav.tsx` — biggest restructure
- `app/app/inbox/[id]/page.tsx` — vertical stack
- `app/app/classes/[id]/page.tsx` — tabs reflow
- `app/app/calendar/page.tsx` — view switching
- `app/globals.css` — current responsive utilities
- `tailwind.config.*` — current breakpoints
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_pre_launch_redesign.md` — D1 design system (`/app/*` palette stays)

---

## When done

Report back with:
- Branch name + final commit hash
- Audit checklist with before/after notes per page
- Lighthouse mobile scores for `/app` and 1-2 representative interior pages
- Any deviations from this brief + 1-line reason each
- Confirmation that the in-product palette (dark + amber) was NOT shifted to the marketing holographic palette

The next work unit after this is α invite send (10 JP students). The `/app/*` mobile experience must feel as polished as the landing.

# Feat — Voice demo v2 + auth-gated dogfood (engineer 17)

Two items: a much bigger voice demo redesign on the landing page (engineer 16's snake motion was too subtle — Ryuto referenced voiceos.com as the visual scale he wants), plus the auth-gated portion of the pre-α dogfood that engineer 16 couldn't run without a session cookie.

## Setup

```
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
git status
git log --oneline -5
git checkout -b feat-voice-demo-v2-and-dogfood
```

Branch: `feat-voice-demo-v2-and-dogfood`. Don't push without Ryuto's explicit authorization.

Read `AGENTS.md` first, especially:
- §12 — final report MUST include "Memory entries to update"
- §13 — capture verification screenshots yourself via `preview_resize` + `preview_screenshot` at 1440×900

---

## Item A — Voice demo v2: VoiceOS-scale multi-phrase arc

### Bug

Engineer 16 (PR #104) shipped a "snake from outside the box" motion, but the chars only originate ~12-120px left of the chat box. Ryuto's reference is **voiceos.com**: multiple sample phrases cascading along page-wide curved paths from the page edges into a central UI element. The visual scale needs to be ~30-50% of viewport width per arc, not low double-digit pixels, AND multiple phrases visible / cycling.

### Spec

**Sample phrases (Ryuto-locked, all academic per option (a) 2026-04-30 spar)**:
1. `MAT223 のレポート due tomorrow`
2. `Move calculus midterm to Friday`
3. `Add task: read Chapter 5`

**Animation**:
- 3 distinct curved paths originating from different page-edge anchor points (top-left, left-mid, bottom-left), each terminating at the centered chat box / Caps Lock pill that already exists in `voice-demo.tsx`.
- Each path is large amplitude — at 1440px viewport, the start point should be at least 400-600px left of the chat box and the curve should arc visibly upward or downward (sine-wave style).
- Characters of each phrase laid along their path. Use SVG `<path>` + `<text>` + `<textPath>` for character-on-path layout, OR CSS `offset-path` on individual character spans.
- Loop sequence (~12s total):
  1. (0-3s) Phrase 1 reveals along its curve from outside-left, settles inside the chat box.
  2. (3-4s) Phrase 1 fades; chat box stays visible.
  3. (4-7s) Phrase 2 reveals along its curve from a different anchor, settles, fades.
  4. (7-10s) Phrase 3 same pattern.
  5. (10-12s) brief pause + reset.
- The Caps Lock key icon + holographic border + "Listening…" / "Processing…" / cursor states from engineer 16's voice-demo.tsx remain — they fire ONCE per cycle, gated to the moment a phrase is settling into the box. Don't rebuild the existing pill chrome from scratch.

**Layout**:
- Whole demo block is full-bleed horizontally (or close to it — at minimum 80% of viewport width). Currently it's clamped to `max-w-2xl` / `max-w-xl`. Lift those caps for the demo wrapper specifically; the surrounding hero section keeps its current container width.
- The chat box itself stays the same size (don't blow it up). The arcs come from FAR outside the box and land into the existing-size box — that's the visual story.

**Locale**:
- The 3 sample phrases stay locale-aware. EN locale gets EN versions; JP locale gets JP versions. Wire through `lib/i18n/translations/{en,ja}.ts` under `landing.voice_demo.phrases.*`. Engineer 16 already set up the namespace; just add 2 more phrase keys (current key has 1 phrase).
- For JP locale, write idiomatic JP: e.g. `MAT223 のレポート明日提出`, `微積期末を金曜に動かす`, `タスク追加: 第 5 章を読む`. Engineer judgment on natural phrasing.

**Performance**:
- Pure CSS or CSS + minimal SVG. NO JS animation loop, NO `requestAnimationFrame`, NO audio. The demo is a marketing element; it must not block paint or hurt LCP.
- Preserve `motion-reduce` accessibility — respect `prefers-reduced-motion` and fall back to a static image of the settled state.

### Verification (per AGENTS.md §13)

- `preview_resize` to 1440×900, `preview_screenshot` at multiple animation phases (use `preview_eval` to pause + step CSS animations as engineer 16 did).
- DOM coordinate proof: at the start phase, at least one character of the active phrase has `getBoundingClientRect().left` < (chat box's `left` - 200px). Capture this in a `preview_eval` snippet in the PR body.
- Settled phase: characters consolidate inside the chat box (existing engineer 16 settled state, unchanged).
- EN + JP locale screenshots both attached.

---

## Item B — Auth-gated dogfood pass (Sections B-G, I, K + auth parts of A and J)

Per memory `feedback_dogfood_engineer_vs_human.md`, engineer runs system functionality. Engineer 16 ran what was reachable without a session; this run picks up everything that requires authentication.

### Setup the session

Ryuto provided a `next-auth.session-token` JWT in the chat alongside the prompt that launched you (will be passed in your launch prompt, NOT in this committed file — handoff docs must never contain secrets). Use `preview_eval` on the dev preview server to install it as a cookie:

```js
document.cookie = `next-auth.session-token=${TOKEN}; path=/; max-age=86400`;
```

Use the unsecured cookie name on `localhost` (the `__Secure-` prefix only applies to HTTPS). Confirm the session is live by navigating to `/app` and seeing the authenticated shell.

**Critical secrets handling**:
- Do NOT log the token. Do NOT include it in screenshots that show the DevTools cookie panel.
- Do NOT commit it (no .env files, no notes, no commit messages, no PR body).
- After the dogfood pass, the cookie can stay in the dev cookie store — it's a localhost session, not a production credential.

### Sections to verify (with checklist from `docs/dogfood/dogfood-resources.md`)

For each section below, run every check in the handbook, record `pass` / `fail` / `skip` with a one-line note + screenshot or log evidence. Update the handbook's per-section result block as you go.

- **A — Domain + Auth**: only the auth-redirect parts that engineer 16 couldn't reach. Confirm `/login` → Google → `/app/onboarding` (or `/app` if onboarded) round-trip works.
- **B — Onboarding**: full flow, verify each step's persistence + redirect.
- **C — Chat basic**: send a message, verify streaming, verify a tool call fires (e.g. ask Steadii to add a task), verify the response renders ONCE (no dup — the recently-merged engineer 15 fix should hold).
- **D — Inbox + sender picker**: open an inbox item, verify the badge decrements (engineer 15 fix), verify sender picker UI.
- **E — Notification UX**: trigger a draft, verify the bell shows + popover renders.
- **F — Settings → Connections**: each provider (Google, Notion, MS) — verify OAuth round-trip OR connected-state rendering.
- **G — iCal subscribe**: generate URL, fetch it via `curl` separately, verify ICS body parses.
- **I — Tasks + Calendar**: add a task via UI, verify it surfaces in Calendar tab; add a calendar event, verify it appears in Tasks if it has the right kind.
- **J — Admin waitlist flow**: only the auth-required parts; the public form was already verified by engineer 16.
- **K — Settings 全体**: each panel (Profile, Voice, Notifications, Billing, Connections, Plan, Danger Zone) — verify it loads + a representative setting persists across reload.

### Output to share with sparring

Per `feedback_dogfood_engineer_vs_human.md`, your final report should include:
- Per-section result table (pass/fail/skip with one-line note)
- Screenshots for failed sections
- Top-3 most concerning issues with severity (blocker / nice-to-have / cosmetic)
- "Memory entries to update" per AGENTS.md §12

---

## Item C — Section L (Sentry / Vercel logs)

### Vercel logs (always attempt)

Ryuto provided a Vercel API token in the launch prompt. Use it via the Vercel REST API:

```bash
curl -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v3/deployments?teamId=$VERCEL_TEAM_ID&limit=10" | jq
```

Find the most recent production deployment, then fetch its logs:

```bash
curl -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v2/deployments/$DEPLOYMENT_ID/events" | jq
```

Look for the count of `error` level events in the last 24h and any recurring patterns. Report the count + any standout error messages. Don't include the token in commits or PR body.

### Sentry (skip if no token)

Ryuto's first attempt at the Sentry token had insufficient scopes (no Issue & Event read). If a token with `event:read` + `org:read` is provided in the launch prompt, fetch unresolved issues:

```bash
curl -H "Authorization: Bearer $SENTRY_TOKEN" \
  "https://sentry.io/api/0/projects/steadii/<project-slug>/issues/?statsPeriod=24h&query=is:unresolved" | jq
```

If no Sentry token in the launch prompt, mark Section L Sentry as `skip — needs token` and proceed.

---

## Item D — Section M (Lighthouse)

No credentials needed for marketing routes. Run from the engineer's environment:

```bash
npx --yes lighthouse http://localhost:3000/ \
  --only-categories=performance,accessibility,best-practices,seo \
  --output=json --output-path=/tmp/lighthouse-marketing.json \
  --chrome-flags="--headless"
```

For app routes (which need the session cookie), set the cookie via `--extra-headers` with the session JWT:

```bash
npx --yes lighthouse http://localhost:3000/app \
  --only-categories=performance,accessibility,best-practices \
  --output=json --output-path=/tmp/lighthouse-app.json \
  --extra-headers='{"Cookie":"next-auth.session-token=...JWT..."}' \
  --chrome-flags="--headless"
```

Report the four scores per page in the PR body. Don't commit the JSON files.

---

## Item E — Section N (DEPLOY.md §8 production smoke, partial)

Most of §8 requires real OAuth completion which engineer can't do. The portions you CAN do:
- §8.1 Public surfaces — curl each public URL on `mysteadii.com` (or whatever Ryuto's production domain is — confirm via `vercel ls` with the token).
- Any subsection that doesn't require interactive sign-in.

Mark the rest `skip — needs Ryuto sign-in on production`. Ryuto runs the OAuth-gated parts separately.

---

## Out of scope

- Section H (visual polish, Ryuto's eye)
- The Sentry portion of L if no scoped token is provided (skip cleanly)
- Any feature work or bug fixes surfaced during dogfood — flag in report, don't silently expand scope
- Production OAuth-gated portions of N — Ryuto runs

## Constraints

- Pre-commit hooks must pass; no `--no-verify`
- Conversation Japanese; commits + PR body English
- Don't push without Ryuto's explicit authorization
- **Secrets**: NEVER commit, log, or include in PR body the session JWT, Vercel token, or any Sentry token. Use them only in-process via `preview_eval` cookie set, environment variable, or curl headers.
- Voice demo timing target: 12s loop, ≤2KB additional CSS, ≤4KB additional SVG (page weight matters on landing).

## Verification plan

1. `pnpm typecheck` — clean (modulo pre-existing 2 errors)
2. `pnpm test` — green (modulo pre-existing 1 failure)
3. Self-captured screenshots per AGENTS.md §13:
   - Voice demo v2: 4 frames showing the 3-phrase loop (one screenshot per phrase entry, plus one settled)
   - Voice demo v2: EN locale + JP locale screenshots
   - DOM coord proof for Item A (char left position vs chat box left)
4. Dogfood per-section result table populated in the PR body

## When done

Per AGENTS.md §12, "Memory entries to update":

- `project_voice_input.md` — note voice demo v2 redesign + sample phrases locked
- `project_steadii.md` — if dogfood surfaces phase-state issues, flag the entry
- New tech-debt issues surfaced during dogfood get added to the polish backlog as appropriate

Plus the dogfood per-section result table (in the PR body, not committed to the handbook).

# Polish-16 — `/app/*` i18n consistency audit + fix

Steadii ships JP/EN bilingual via `next-intl`. Translation files are at `lib/i18n/translations/{en,ja}.ts` (typed: `en.ts` defines the `Messages` shape; `ja.ts` implements the same shape). The structural typing means **translation keys are guaranteed to exist in both locales**, so missing keys are NOT the failure mode here.

The actual failure modes (observed by Ryuto, exact spots TBD by you):

1. **Hardcoded strings in JSX** — `<span>Steadii noticed</span>`, `<Button>Try again</Button>` — bypassing `t()` entirely. These show as English to JA users.
2. **Cross-locale leak inside one locale's file** — e.g. an EN string accidentally placed in `ja.ts`, or vice versa. Type system can't catch this; only manual review.
3. **Inconsistent terminology** across keys — same UI concept (e.g. "Tasks", "Settings") translated differently in different sections.
4. **Keys referenced incorrectly** — `t("foo.bar")` referenced where the namespace is wrong, falling back to the key string display.

This is an audit-then-fix PR. Most fixes are 1-line replacements; some sections may need a new key added to both locale files.

## Setup

```bash
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
git status   # clean (next-env.d.ts dirty is fine, auto-generated)
git log --oneline -5
```

Most recent expected: PR #111 (voice demo v4). If main isn't at #111 or later, **STOP** and flag.

Branch: `polish-16-app-i18n-consistency`. Don't push without Ryuto's explicit authorization.

---

## Scope

### In scope

Every route + component under `app/app/*`. Audit for the 4 failure modes above. Fix everything you find.

Routes (all need a pass):

- `app/app/page.tsx` — Home
- `app/app/inbox/*` — inbox list, detail, proposals
- `app/app/chat/*` and `app/app/chats/*` — chat list, thread
- `app/app/classes/*` — list, new, detail (4 tabs)
- `app/app/calendar/*` — month / week / day views
- `app/app/tasks/*` — list
- `app/app/assignments/*` — list, detail
- `app/app/mistakes/*` — list, detail (markdown editor)
- `app/app/syllabus/*` — list, new
- `app/app/resources/*`
- `app/app/settings/*` — main, connections, how-your-agent-thinks, billing (skip Stripe portal redirect content), billing/cancel
- `app/app/admin/*` — admin pages including waitlist (Ryuto-only but should still be JP/EN consistent for future admins)
- `app/app/error.tsx`, `app/app/loading.tsx`, `app/app/layout.tsx`, `app/app/not-found.tsx` — global shells

Also review **components used inside `/app/app/`** that aren't in `app/app/*` itself but render there:

- `components/layout/*` — sidebar, header, footer that wrap /app
- `components/inbox/*`, `components/chat/*`, `components/agent/*`, etc. — anything imported by app routes
- `components/suggestions/*` — contextual integration suggestion cards (rendered on multiple /app pages)

### Out of scope

- Marketing landing (`app/page.tsx`, `components/landing/*`) — done separately, has its own i18n hygiene
- Auth-flow pages: `/login`, `/request-access`, `/onboarding`, `/invite/[code]`, `/access-pending`, `/access-denied`
- Privacy / Terms pages
- Email digest templates (`lib/integrations/resend/templates/*`) — separate concern, server-rendered HTML
- API routes (`app/api/*`) — no UI text
- Translation files themselves at the structural level — DO NOT rename keys, restructure namespaces, or change the schema. Only fix string values when they're wrong-language. Adding new keys to fix hardcoded strings is fine and expected.

---

## Investigation phase (before any code changes)

Run these greps from repo root and collect findings into a notes scratch file. Don't fix yet — get the full picture first so you can batch.

```bash
# 1. JSX text nodes containing JP characters (likely hardcoded JP)
grep -rEn ">[^<>{}\$]*[ぁ-んァ-ヴー一-龯][^<>{}\$]*<" --include="*.tsx" -- app/app/ components/ \
  | grep -v "// " | grep -v "/\\*"

# 2. JSX text nodes that look like hardcoded EN sentences (3+ word phrases starting capitalized)
grep -rEn ">[^<>{}\$]*[A-Z][a-zA-Z]+(\s+[a-zA-Z]+){2,}[^<>{}\$]*<" --include="*.tsx" -- app/app/ components/ \
  | grep -v "className\|import\|type=\|aria-" | head -100

# 3. String literals in TS files that look like UI sentences (toasts, alerts, error messages)
grep -rEn "['\"](Failed to|Could not|Successfully|Please |An error)[^'\"]+['\"]" --include="*.ts" --include="*.tsx" -- app/app/ components/

# 4. Find every t(...) call and inspect for typos / wrong namespaces
grep -rEn "\bt\(['\"]" --include="*.tsx" --include="*.ts" -- app/app/ components/

# 5. Cross-locale leak — JP chars in en.ts, EN-looking phrases in ja.ts
grep -nE "[ぁ-んァ-ヴー一-龯]" lib/i18n/translations/en.ts
# (manually review ja.ts for English sentences that shouldn't be there — type system can't catch)
```

Categorize findings into:

- **Group A — hardcoded strings** (1-line fix per call site, may need new translation key)
- **Group B — locale leak in translation file** (1-line fix per key)
- **Group C — wrong namespace / typo in t() call** (1-line fix per call site)
- **Group D — terminology inconsistency** (group together, decide canonical, update all)

---

## Fix phase

Order by failure mode:

### Phase 1: Hardcoded strings (Group A)

For each hardcoded string:

1. Pick a stable key path. Prefer extending the route's existing namespace (e.g. `inbox.steadiiNoticed`) rather than creating new top-level groups.
2. Add the key to `lib/i18n/translations/en.ts` (the canonical type definition) — TypeScript will then **error** on `ja.ts` until you add the JA equivalent. This is the safety net.
3. Add the matching key to `lib/i18n/translations/ja.ts`.
4. Replace the JSX literal with `t("…")`.
5. If the component isn't yet wired for translations (rare), add `const t = useTranslations("inbox")` (or `await getTranslations` for server components).

### Phase 2: Locale leak in translation files (Group B)

For each EN string mistakenly in `ja.ts` or vice versa, just translate it correctly. If you need help with translation register, default to:

- **JA register**: polite (です・ます), no excessive keigo. Match existing JA tone in surrounding keys.
- **EN register**: clear and direct, sentence case for buttons / titles (NOT title case unless the brand voice doc says otherwise — Steadii uses sentence case throughout).

### Phase 3: Wrong namespace / typo (Group C)

Fix the `t()` call to point at the right key path.

### Phase 4: Terminology consistency (Group D)

Audit your findings for the same UI concept translated multiple ways. Pick canonical, update everywhere, remove duplicate keys if any. Common candidates to check:

- "Tasks" vs "To do" vs "TODO"
- "Classes" vs "Courses"
- "Mistake notes" vs "Mistakes"
- "Settings" vs "Preferences"
- "Save" vs "Update" vs "Apply"
- JA: 「タスク」 vs 「To do」 vs 「予定」

Document your canonical choices in the PR description so future translation work stays aligned.

---

## Verification

For each fixed page, switch locales and screenshot at desktop 1440×900:

1. Set locale to EN — load page — `preview_screenshot` — visually confirm no JP text leaks
2. Set locale to JA — load page — `preview_screenshot` — visually confirm no EN text leaks
3. Repeat for every page you touched

Locale switching is in `app/app/settings/page.tsx` (Language dropdown). Or set the cookie directly:

```js
// in preview_eval
document.cookie = "NEXT_LOCALE=ja; path=/; max-age=31536000";
location.reload();
// or "en" to switch back
```

Per memory `feedback_self_capture_verification_screenshots.md` and AGENTS.md §13 — you (the engineer) capture screenshots, do NOT ask Ryuto.

Fixed-pages screenshots go in your final report. One pair (EN + JA) per touched page is enough.

---

## Tests

If any new translation key is added:

- Compile passes (TypeScript will enforce key parity between en.ts and ja.ts via the `Messages` type)
- No new behavior to test — these are display-only string changes

If you fixed a `t()` call that was previously rendering the literal key string, mention it in the report — that was a user-visible bug.

No new Playwright / unit tests required for this PR.

---

## What NOT to touch

- Translation file **structure / type schema** — don't rename existing keys, don't restructure namespaces. Adding new keys is fine.
- Auth-flow pages, marketing pages, email templates (out of scope above)
- Server-side log messages, error stacks, console outputs — those are dev-facing, not user-facing
- Code comments — those are dev-facing too
- Stripe / Resend dashboard content — not ours to translate

If you find an i18n bug in the OUT OF SCOPE areas (especially the email templates), flag it in the report but don't fix in this PR — separate concern.

---

## Final report format

Per AGENTS.md §12, your final report MUST include:

1. **Branch / PR name**: `polish-16-app-i18n-consistency`
2. **Summary**: how many issues found per group (A/B/C/D), how many fixed
3. **Verification screenshots**: one EN + one JA per touched page (paired side-by-side OK), all 1440×900
4. **List of new translation keys added** (key path → EN value → JA value)
5. **Terminology decisions made in Phase 4** (canonical pick → previously-used variants → why)
6. **Any out-of-scope bugs flagged for follow-up**
7. **Memory entries to update**: e.g. if there's a useful pattern future agents should know (locale switching trick, common typo class)

---

## Do not re-spar

These are locked, do NOT propose changes:

- next-intl as i18n lib (vs alternatives) — locked
- 2-locale support EN + JA — locked, no other locales until post-α (Korean / Chinese deferred)
- Default locale = EN (per `lib/i18n/config.ts`) — locked
- JA register = polite (です・ます) — locked
- Sentence case for EN buttons / titles — locked
- File layout (one file per locale, type defined in en.ts) — locked

If something feels like it needs structural change, flag it in the report — don't pre-empt.

---

## Estimated effort

- Investigation phase: ~1-2h (greps + categorize)
- Phase 1 (hardcoded): expected biggest bucket, ~2-4h depending on count (ballpark 30-80 strings)
- Phases 2-4: ~1-2h combined
- Verification screenshots: ~1h (every touched page, 2 locales each)

Total ballpark: **~5-9h**, single PR, single branch.

If investigation reveals >150 hardcoded strings or you hit terminology decisions that need product-level input, **pause and flag** rather than guess.

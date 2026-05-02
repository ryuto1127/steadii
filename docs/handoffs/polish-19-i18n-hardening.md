# polish-19 — i18n hardening pass

A dedicated session to make Steadii's i18n drift-resistant. Three previous attempts (engineer 17 / sparring 17.5 / engineer 18) closed visible misses by hand, and each time a new miss was discovered a few days later. The failure mode is **not engineer skill** — it's **process**. Humans (and Claude Code) miss strings during visual audits. The fix is to **automate detection and gate CI** so regressions are caught at PR time, not by Ryuto's eye on production.

This wave installs the audit infrastructure, then sweeps every miss it finds, then locks the CI gate.

## Setup

```bash
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
git status
git log --oneline -5
```

Most recent expected: PR #118 (Wave 2 home rebuild). If main isn't there, **STOP** and flag.

Branch: `polish-19-i18n-hardening`. Don't push without Ryuto's explicit authorization.

---

## Strategic context

Read `project_secretary_pivot.md` (memory) for the secretary pivot brand context — copy must match the secretary positioning. JA register stays polite (です・ます), EN sentence case for buttons / titles. Default locale is EN.

**No new translation keys / no copy reframing in this wave.** This is hardening only — find what's already broken, fix it, prevent regression. Copy-content decisions (what should this string SAY?) are done in feature waves; polish-19 is "plumbing & sweep".

---

## Scope

Four sub-scopes, all in this PR. Order suggested:

### 1. i18n audit script

Create `scripts/i18n-audit.ts` — a Node script that:

- Walks `app/`, `components/` recursively
- Parses `.tsx` files via the TypeScript compiler API (`ts.createSourceFile` + `ts.forEachChild`)
- Finds JSX text nodes (`JsxText`) and string literal children of JSX elements that are NOT wrapped in a `t()` call or already inside a `useTranslations()` / `getTranslations()` scope's t-output
- Reports each finding as `{ file, line, column, context: surrounding-line-snippet, kind: "jsx-text" | "string-literal" | "title-attribute" }`

**Whitelist patterns** (skip these — they are not user-visible UI strings):

- The literal string `"Steadii"` (brand name, deliberately untranslated)
- Strings inside `aria-label`, `title`, `alt` ONLY if they are short identifiers (e.g. `aria-label="logo"` is fine; `aria-label="Send draft"` is NOT — that's user-facing)
- Strings inside `className`, `style`, `id`, `data-*`, `key`, `name`, `type`, `role`, `href`, `src`, `tabIndex`, `htmlFor`
- Strings that look like code identifiers (matches `^[a-z][a-zA-Z0-9_]*$` + length ≤ 32) — likely a CSS class, type, or enum value
- Strings inside `console.*`, `Sentry.*`, `throw new Error(...)` — server-side log/error, not user-visible
- Strings that are pure punctuation / numbers / single Unicode symbols (e.g. `"·"`, `"—"`, `"⌘"`, `":"`, `"/"`) — formatting characters
- File paths inside `import` statements
- HTTP method names, URL fragments, MIME types

Document the whitelist rules at the top of the script as comments so a future maintainer can extend.

**CLI output**: tabular text by default, optional `--json` flag for programmatic consumption (used by the regression test in scope 3).

```bash
pnpm tsx scripts/i18n-audit.ts                    # human report
pnpm tsx scripts/i18n-audit.ts --json > issues.json  # for the test
```

### 2. Locale parity test

Create `tests/i18n-parity.test.ts` (vitest):

- Import `en` from `lib/i18n/translations/en.ts` and `ja` from `lib/i18n/translations/ja.ts`
- TypeScript already enforces structural key parity (the `Messages` type defined in `en.ts` is implemented by `ja.ts`). This test adds **value-level checks**:
  - Every leaf string value is non-empty (length > 0) — fails if any leaf is `""` or whitespace-only
  - **Soft warnings** (test passes but logs warnings):
    - JA tree leaf values that are pure Latin alphabet (no CJK chars at all) — possibly an English string forgotten in the JA file. Whitelist exceptions: brand names, model identifiers, short identifier-like strings.
    - EN tree leaf values that contain CJK (hiragana / katakana / kanji) — possibly a Japanese string accidentally placed in EN.
  - **Hard failures**:
    - Placeholder parity: every `{name}` style placeholder appearing in en's value must also appear in ja's value at the same key path, and vice versa
    - Type parity for nested objects (handled by TS already, but assert at runtime as defense-in-depth)

- Add a separate `tests/i18n-coverage.test.ts` that runs the audit script (scope 1) in `--json` mode and asserts the issue count is 0 (after the sweep in scope 4 lands)

### 3. CI regression gate

- Wire both `tests/i18n-parity.test.ts` and `tests/i18n-coverage.test.ts` into the existing `pnpm test` run. They become part of vitest's test suite.
- No separate CI job needed — Vercel preview build catches the existing test failures already (see `pnpm test` exit code).
- Optional: add a `pnpm i18n:audit` script in `package.json` that runs the audit script for ad-hoc checks during development.

After this scope, any future PR that introduces a hardcoded JSX string OR a missing/inconsistent locale value fails CI before merge.

### 4. Sweep all current misses

Run the audit script. For each reported issue:

- If it's a **legitimate user-visible string** → add a translation key (use the most semantically appropriate existing namespace, or add a new sub-namespace if needed) → wrap with `t()`
- If it's a **whitelist false negative** → extend the whitelist rules, document why
- If it's intentional untranslated text → check whether the rule legitimately applies; if so, whitelist with a comment

Aim: reduce the audit output to **zero findings** by the end of this wave. Any remaining items must be whitelisted with explicit rationale.

Expected scale based on prior session experience: somewhere between **20 and 80 missed strings** across the codebase. Bulk of fixes will be small (single-line t() wraps with new keys added to en.ts + ja.ts).

For new keys, follow these conventions (already established by Wave 1 / 2):
- Top-level namespace = page or feature (e.g. `inbox`, `settings`, `agent.queue_card`)
- Snake_case key names within namespace
- For dynamic content with placeholders: `{name}` not `{0}`, named always
- JA register: polite (です・ます), no excessive keigo
- EN: sentence case for buttons/titles

---

## What NOT to touch

- **Existing translation key NAMES / namespaces** — only add new keys, don't rename or restructure
- **Existing translation VALUES** that are already correct — only fix wrong-language leaks (JA in EN, EN in JA) and missing/empty values
- **Brand voice reframing** — copy decisions belong in feature waves, not here
- **Marketing landing copy beyond what was already locked in Wave 1** — if you find more secretary-vs-tutor framing issues in the landing, flag them in the report but don't fix in this PR (separate concern)
- **API routes / server-only files** that don't render to user-visible UI (audit script should already skip these, but be alert if your whitelist needs extending)

---

## Verification

For each modified surface (every page or component you touched while sweeping), capture screenshots @ 1440×900 in BOTH locales (EN + JA). Per AGENTS.md §13, you self-capture, do NOT ask Ryuto.

Specific captures:

- Each page where you added new translation keys (just one EN + JA pair per page is enough — proves the t() wrap renders correctly in both)
- The audit script CLI output before sweep (showing N findings) and after sweep (showing 0 findings or only whitelisted items)
- The new test file outputs in `pnpm test` (passing)

---

## Tests

- Typecheck must pass (the 2 pre-existing `tests/handwritten-mistake-save.test.ts` failures unchanged)
- `pnpm test` must stay above 809 / 809 pass — no regressions
- Two new test files added (`tests/i18n-parity.test.ts` + `tests/i18n-coverage.test.ts`)
- Audit script has its own test (`tests/i18n-audit.test.ts`) covering:
  - Basic JSX text detection
  - String-literal-as-child detection
  - At least 3 whitelist patterns
  - JSON output mode

---

## Final report format

Per AGENTS.md §12:

1. **Branch / PR name**: `polish-19-i18n-hardening`
2. **Summary**: how many issues the audit found, how many were sweeps vs whitelist extensions
3. **Verification screenshots**: per-touched-page EN + JA, all 1440×900
4. **Tests added**: i18n-parity / i18n-coverage / i18n-audit
5. **Whitelist rationale**: any patterns that needed explicit allow, with reasoning
6. **Memory entries to update**: if the i18n hardening pattern itself reveals a process learning (e.g. a class of issues the script can't catch), document for future engineers
7. **Out-of-scope flags**: anything you noticed for follow-up (typically: copy decisions that are NOT i18n issues but are brand/UX issues — those go to feature waves)

---

## Estimated scope (note: time isn't a decision factor; cost is)

- LLM cost during implementation: minimal (audit script is rule-based, no LLM. Wrap fixes are mechanical.)
- Ongoing cost: zero (no runtime LLM in this hardening; the audit + tests are dev-time only).

Single PR, single branch. If the audit surfaces >150 issues or reveals a structural mismatch between en.ts and ja.ts that TypeScript missed, **pause and flag** — that's a different class of problem than this wave is set up to solve.

# Polish-13a — i18n parity (JP α-blocking fixes)

α launches in 1-2 days with 10 Japanese university students. The Settings / Connections page and several polish-12 components currently render hardcoded English strings even when the UI locale is Japanese. JP cohort cannot manage OAuth state in their language and sees broken bilingual UX. **Highest-priority fix before α invite send.**

## Setup

```
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
git status   # clean
git log --oneline -3
```

Most recent expected: `358a1f8 Merge pull request #73 from ryuto1127/hotfix/inbox-read-badge` or later. If main isn't there or later, **STOP**.

Branch: `polish-13a-i18n-parity`. Don't push without Ryuto's explicit authorization.

---

## Findings

A multi-agent review on 2026-04-28 surfaced these specific gaps (file:line citations from the audit). Treat the list as the authoritative scope.

### 1. Settings / Connections page (CRITICAL — entirely English)

`app/app/settings/page.tsx` lines `~143-283`, the Notion / Google / Microsoft / iCal / Resources sections render fully hardcoded English:

- `~145`: `"workspace"` fallback
- `~147-148`: `"Connected to {workspaceName}"`, `"setup complete"` / `"setup pending"`
- `~150`: `"Not connected"`
- `~159`: `"Disconnect"`
- `~167`: `"Connect"`
- `~175`: `"Calendar scope granted."`
- `~184`: `"Sign out to re-auth"`
- `~194`: `"Gmail scope granted. The agent can triage and draft replies."`
- `~206`: `"No manual resources yet."`
- `~215`: `"auto-registered"`
- `~231, 250, 259, 281`: misc status / role labels (`"manual"`, etc.)

These are user-facing on a page JP students absolutely will hit (they manage their integrations there).

### 2. Polish-12 components hardcoded English

- `components/classes/syllabus-row-actions.tsx:94`: `.replace("Edit class", "Edit syllabus")` — string-manipulation hack instead of a proper translation key
- `components/classes/assignment-row.tsx:27`: `"No due"` (rendered when `dueAt === null`)
- `components/classes/assignment-row.tsx:126`: `status.replace("_", " ")` — renders enum as `"in progress"`, `"not started"` in English
- `app/app/classes/[id]/page.tsx:162, 165, 166`: Syllabus tab empty state — `"No syllabus saved for…"`, `"Upload PDF"`, `"Paste URL"`

### 3. Date formatting unlocalized

- `components/classes/assignment-row.tsx:29` (`formatDueShort`): `new Date(iso).toLocaleDateString()` with no locale arg — defaults to browser locale, may render `"4/28/2026"` even when UI is JA. Should be `toLocaleDateString(locale === "ja" ? "ja-JP" : "en-US")` or use next-intl's format helpers.

Search the broader codebase for the same pattern. Any `toLocaleDateString()` / `toLocaleString()` / `toLocaleTimeString()` without locale arg in user-facing surfaces gets the same treatment.

### 4. JA tone polish (non-blocking but in-scope)

`lib/i18n/translations/ja.ts:163` — `delete_class.confirm_body`:
> 現在: "シラバス {syllabi} 件、タスク {assignments} 件、間違いノート {mistakes} 件も同時に削除されます。この授業を参照しているチャットはタグが外れますが、チャット自体は残ります。"
> 改善案: "シラバス {syllabi} 件、タスク {assignments} 件、間違いノート {mistakes} 件も同時に削除されます。この授業を参照しているチャットのタグは外れますが、内容は保持されます。"

Tighter phrasing, matches the locked Steadii brand voice (淡々、簡潔). Apply the same critical eye to other new polish-12 JA strings — flag any that read like awkward translation rather than native phrasing.

---

## Implementation plan

### Step 1 — Add translation keys

Open `lib/i18n/translations/en.ts` and `lib/i18n/translations/ja.ts`. Add keys under existing namespaces. Example structure (adjust to existing nesting conventions):

```ts
settings: {
  ...existing,
  connections: {
    ...existing,
    workspace_fallback: "workspace" / "ワークスペース",
    connected_to: "Connected to {workspaceName}" / "{workspaceName} に接続済み",
    setup_complete: "setup complete" / "セットアップ完了",
    setup_pending: "setup pending" / "セットアップ中",
    not_connected: "Not connected" / "未接続",
    disconnect: "Disconnect" / "接続解除",
    connect: "Connect" / "接続",
    google_calendar_granted: "Calendar scope granted." / "カレンダー権限を付与しました。",
    sign_out_to_reauth: "Sign out to re-auth" / "再認証するにはサインアウトしてください",
    gmail_scope_granted: "Gmail scope granted. The agent can triage and draft replies." / "Gmail 権限を付与しました。エージェントが受信箱を分類して下書きを作れます。",
    no_manual_resources: "No manual resources yet." / "登録されたリソースはまだありません。",
    auto_registered: "auto-registered" / "自動登録",
    manual: "manual" / "手動",
  },
},
classes: {
  ...existing,
  syllabus: {
    ...existing,
    edit_modal_title: "Edit syllabus" / "シラバスを編集",
    empty_title: "No syllabus saved for {className}." / "{className} にはまだシラバスがありません。",
    upload_pdf: "Upload PDF" / "PDF をアップロード",
    paste_url: "Paste URL" / "URL を貼り付け",
  },
  assignments: {
    ...existing,
    no_due: "No due" / "期限なし",
    status: {
      not_started: "Not started" / "未着手",
      in_progress: "In progress" / "進行中",
      done: "Done" / "完了",
      // verify the actual enum values in lib/db/schema.ts assignmentStatus
    },
    due_short: "due {date}" / "期限 {date}",
  },
},
```

The exact key names + nesting are flexible — match existing conventions (e.g., flat vs nested) in en.ts. Mirror in ja.ts.

### Step 2 — Replace hardcoded strings in components

For each location listed in Findings:

- Pull the appropriate `useTranslations()` (client) / `getTranslations()` (server) namespace
- Replace the literal string with the translation call
- For status enums (`assignment-row.tsx:126`), build a small helper or use a dictionary lookup keyed on the enum value, NOT `string.replace("_", " ")`

For `syllabus-row-actions.tsx:94`, remove the `.replace("Edit class", "Edit syllabus")` antipattern entirely. Pass the proper translation key from the parent component or look up `tClasses("syllabus.edit_modal_title")` directly.

### Step 3 — Fix date formatting

In `components/classes/assignment-row.tsx`, accept the current locale (via prop or `useLocale()` from next-intl) and pass it to `toLocaleDateString`. Then audit the rest of the codebase:

```bash
grep -rn "toLocaleDateString\|toLocaleString\|toLocaleTimeString" \
  --include="*.tsx" --include="*.ts" \
  app/ components/ | grep -v node_modules
```

For each match without an explicit locale arg in a user-facing render path, fix it the same way. Background jobs / logs / DB strings stay UTC ISO and don't need a locale.

### Step 4 — Tighten the one identified JA phrasing

`lib/i18n/translations/ja.ts` `delete_class.confirm_body` per the suggestion above. While you're in ja.ts, eyeball the other recently-added polish-12 keys for similar awkward phrasing (you'll spot it if it reads like google-translate). Tighten on a case-by-case basis but **do not over-rewrite** — Ryuto wrote / approved most of these and they're mostly fine.

### Step 5 — Sanity sweep

After edits, run:

```bash
# Find any remaining hardcoded user-facing English in app/* and components/*
# (heuristic — manual review needed for what's user-facing vs internal)
grep -rn '"[A-Z][a-z]\+ [a-z]\+' app/app/ components/ | grep -v node_modules | grep -v test
```

Plus a targeted `grep -rn` for the specific English strings listed in Findings to confirm zero remaining.

---

## Verification

1. `pnpm typecheck` — clean (only pre-existing handwritten-mistake-save errors)
2. `pnpm test` — no regressions
3. `pnpm build` — clean (Turbopack is strict about i18n key shape)
4. Manual smoke (dev server, switch UI to JA via `Settings → Language`):
   - Settings / Connections page — all labels JA
   - `/app/classes/[id]` Syllabus tab empty state — JA
   - `/app/classes/[id]` Assignments tab with a no-due assignment — "期限なし"
   - `/app/classes/[id]` Assignments tab with `in_progress` assignment — "進行中"
   - Class header "edit class" / "delete class" — JA labels (already worked? verify)
   - Date on assignment rows — `2026/4/28` format, not `4/28/2026`

---

## Out of scope

- Translating user-uploaded content (syllabus PDFs, mistake notes — those are user data, not UI)
- Re-auditing earlier phases — the critical α path is Settings + new polish-12 surfaces only
- Adding additional locales (zh / ko / etc.) — α is JP+EN only
- Restructuring the en.ts / ja.ts file layout — match existing conventions

---

## Constraints

- Locked decisions in `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/` are sacred
- Pre-commit hooks must pass; no `--no-verify`
- Conversation Japanese; commits + PR body English
- Don't push without Ryuto's explicit authorization
- Match existing en.ts / ja.ts naming conventions — don't introduce a new key style
- Tone: 淡々、簡潔、light dry humor. Do not write JA copy that sounds corporate (致します・申し上げます NG) or overly cheerful (! 多用 NG)
- The locked hero feature line in JA (`間違いノート・シラバス・課題はそのまま保管...`) MUST NOT be touched — it's product copy, not a translation candidate

---

## Context files

- `app/app/settings/page.tsx` — primary fix site (hardcoded EN clusters)
- `components/classes/syllabus-row-actions.tsx`, `components/classes/assignment-row.tsx`, `app/app/classes/[id]/page.tsx` — polish-12 component fixes
- `lib/i18n/translations/en.ts`, `lib/i18n/translations/ja.ts` — add keys
- `lib/db/schema.ts` — verify `assignmentStatus` enum values for status translation map
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_pre_launch_redesign.md` — tone reference (淡々・簡潔)
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_decisions.md` — α JP cohort context

---

## When done

Report back with:
- Branch + final commit hash
- Verification log (typecheck, test, build, manual JA smoke for each surface)
- Total new keys added (rough count, EN side)
- Any deviations from the brief + 1-line reason each
- Confirmation that the JA UI on `Settings`, `/app/classes/[id]` (all 4 tabs), and `Settings → Danger Zone → wipe modal` renders with zero English strings

The next work unit is polish-13b (race conditions). Do not start polish-13b in the same session — fresh engineer session per work unit per the project's role-split convention.

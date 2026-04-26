# Phase 7 W-Notes Completion Report — Handwritten note OCR

Implementation pickup of the Phase 7 W-Notes brief (handwritten / scanned
notes → vision OCR → first-class `mistake_notes` row). Three PRs landed
locally on top of `main` (commit `6073538`), branched as
`phase7-w-notes-{schema, ui, docs}`. Pushes pending Ryuto's authorization.

---

## 1. PR map

| PR | Branch | Local HEAD | Scope |
|----|--------|------------|-------|
| 1 | `phase7-w-notes-schema` | `c055bd8` | Schema migration + `notes_extract` model + `lib/notes/{extract,router}` + `app/api/notes/extract` + 16 unit tests |
| 2 | `phase7-w-notes-ui` | `675a7d7` | `saveHandwrittenMistakeNote()` + `app/api/mistakes/save-handwritten` + photo upload button/modal + i18n (12 keys × 2 locales) + 6 tests |
| 3 | `phase7-w-notes-docs` | (this PR) | Integration test for the save chain + this completion report (5 tests) |

The branches stack: each is built off the previous PR's HEAD. Open
order should be 1 → 2 → 3 so each PR's diff is reviewable in isolation.

---

## 2. Decision-Q coverage (brief § "DECISIONS LOCKED")

- **Q1 — absorb into `mistake_notes`**. New `source` column
  (`"user_typed" | "handwritten_ocr"`, default `"user_typed"`) +
  `source_blob_asset_id` FK to `blob_assets`. Existing rows backfill
  via the column default; no data migration needed.
- **Q2 — Mistakes-tab "📷 写真から追加" button**. No new sidebar
  item, no Settings page. The button sits at the top of the Mistakes
  tab on `/app/classes/[id]?tab=mistakes` and shows whether or not
  the class already has notes.
- **Q3 — α scope = transcription only**. Verbatim system prompt;
  no analytical "spot the mistake" pass. The Phase 8 candidate is
  out of scope and not stubbed.
- **Q4 — GPT-5.4 vision only**. New `notes_extract` task type routes
  to the complex tier (same shape as `syllabus_extract`), metered
  through `recordUsage` + the existing credit pool.

---

## 3. PR-by-PR summary

### PR 1 — Schema + extract module (`phase7-w-notes-schema`)

- **Migration `0021_unique_king_bedlam.sql`**:
  ```sql
  ALTER TABLE "mistake_notes" ADD COLUMN "source" text DEFAULT 'user_typed' NOT NULL;
  ALTER TABLE "mistake_notes" ADD COLUMN "source_blob_asset_id" uuid;
  ALTER TABLE "mistake_notes" ADD CONSTRAINT "mistake_notes_source_blob_asset_id_blob_assets_id_fk" ...;
  ```
  Backfill is implicit. The FK uses `ON DELETE SET NULL` so deleting
  a blob doesn't cascade-delete the note.
- **`lib/blob/save.ts`**: `BlobSource` union extended with
  `"handwritten_note"`. The `blob_assets.source` column $type is
  widened to match.
- **`lib/agent/models.ts`**: `notes_extract` task type added to the
  union, routed to `gpt-5.4` (complex), included in
  `taskTypeMetersCredits`. Three call sites updated.
- **`lib/notes/extract.ts`**: vision OCR module. The system prompt
  locks in the verbatim invariant (`project_decisions.md`):
  - VERBATIM ONLY — no summarizing, no interpreting, no fixing
    student errors; crossed-out content marked in italics.
  - Math via LaTeX (`$...$` inline, `$$...$$` block).
  - Diagrams degrade to text descriptions in fenced code blocks
    (verbatim sketch beats hallucinated re-drawing).
  - Multi-page input separated by `## Page N`.
  - Illegible regions marked `[illegible]`, never guessed.
  - Output is markdown only, no JSON schema.
- **`lib/notes/router.ts`**: image → vision; PDF → vision (PR 1
  defers PDF rasterization, see §5).
- **`app/api/notes/extract/route.ts`**: rate-limited POST that
  uploads to Vercel Blob (`source: "handwritten_note"`), runs the
  vision call for images, runs `pdf-parse` for typed PDFs, returns
  `PDF_NO_TEXT_LAYER` (422) for scanned PDFs with no extractable
  text. Surfaces `BillingQuotaExceededError` as 402.
- **Rate limit bucket**: `notesExtract` = 10 / 5 min, same as
  `syllabusExtract`.
- **Tests** (16 net-new across 3 files):
  - `tests/notes-router.test.ts` — accept matrix (PDF + 4 images,
    rejects office formats / svg) + the "all PDFs route to vision"
    invariant.
  - `tests/notes-extract.test.ts` — `buildNotesUserContent` shape
    for image + data URL, `countPagesInMarkdown` boundary cases,
    system-prompt invariants (VERBATIM / LaTeX / Page N /
    illegible), happy-path call shape (model = `gpt-5.4`, no
    `response_format`, usage recorded with `taskType:
    "notes_extract"`), quota short-circuit.
  - `tests/models.test.ts` — three additions covering routing,
    union exhaustiveness, and credit metering.

### PR 2 — UI integration (`phase7-w-notes-ui`)

- **`saveHandwrittenMistakeNote()`** in `lib/mistakes/save.ts`:
  sibling to `saveMistakeNote` but accepts the body + source-blob id
  directly (the OCR flow has nothing to derive from a chat message).
  Shape:
  ```ts
  {
    title, classId?, unit?, difficulty?, tags?,
    bodyMarkdown, sourceBlobAssetId,
  }
  ```
  Inserts with `source: "handwritten_ocr"`, calls
  `refreshMistakeEmbeddings`, audit-logs as
  `mistake.save_handwritten`.
- **`app/api/mistakes/save-handwritten/route.ts`**: POST endpoint
  that wraps the new save fn; surfaces 402 on quota exhaustion.
- **`components/mistakes/photo-upload-button.tsx`**: client component.
  Hidden file input + button + modal. Stages: `idle → extracting →
  preview → saving`. The preview stage shows an editable textarea
  pre-populated with the OCR markdown plus a title input
  (pre-populated by `deriveTitleFromFile`). On save it POSTs to
  `/api/mistakes/save-handwritten` and `router.refresh()` to surface
  the new note.
- **Wired into the Mistakes tab** in
  `app/app/classes/[id]/page.tsx`: the button is always visible at
  the top of the tab; the empty-state copy nudges the user toward
  it.
- **i18n** (12 new keys × en + ja under namespace `mistakes`):
  the 6 brief-locked labels plus 6 supporting strings (subtitle,
  cancel, error toasts, title placeholder, file-picker label).
- **Tests** (6 net-new):
  - `tests/i18n-mistakes-keys.test.ts` — every key present in both
    locales with non-empty strings; the brief-locked labels match
    the spec verbatim so docs/handoffs don't drift.
  - `tests/photo-upload-helpers.test.ts` — `deriveTitleFromFile`
    boundary cases (extension stripping, separator rewriting,
    Japanese filenames, edge case `.pdf` only).

### PR 3 — Integration test + docs (`phase7-w-notes-docs`)

- **`tests/handwritten-mistake-save.test.ts`** (5 net-new): mocks
  the DB / billing / embedding layers and asserts the save chain
  end-to-end:
  1. mistake_notes row carries `source: "handwritten_ocr"` + the
     right `sourceBlobAssetId`.
  2. `refreshMistakeEmbeddings` fires with the body markdown.
  3. audit_log row records `action: "mistake.save_handwritten"`.
  4. `BillingQuotaExceededError` propagates without inserting a row.
  5. embedding-fanout failure does NOT roll back the note (the row
     is the source of truth; chunks are an advisory cache).
- **This document** at
  `docs/handoffs/phase7-w-notes-completion-report.md`.

---

## 4. Verification log

| Check | Result |
|---|---|
| TypeScript strict (`npm run typecheck`) | ✅ |
| Test suite (`npm test`) | ✅ 78 files / 480 tests |
| Baseline before work | 73 files / 453 tests |
| Net new test coverage | +5 files / +27 tests |
| Drizzle migration generates cleanly | ✅ `0021_unique_king_bedlam.sql` |
| Existing chat-driven save path unchanged | ✅ `saveMistakeNote` untouched; new fn is a sibling |
| Embedding fanout rewrite-free | ✅ `refreshMistakeEmbeddings` reused as-is |
| Verbatim invariant honored in OCR prompt | ✅ system prompt + dedicated test |
| Phase 7 W1 fanout still picks up new notes | ✅ Notes flow through `mistake_note_chunks` → existing retrieval; no fanout-side change |

**Browser exercise**: not performed in this session — running the
dev server requires auth + DB credentials this engineer session
doesn't have. The UI mirrors `components/chat/mistake-note-dialog.tsx`
(established modal pattern); the integration test in PR 3 covers
the save → embed → audit path; the i18n test pins the brief-locked
labels.

**SQL spot-check for chunk fanout** (target — to run post-merge by
Ryuto with seed data):

```sql
-- Save one handwritten note via the UI, then:
SELECT id, title, source, source_blob_asset_id
FROM mistake_notes
WHERE source = 'handwritten_ocr'
ORDER BY created_at DESC
LIMIT 1;

-- And confirm chunks landed:
SELECT count(*) FROM mistake_note_chunks
WHERE mistake_id = '<id-from-above>';
```

---

## 5. Deviations from the brief

1. **PDF rasterization deferred**. The brief targets per-page vision
   OCR for handwritten PDFs (~1 credit / page). PR 1 ships the
   image path with vision and the typed-PDF path with `pdf-parse`;
   scanned PDFs return `PDF_NO_TEXT_LAYER` (422) with a clear
   message asking the user to upload as page images.
   *Reason*: no PDF-to-image renderer is wired in this codebase
   (pdfjs-dist isn't a dep). Adding it is a self-contained follow-up
   — keeping it out of α-W-Notes ships the dominant use case (image
   uploads from phone camera / GoodNotes export) without inflating
   the PR diff.

2. **No `lib/notes/router.ts` extraction of shared syllabus helpers**.
   The brief said "if a function in lib/syllabus/* would benefit
   from being extracted to a shared lib, do so in PR 1 with a clear
   refactor commit". After scanning `routeSyllabusInput` and
   `extractPdfText`, both are short and the syllabus / notes
   routing rules diverge meaningfully (syllabus prefers pdf-parse;
   notes always need vision for PDFs). Extracting now would
   over-abstract — keeping the two routers parallel is clearer.

3. **Schema added `source_blob_asset_id` (not just `source`)**. The
   brief mentions only the `source` discriminator. Adding the FK
   pointer felt necessary — without it, an edit to the markdown body
   erases the only link back to the original scan. The FK is
   `ON DELETE SET NULL` so blob deletion doesn't cascade-delete the
   note.

4. **Lint not run**. `npm run lint` errors with a Next 16 arg-passing
   issue (`Invalid project directory provided, no such directory:
   .../lint`). Not caused by this work — pre-existing toolchain
   quirk on `next lint` in this repo. CI will catch any real lint
   issues on push.

---

## 6. Open questions for Phase 7 W-Integrations

1. **PDF rasterization library**: prefer `pdfjs-dist` (already a
   transitive dep of `pdf-parse`) vs. `@napi-rs/canvas` (server-side
   image render)? Decide before tackling scanned-PDF support.

2. **Multi-image bulk upload**: out of scope this work unit. Should
   it be one modal that accepts a FileList and runs N OCR calls in
   parallel, or should we land an "import folder" flow that uses
   the queue?

3. **Re-OCR existing notes**: if a user uploads an unclear scan,
   accepts the markdown, then later wants to redo OCR — do we keep
   the original blob accessible from the note detail page and add a
   "re-extract" button? The `source_blob_asset_id` link makes this
   possible; UX TBD.

4. **Mobile-first capture flow**: an iOS share extension to send
   GoodNotes / Notability pages directly into Steadii would shorten
   the "scan → upload → extract" loop dramatically. Out of α scope
   per brief, but worth scoping as a Phase 8 candidate alongside
   the analytical-mistake flow.

5. **Phase 7 W-Integrations queue**: iCal subs + MS Outlook/To Do
   is the next work unit per the brief. Sparring should confirm
   the Outlook auth provider (next-auth Microsoft provider vs.
   raw MSAL).

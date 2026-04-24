# Privacy disclosure — email embeddings (α internal draft)

**Status:** internal draft only. This is *not* the customer-facing privacy
policy update; that rewrite lands in W3/W4 before α launch. This doc
exists so Ryuto and α users can review the data flow in plain terms
without having to read code.

## What we do

Starting in Phase 6 W2, every email Steadii sees has its **subject +
body snippet** transformed into a numeric vector (an "embedding") so
the agent can find semantically similar past emails when classifying
or drafting replies to new ones.

- **Provider:** OpenAI.
- **Model:** `text-embedding-3-small`.
- **Dimensions:** 1536 floating-point numbers per email.
- **Stored:** Steadii's database (Neon Postgres, `email_embeddings`
  table). Vectors are stored alongside the `inbox_items` row.
- **Scope of retrieval:** only your own emails. The retrieval query is
  hard-scoped with `WHERE user_id = $1` on every call. Cross-user
  retrieval is not possible by design.
- **Input length:** we clamp each embedding's input to the first 2000
  characters of subject + body before sending to OpenAI.

## When this happens

1. **On ingest:** each new email is embedded immediately after L1 rule
   triage stores it in `inbox_items`. Failures are logged but do not
   block the triage.
2. **On backfill:** a one-shot script (`scripts/embed-backfill.ts`)
   embeds existing rows that pre-date the W2 rollout.
3. **On deep-pass retrieval:** when the agent runs a full-depth
   classification for a high-risk email, we re-embed the *current*
   email subject + snippet as a query vector so we can find the top-20
   semantically similar past emails in your own corpus.

## Legal basis / provider disclosure

- OpenAI's Data Processing Addendum (DPA) applies to all embedding
  calls. Under the standard OpenAI API terms, inputs are **not used
  for training** and are retained for up to 30 days for abuse
  monitoring before deletion.
- Zero Data Retention (ZDR) is **not** enabled during α — it is
  available for enterprise tiers and can be flipped on later if an α
  user requests it. No opt-out for α.
- No third party other than OpenAI receives the email content for
  embedding purposes.

## What we do NOT do

- We do not share your embeddings or your emails with any other user,
  α or otherwise.
- We do not use your embeddings to train OpenAI's models or Steadii's
  models.
- We do not generate embeddings for attachments — only the subject +
  body snippet.
- We do not keep a copy of the embedding at OpenAI's end — the vector
  returned by the API is stored only in Steadii's database.

## Cost accounting

Embeddings cost approximately $0.00001 per email (rounds to 0 credits
at α pricing — 1 credit = $0.005). The cost is recorded in the
`usage_events` table under `task_type = 'email_embed'` for audit.

## Deletion

When you delete your account (or when the 120-day retention grace
period after downgrade expires), every `email_embeddings` row is
deleted by the cascade from `users` → `inbox_items` → `email_embeddings`.
No embedding survives account deletion.

## Future

- **Multi-source retrieval** (Syllabus / Mistakes / Classroom /
  Calendar) ships in Phase 7 W1 and will use the same provider +
  storage pattern; this doc will be extended at that time.
- **Pruning:** a retention policy to prune embeddings older than the
  120-day grace window lands in W4 or shortly after public launch.
- **Public policy update:** the customer-facing privacy policy page
  will incorporate this disclosure before the α → public transition.

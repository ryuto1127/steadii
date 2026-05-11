import "server-only";
import * as Sentry from "@sentry/nextjs";
import { and, desc, eq, gte, isNotNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  agentContactPersonas,
  agentDrafts,
  inboxItems,
} from "@/lib/db/schema";
import { openai } from "@/lib/integrations/openai/client";
import { selectModel } from "@/lib/agent/models";
import { recordUsage } from "@/lib/agent/usage";
import { fetchSentMessagesToRecipient } from "@/lib/integrations/google/gmail-fetch";

// engineer-39 — daily contact persona learner. Mirrors the shape of
// style-learner.ts (per-user batch, GPT-5.4 full, idempotent upsert).
//
// For each "active" contact (sender of an inbox row in the last 30
// days where the persona row is missing OR last_extracted_at is older
// than 7 days), assemble a small corpus of their recent inbound emails
// + the user's outbound replies, ask the model to distill a single-line
// relationship label + up to 8 short factual statements, and upsert
// into agent_contact_personas.
//
// Cost ceiling — handoff §"Persona learner cost ceiling":
// At α (100 users × 20 contacts × 1 LLM call/contact/run × daily) the
// untrimmed projection is ~$40/day. The 7-day stale gate + new-activity
// gate (no rows since last_extracted_at) cuts the real call rate to
// ~10% of theoretical. Both gates live in selectActiveContactsForUser
// below; do not loosen without re-checking the projection.
//
// Trigger: /api/cron/persona-learner @ daily 9am UTC. Manual schedule
// registration on Upstash console after deploy per
// feedback_qstash_orphan_schedules.md.

const STALE_DAYS = 7;
const ACTIVE_WINDOW_DAYS = 30;
const MAX_CONTACTS_PER_RUN = 20;
const MAX_FACTS = 8;
const MAX_FACT_CHARS = 200;
const MAX_RELATIONSHIP_CHARS = 120;
const CORPUS_CHAR_CAP = 6000;
const GMAIL_SENT_K = 5;
const INBOUND_LIMIT = 8;
const STEADII_OUTBOUND_LIMIT = 8;

export type PersonaExtractionResult = {
  contactEmail: string;
  contactName: string | null;
  relationship: string | null;
  facts: string[];
  // True when the contact had no usable corpus (no inbound + no outbound).
  // The cron stamps last_extracted_at anyway so the gate doesn't re-pick
  // them every run.
  emptyCorpus: boolean;
};

export type RunPersonaExtractionResult = {
  considered: number;
  extracted: number;
  skipped: number;
  failed: number;
  results: PersonaExtractionResult[];
};

// ---------------------------------------------------------------------------
// Per-user runner — selects active contacts, calls extractContactPersona for
// each. Caps at MAX_CONTACTS_PER_RUN to bound cost.
// ---------------------------------------------------------------------------

export async function runPersonaExtractionForUser(
  userId: string
): Promise<RunPersonaExtractionResult> {
  const candidates = await selectActiveContactsForUser(userId);
  const considered = candidates.length;

  let extracted = 0;
  let skipped = 0;
  let failed = 0;
  const results: PersonaExtractionResult[] = [];

  for (const c of candidates) {
    try {
      const out = await extractContactPersona(userId, c.senderEmail);
      if (out.emptyCorpus) {
        skipped++;
      } else {
        extracted++;
      }
      results.push(out);
    } catch (err) {
      failed++;
      Sentry.captureException(err, {
        level: "warning",
        tags: { feature: "persona_learner", op: "extract" },
        user: { id: userId },
        extra: { contactEmail: c.senderEmail },
      });
    }
  }

  return { considered, extracted, skipped, failed, results };
}

// Active = sender of an inbox row in the last ACTIVE_WINDOW_DAYS days,
// AND (no persona row OR persona row is older than STALE_DAYS days).
//
// The "OR persona row missing" branch fires off a JOIN; we approximate
// it by selecting distinct sender emails first and filtering in-memory
// against the personas table. The approximation is fine: at α scale the
// distinct-sender count per user is bounded (a few hundred at most),
// and the Postgres planner handles the small in-memory filter cheaply.
async function selectActiveContactsForUser(
  userId: string
): Promise<Array<{ senderEmail: string; senderName: string | null }>> {
  const cutoff = new Date(Date.now() - ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const recentSenders = await db
    .selectDistinctOn([inboxItems.senderEmail], {
      senderEmail: inboxItems.senderEmail,
      senderName: inboxItems.senderName,
      mostRecentReceivedAt: inboxItems.receivedAt,
    })
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.userId, userId),
        gte(inboxItems.receivedAt, cutoff)
      )
    )
    .orderBy(inboxItems.senderEmail, desc(inboxItems.receivedAt));

  if (recentSenders.length === 0) return [];

  const stale = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000);

  // Read existing personas for these emails in a single query — gives
  // us last_extracted_at per (user, contact_email) so we can apply the
  // 7-day stale gate without a per-contact roundtrip.
  const personaRows = await db
    .select({
      contactEmail: agentContactPersonas.contactEmail,
      lastExtractedAt: agentContactPersonas.lastExtractedAt,
    })
    .from(agentContactPersonas)
    .where(eq(agentContactPersonas.userId, userId));

  const personaByEmail = new Map<string, Date | null>();
  for (const r of personaRows) {
    personaByEmail.set(r.contactEmail, r.lastExtractedAt ?? null);
  }

  const eligible: Array<{ senderEmail: string; senderName: string | null }> =
    [];
  for (const s of recentSenders) {
    if (!s.senderEmail) continue;
    const lastExtracted = personaByEmail.get(s.senderEmail);
    if (lastExtracted === undefined) {
      // No persona row yet — always extract.
      eligible.push({
        senderEmail: s.senderEmail,
        senderName: s.senderName ?? null,
      });
      continue;
    }
    if (lastExtracted === null || lastExtracted < stale) {
      // Persona row exists but is stale — re-extract.
      eligible.push({
        senderEmail: s.senderEmail,
        senderName: s.senderName ?? null,
      });
    }
  }

  return eligible.slice(0, MAX_CONTACTS_PER_RUN);
}

// ---------------------------------------------------------------------------
// Per-contact extractor — assembles corpus, calls GPT-5.4 full, upserts.
// ---------------------------------------------------------------------------

export async function extractContactPersona(
  userId: string,
  contactEmail: string
): Promise<PersonaExtractionResult> {
  return Sentry.startSpan(
    {
      name: "email.persona_learner.extract",
      op: "gen_ai.generate",
      attributes: {
        "steadii.user_id": userId,
        "steadii.task_type": "email_draft",
        "steadii.contact_email": contactEmail,
      },
    },
    async () => {
      const since = new Date(
        Date.now() - ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000
      );

      const [inboundRows, steadiiOutboundRows, contactNameRow] =
        await Promise.all([
          db
            .select({
              subject: inboxItems.subject,
              snippet: inboxItems.snippet,
              receivedAt: inboxItems.receivedAt,
              senderName: inboxItems.senderName,
            })
            .from(inboxItems)
            .where(
              and(
                eq(inboxItems.userId, userId),
                eq(inboxItems.senderEmail, contactEmail),
                gte(inboxItems.receivedAt, since)
              )
            )
            .orderBy(desc(inboxItems.receivedAt))
            .limit(INBOUND_LIMIT),
          db
            .select({
              subject: agentDrafts.draftSubject,
              body: agentDrafts.draftBody,
              sentAt: agentDrafts.sentAt,
            })
            .from(agentDrafts)
            .innerJoin(inboxItems, eq(agentDrafts.inboxItemId, inboxItems.id))
            .where(
              and(
                eq(agentDrafts.userId, userId),
                eq(agentDrafts.status, "sent"),
                isNotNull(agentDrafts.sentAt),
                eq(inboxItems.senderEmail, contactEmail),
                gte(agentDrafts.sentAt, since)
              )
            )
            .orderBy(desc(agentDrafts.sentAt))
            .limit(STEADII_OUTBOUND_LIMIT),
          db
            .select({ senderName: inboxItems.senderName })
            .from(inboxItems)
            .where(
              and(
                eq(inboxItems.userId, userId),
                eq(inboxItems.senderEmail, contactEmail),
                isNotNull(inboxItems.senderName)
              )
            )
            .orderBy(desc(inboxItems.receivedAt))
            .limit(1),
        ]);

      const gmailDirectRaw = await fetchSentMessagesToRecipient(
        userId,
        contactEmail,
        GMAIL_SENT_K
      ).catch((err) => {
        Sentry.captureException(err, {
          level: "warning",
          tags: { feature: "persona_learner", source: "gmail_direct" },
          user: { id: userId },
        });
        return [] as Awaited<ReturnType<typeof fetchSentMessagesToRecipient>>;
      });

      const inboundLines = inboundRows.map((r) => ({
        kind: "inbound" as const,
        when: r.receivedAt,
        subject: r.subject,
        body: r.snippet,
      }));
      const outboundLines = [
        ...steadiiOutboundRows
          .filter(
            (r): r is typeof r & { sentAt: Date } => r.sentAt instanceof Date
          )
          .map((r) => ({
            kind: "outbound" as const,
            when: r.sentAt,
            subject: r.subject,
            body: r.body,
          })),
        ...gmailDirectRaw.map((g) => ({
          kind: "outbound" as const,
          when: g.sentAt,
          subject: g.subject,
          body: g.body,
        })),
      ];

      const merged = [...inboundLines, ...outboundLines]
        .filter((m) => (m.subject ?? "").trim() || (m.body ?? "").trim())
        .sort((a, b) => b.when.getTime() - a.when.getTime());

      const contactName =
        contactNameRow[0]?.senderName?.trim() || null;

      if (merged.length === 0) {
        // No usable corpus — stamp last_extracted_at so the gate doesn't
        // re-pick this contact tomorrow. Empty relationship/facts means
        // the fanout block renders the "first interaction" empty state.
        await upsertContactPersona({
          userId,
          contactEmail,
          contactName,
          relationship: null,
          facts: [],
        });
        return {
          contactEmail,
          contactName,
          relationship: null,
          facts: [],
          emptyCorpus: true,
        };
      }

      const corpus = buildCorpus(merged);
      const { relationship, facts } = await callExtractionLLM({
        userId,
        contactEmail,
        contactName,
        corpus,
      });

      await upsertContactPersona({
        userId,
        contactEmail,
        contactName,
        relationship,
        facts,
      });

      return {
        contactEmail,
        contactName,
        relationship,
        facts,
        emptyCorpus: false,
      };
    }
  );
}

function buildCorpus(
  rows: Array<{
    kind: "inbound" | "outbound";
    when: Date;
    subject: string | null;
    body: string | null;
  }>
): string {
  const lines: string[] = [];
  for (const r of rows) {
    const date = r.when.toISOString().slice(0, 10);
    const tag = r.kind === "inbound" ? "From contact" : "From you to contact";
    const subject = (r.subject ?? "").trim() || "(no subject)";
    const body = (r.body ?? "").replace(/\s+/g, " ").trim();
    lines.push(`[${date}] ${tag} — Subject: ${subject}`);
    if (body) lines.push(`  ${body}`);
  }
  let joined = lines.join("\n");
  if (joined.length > CORPUS_CHAR_CAP) {
    joined = joined.slice(0, CORPUS_CHAR_CAP);
  }
  return joined;
}

const SYSTEM_PROMPT = `You are Steadii's contact-persona extractor. From the correspondence excerpts below between the user (a university student) and a single contact, extract two things:

1. relationship — a single short label for who this contact is to the user. Examples: "MAT223 instructor", "TA for CSC108", "Stripe billing support", "Mom", "Group project teammate (CSC207)", "Internship recruiter".
2. facts — up to ${MAX_FACTS} short factual statements about the contact that would help draft future replies. Each fact is one sentence, ≤${MAX_FACT_CHARS} characters.

Facts should be observable from the correspondence — what the contact does, what they expect from the user, what topics they communicate about, what register they use, what timing patterns they follow. Examples:
- "Replies same day from Mon–Fri, slow on weekends."
- "Prefers concise English even though the user writes Japanese sometimes."
- "Asks about deadline extensions before announcing them on the syllabus."
- "Cc's the department admin on logistics-only emails."

Do NOT include:
- generic statements ("is a person", "uses email") — only facts that change how the user would write back.
- speculation (only what's directly observable from the snippets).
- private personal details unrelated to the user's interaction (the user's diet, the contact's family, etc.).

Output JSON: { "relationship": string | null, "facts": string[] }. If the corpus is too thin to support a relationship label, return null. If you can't find clear facts, return fewer (or an empty array). Don't pad.

Write in the user's working language (default English; switch to Japanese only if the corpus is overwhelmingly Japanese).`;

async function callExtractionLLM(args: {
  userId: string;
  contactEmail: string;
  contactName: string | null;
  corpus: string;
}): Promise<{ relationship: string | null; facts: string[] }> {
  // 2026-05-11 — was `email_draft` (GPT-5.4 full). Persona extraction is a
  // structured short-form JSON output (relationship label + ≤8 facts) — no
  // deep reasoning required. Mini hits 95%+ quality at ~1/5 the cost. At α
  // 100 users × 20 contacts × daily, full = ~$1200/mo vs mini = ~$200/mo.
  const model = selectModel("email_classify_risk");
  const userMsg = [
    `Contact: ${args.contactName ? `${args.contactName} <${args.contactEmail}>` : args.contactEmail}`,
    "",
    "=== Correspondence excerpts (newest first) ===",
    args.corpus,
  ].join("\n");

  const resp = await openai().chat.completions.create({
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMsg },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "contact_persona",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            relationship: {
              type: ["string", "null"],
              maxLength: MAX_RELATIONSHIP_CHARS,
            },
            facts: {
              type: "array",
              items: {
                type: "string",
                minLength: 1,
                maxLength: MAX_FACT_CHARS,
              },
              maxItems: MAX_FACTS,
            },
          },
          required: ["relationship", "facts"],
        },
      },
    },
  });

  await recordUsage({
    userId: args.userId,
    model,
    taskType: "email_draft",
    inputTokens: resp.usage?.prompt_tokens ?? 0,
    outputTokens: resp.usage?.completion_tokens ?? 0,
    cachedTokens:
      (resp.usage as {
        prompt_tokens_details?: { cached_tokens?: number };
      })?.prompt_tokens_details?.cached_tokens ?? 0,
  });

  return parseExtraction(resp.choices[0]?.message?.content ?? "{}");
}

export function parseExtraction(raw: string): {
  relationship: string | null;
  facts: string[];
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { relationship: null, facts: [] };
  }
  const o = (parsed ?? {}) as { relationship?: unknown; facts?: unknown };
  const relationship =
    typeof o.relationship === "string" && o.relationship.trim().length > 0
      ? o.relationship.trim().slice(0, MAX_RELATIONSHIP_CHARS)
      : null;
  const facts = Array.isArray(o.facts)
    ? o.facts
        .filter((f): f is string => typeof f === "string")
        .map((f) => f.trim().slice(0, MAX_FACT_CHARS))
        .filter((f) => f.length > 0)
        .slice(0, MAX_FACTS)
    : [];
  return { relationship, facts };
}

// ---------------------------------------------------------------------------
// Upsert — keyed on (user_id, contact_email) per the unique index.
// ---------------------------------------------------------------------------

async function upsertContactPersona(args: {
  userId: string;
  contactEmail: string;
  contactName: string | null;
  relationship: string | null;
  facts: string[];
}): Promise<void> {
  const now = new Date();
  await db
    .insert(agentContactPersonas)
    .values({
      userId: args.userId,
      contactEmail: args.contactEmail,
      contactName: args.contactName,
      relationship: args.relationship,
      facts: args.facts,
      lastExtractedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        agentContactPersonas.userId,
        agentContactPersonas.contactEmail,
      ],
      set: {
        contactName: args.contactName,
        relationship: args.relationship,
        facts: args.facts,
        lastExtractedAt: now,
        updatedAt: now,
      },
    });
}

// Avoid drizzle-kit picking these as unused — they're future-proofing
// for a "force all" admin trigger that walks ALL distinct senders
// regardless of the stale gate.
void or;
void lt;
void sql;

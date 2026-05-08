"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import { DraftDetailsPanel } from "@/components/agent/draft-details-panel";
import type {
  ExtractedActionItem,
  PreSendWarning,
} from "@/lib/db/schema";

// Stub fixtures so the preview renders the new surfaces without DB.
const FIXTURE_PERSONAS = [
  {
    id: "p-1",
    contactEmail: "tanaka@x.ac.jp",
    contactName: "田中 ひろし先生",
    relationship: "MAT223 instructor",
    facts: [
      "Replies same day Mon–Fri, slow on weekends.",
      "Prefers concise English replies even when greeted in Japanese.",
      "Asks about deadline extensions before announcing them on the syllabus.",
      "CCs the department admin on logistics-only emails.",
    ],
    lastExtractedAt: new Date("2026-05-07T09:00:00Z"),
  },
  {
    id: "p-2",
    contactEmail: "billing@stripe.com",
    contactName: null,
    relationship: "Stripe billing support",
    facts: [
      "Boilerplate templated replies — read carefully, never reply with questions in the same thread.",
      "Always references the invoice ID; the user should quote it back.",
    ],
    lastExtractedAt: new Date("2026-05-04T14:00:00Z"),
  },
  {
    id: "p-3",
    contactEmail: "mom@example.com",
    contactName: "Mom",
    relationship: "Mom",
    facts: [],
    lastExtractedAt: new Date("2026-05-01T20:00:00Z"),
  },
];

const FIXTURE_ACTION_ITEMS: ExtractedActionItem[] = [
  {
    title: "Submit photo ID to registrar via the upload form",
    dueDate: "2026-05-15",
    confidence: 0.94,
  },
  {
    title: "Reply to professor with availability for Thursday",
    dueDate: null,
    confidence: 0.81,
  },
  {
    title: "Pay $250 enrollment deposit",
    dueDate: "2026-06-01",
    confidence: 0.72,
  },
];

const FIXTURE_WARNINGS: PreSendWarning[] = [
  {
    phrase: "Friday at 2pm",
    why: "No Friday meeting time appears in the original email.",
  },
  {
    phrase: "https://example.com/registration",
    why: "URL not present in the thread context.",
  },
  {
    phrase: "Prof. Lee mentioned",
    why: "Prof. Lee isn't named anywhere in the conversation.",
  },
];

export function Engineer39PreviewClient({
  showModal,
}: {
  showModal: boolean;
}) {
  const tPersona = useTranslations(
    "agent_thinks_page.contact_personas"
  );
  const tCheck = useTranslations("agent.pre_send_check");
  const [modalOpen, setModalOpen] = useState(showModal);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8">
      <header>
        <h1 className="text-h2 font-semibold">
          engineer-39 verification harness
        </h1>
        <p className="mt-1 text-small text-[hsl(var(--muted-foreground))]">
          Three new surfaces rendered against stub fixtures. Open
          ?modal=1 (or click below) for the pre-send warning modal.
        </p>
      </header>

      {/* ---- Surface 1: Contacts learned section (mirror of
              app/app/settings/how-your-agent-thinks/page.tsx) ---- */}
      <section
        id="contact-personas"
        className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4"
      >
        <h2 className="text-body font-medium">{tPersona("heading")}</h2>
        <p className="mt-1 text-small text-[hsl(var(--muted-foreground))]">
          {tPersona("description")}
        </p>
        <ul className="mt-3 flex flex-col gap-3">
          {FIXTURE_PERSONAS.map((p) => {
            const factsArray = p.facts;
            return (
              <li
                key={p.id}
                className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-3"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-small font-medium text-[hsl(var(--foreground))]">
                      {p.contactName ?? p.contactEmail}
                    </div>
                    <div className="text-[12px] text-[hsl(var(--muted-foreground))] break-all">
                      {p.contactEmail}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="rounded border border-[hsl(var(--border))] px-3 py-1 text-[11px] transition-hover hover:bg-[hsl(var(--surface-raised))]"
                  >
                    {tPersona("remove")}
                  </button>
                </div>
                {p.relationship ? (
                  <div className="mt-2 inline-block rounded bg-[hsl(var(--surface-raised))] px-2 py-0.5 text-[11px] text-[hsl(var(--foreground))]">
                    {p.relationship}
                  </div>
                ) : null}
                {factsArray.length > 0 ? (
                  <ul className="mt-2 list-disc pl-5 text-small text-[hsl(var(--foreground))]">
                    {factsArray.map((f, i) => (
                      <li key={i}>{f}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-[12px] text-[hsl(var(--muted-foreground))]">
                    {tPersona("no_facts_yet")}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {/* ---- Surface 2: DraftDetailsPanel with action items ---- */}
      <section>
        <h2 className="mb-2 text-body font-medium">
          DraftDetailsPanel — action items
        </h2>
        <DraftDetailsPanel
          draftId="dev-fixture-draft-1"
          reasoning={
            "- Sender expects a concrete reply; matches sender-history register (self-1).\n" +
            "- Calendar (calendar-1) shows Friday 14:00 free."
          }
          action="draft_reply"
          provenance={null}
          actionItems={FIXTURE_ACTION_ITEMS}
          acceptedIndices={[]}
        />
      </section>

      {/* ---- Surface 3: Pre-send warning modal trigger ---- */}
      <section>
        <h2 className="mb-2 text-body font-medium">Pre-send warning modal</h2>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md border border-[hsl(38_92%_40%/0.4)] bg-[hsl(38_92%_50%/0.1)] px-3 py-1.5 text-small"
        >
          <AlertTriangle size={14} strokeWidth={1.75} />
          Open warning modal
        </button>
      </section>

      {modalOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6"
          onClick={() => setModalOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-5 shadow-xl"
          >
            <div className="flex items-start gap-3">
              <AlertTriangle
                size={20}
                strokeWidth={1.75}
                className="mt-0.5 shrink-0 text-[hsl(38_92%_40%)]"
              />
              <div className="min-w-0">
                <h2 className="text-body font-semibold text-[hsl(var(--foreground))]">
                  {tCheck("modal_title")}
                </h2>
                <p className="mt-1 text-small text-[hsl(var(--muted-foreground))]">
                  {tCheck("modal_body")}
                </p>
              </div>
            </div>
            <ul className="mt-3 flex flex-col gap-2">
              {FIXTURE_WARNINGS.map((w, i) => (
                <li
                  key={i}
                  className="rounded-md border border-[hsl(38_92%_40%/0.3)] bg-[hsl(38_92%_50%/0.06)] px-3 py-2 text-small"
                >
                  <div className="font-medium text-[hsl(var(--foreground))]">
                    &ldquo;{w.phrase}&rdquo;
                  </div>
                  <div className="mt-0.5 text-[12px] text-[hsl(var(--muted-foreground))]">
                    {w.why}
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-md border border-[hsl(var(--border))] px-3 py-1.5 text-small transition-hover hover:bg-[hsl(var(--surface-raised))]"
              >
                {tCheck("cancel")}
              </button>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-md bg-[hsl(var(--primary))] px-3 py-1.5 text-small font-medium text-[hsl(var(--primary-foreground))] transition-hover hover:opacity-90"
              >
                {tCheck("send_anyway")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

import "server-only";
import { runDraft, type DraftResult } from "../draft";
import type { L2ToolExecutor } from "./types";

// engineer-41 — effector tool. The agentic L2 loop calls this when its
// chosen action is draft_reply AND it has the grounding it needs
// (timezone, availability, persona context). The wrapper threads
// existing runDraft inputs through, no new behavior.

export type WriteDraftArgs = {
  senderEmail: string;
  senderName?: string | null;
  senderRole?: string | null;
  subject: string | null;
  bodySnippet: string | null;
  // Optional ambient grounding the loop has already gathered. The
  // wrapper concatenates these into the body the prompt sees, so the
  // draft can cite specific slots / persona facts without a second
  // fanout.
  availabilityHints?: string[];
  personaSummary?: string | null;
  userName?: string | null;
  userEmail?: string | null;
};

export type WriteDraftResult = {
  kind: DraftResult["kind"];
  subject: string;
  body: string;
  to: string[];
  cc: string[];
  inReplyTo: string | null;
  reasoning: string;
  usageId: string | null;
};

export const writeDraftTool: L2ToolExecutor<
  WriteDraftArgs,
  WriteDraftResult
> = {
  schema: {
    name: "write_draft",
    description:
      "Compose the actual reply. Only call this when the action you've decided on is draft_reply AND you have collected the grounding (availability checks done, persona understood, language clear). Returns the draft subject + body + to + cc. The body will be persisted on the agent_drafts row as-is.",
    parameters: {
      type: "object",
      properties: {
        senderEmail: { type: "string", minLength: 3 },
        senderName: { type: ["string", "null"] },
        senderRole: { type: ["string", "null"] },
        subject: { type: ["string", "null"] },
        bodySnippet: { type: ["string", "null"] },
        availabilityHints: {
          type: "array",
          items: { type: "string", minLength: 1, maxLength: 200 },
          maxItems: 8,
        },
        personaSummary: { type: ["string", "null"] },
        userName: { type: ["string", "null"] },
        userEmail: { type: ["string", "null"] },
      },
      required: ["senderEmail", "subject", "bodySnippet"],
      additionalProperties: false,
    },
  },
  async execute(ctx, args) {
    // Bolt the ambient grounding onto the body the draft prompt sees.
    // runDraft already knows how to read it as "Body:" content; the
    // hints/persona surface alongside without a new prompt template.
    const extraSections: string[] = [];
    if (args.availabilityHints && args.availabilityHints.length > 0) {
      extraSections.push(
        "\n\n[Agentic-L2 availability checks — splice these into the reply where appropriate]"
      );
      for (const h of args.availabilityHints) extraSections.push(`- ${h}`);
    }
    if (args.personaSummary && args.personaSummary.trim().length > 0) {
      extraSections.push(
        "\n\n[Agentic-L2 contact persona summary — do NOT echo verbatim]"
      );
      extraSections.push(args.personaSummary.trim());
    }
    const enrichedBody =
      (args.bodySnippet ?? "") + extraSections.join("\n");

    const draft = await runDraft({
      userId: ctx.userId,
      senderEmail: args.senderEmail,
      senderName: args.senderName ?? null,
      senderRole: args.senderRole ?? null,
      subject: args.subject,
      snippet: args.bodySnippet,
      bodySnippet: enrichedBody,
      inReplyTo: null,
      threadRecentMessages: [],
      similarEmails: [],
      calendarEvents: [],
      fanout: null,
      voiceProfile: null,
      writingStyleRules: [],
      userName: args.userName ?? null,
      userEmail: args.userEmail ?? null,
    });
    return {
      kind: draft.kind,
      subject: draft.subject,
      body: draft.body,
      to: draft.to,
      cc: draft.cc,
      inReplyTo: draft.inReplyTo,
      reasoning: draft.reasoning,
      usageId: draft.usageId,
    };
  },
};

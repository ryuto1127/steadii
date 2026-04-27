import "server-only";
import { db } from "@/lib/db/client";
import {
  chats,
  messages as messagesTable,
  type ActionOption,
  type AgentProposalRow,
} from "@/lib/db/schema";

// Maps a proactive ActionOption → side-effect.
//
// Most actions don't actually mutate Google services from this server
// path; they prepare a follow-up surface (chat seeded with context,
// task draft, email draft) so the user lands in the existing
// confirmation flow. The narrow exception is `dismiss`, which the
// dedicated /dismiss route handles before this executor sees it.
//
// Returning `redirectTo` tells the UI where to send the user after
// the resolve POST returns 200 — used by chat_followup.

export type ActionExecutionResult = {
  redirectTo?: string;
};

export async function executeProactiveAction(args: {
  userId: string;
  option: ActionOption;
  proposal: AgentProposalRow;
}): Promise<ActionExecutionResult> {
  const { option, userId, proposal } = args;

  switch (option.tool) {
    case "chat_followup":
      return await spawnFollowupChat(userId, option, proposal);
    case "email_professor":
    case "reschedule_event":
    case "delete_event":
    case "create_task":
    case "add_mistake_note":
    case "link_existing":
    case "add_anyway":
      // PR 3 lands the resolution-tracking + feedback loop. Wiring
      // these into the existing tool executors (Gmail send, Calendar
      // patch, etc.) lives in PR 4 next to the chat-aware suggestion
      // surface — same routing, same confirmation flow. For now:
      // mark resolved and surface a chat_followup-style breadcrumb
      // so the user can finish via the chat tool.
      return await spawnFollowupChat(userId, option, proposal);
    case "auto":
      // D11 informational entry — viewing IS the resolution.
      return {};
    case "dismiss":
      // Handled by /dismiss route. Should never reach here.
      return {};
  }
}

// Open a chat seeded with the proposal context. The user can iterate
// on the suggestion (e.g., have the agent draft the email or move the
// event) using the existing chat tools, all of which honor the
// confirmation flow per D5.
async function spawnFollowupChat(
  userId: string,
  option: ActionOption,
  proposal: AgentProposalRow
): Promise<ActionExecutionResult> {
  const seed =
    typeof option.payload?.seedMessage === "string"
      ? (option.payload.seedMessage as string)
      : `Steadii noticed: ${proposal.issueSummary}\n\n${proposal.reasoning}\n\nNext step: ${option.label}`;

  const [chatRow] = await db
    .insert(chats)
    .values({
      userId,
      title: proposal.issueSummary.slice(0, 80),
    })
    .returning({ id: chats.id });

  await db.insert(messagesTable).values({
    chatId: chatRow.id,
    role: "user",
    content: seed,
  });

  return { redirectTo: `/app/chat/${chatRow.id}` };
}

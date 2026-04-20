import "server-only";
import { db } from "@/lib/db/client";
import { usageEvents } from "@/lib/db/schema";
import {
  estimateUsdCost,
  usdToCredits,
  type OpenAIModel,
  type TaskType,
} from "./models";

export type UsageRecord = {
  userId: string;
  chatId?: string | null;
  messageId?: string | null;
  model: OpenAIModel;
  taskType: TaskType;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
};

export async function recordUsage(r: UsageRecord) {
  const usd = estimateUsdCost(r.model, {
    input: r.inputTokens,
    output: r.outputTokens,
    cached: r.cachedTokens,
  });
  const credits = usdToCredits(usd);
  await db.insert(usageEvents).values({
    userId: r.userId,
    chatId: r.chatId ?? null,
    messageId: r.messageId ?? null,
    model: r.model,
    taskType: r.taskType,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    cachedTokens: r.cachedTokens,
    creditsUsed: credits,
  });
  return { usd, credits };
}

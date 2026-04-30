import "server-only";
import * as Sentry from "@sentry/nextjs";
import { db } from "@/lib/db/client";
import { usageEvents } from "@/lib/db/schema";
import {
  estimateUsdCost,
  taskTypeMetersCredits,
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

// usage_events writes are auxiliary analytics. The OpenAI call has already
// completed (and incurred cost) by the time we get here; if Neon serverless
// hiccups (transient `fetch failed`, cold start, brief disconnect) we must
// not drop the caller's actual work. One retry catches the common transient
// blip; persistent failure degrades to a logged warning + null usageId so
// the caller can still return a usable result. See Sentry incident
// 2026-04-30 ("NeonDbError: fetch failed" during proactive_proposal log).
const USAGE_INSERT_RETRY_DELAY_MS = 200;

export async function recordUsage(r: UsageRecord) {
  const usd = estimateUsdCost(r.model, {
    input: r.inputTokens,
    output: r.outputTokens,
    cached: r.cachedTokens,
  });
  // Always log tokens for analytics. Only charge the credit pool for tasks
  // that meter — chat/tool_call/meta tasks are tracked at 0 credits here
  // and gated instead by the per-plan chat rate limiter.
  const credits = taskTypeMetersCredits(r.taskType) ? usdToCredits(usd) : 0;

  const values = {
    userId: r.userId,
    chatId: r.chatId ?? null,
    messageId: r.messageId ?? null,
    model: r.model,
    taskType: r.taskType,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    cachedTokens: r.cachedTokens,
    creditsUsed: credits,
  };

  let firstErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const [inserted] = await db
        .insert(usageEvents)
        .values(values)
        .returning({ id: usageEvents.id });
      return { usd, credits, usageId: inserted?.id ?? null };
    } catch (err) {
      if (attempt === 0) {
        firstErr = err;
        await new Promise((resolve) =>
          setTimeout(resolve, USAGE_INSERT_RETRY_DELAY_MS)
        );
        continue;
      }
      // Persistent failure — log as warning (not error) so the caller's
      // already-completed LLM work is not dropped. analytics row is lost.
      Sentry.captureException(err, {
        level: "warning",
        tags: {
          context: "usage_log_failed",
          task_type: r.taskType,
          model: r.model,
        },
        extra: { firstError: firstErr },
      });
      return { usd, credits, usageId: null };
    }
  }
  // Unreachable — for-loop above always returns or throws.
  return { usd, credits, usageId: null };
}

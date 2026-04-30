import "server-only";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { auditLog } from "@/lib/db/schema";
import {
  IcalSubscribeError,
  subscribeToIcal,
} from "@/lib/integrations/ical/subscribe";
import type { ToolExecutor } from "./types";

const subscribeArgs = z.object({
  url: z.string().min(1),
  label: z.string().max(120).optional().nullable(),
});

export type IcalSubscribeResult =
  | {
      ok: true;
      subscriptionId: string;
      label: string | null;
      alreadySubscribed: boolean;
      eventsImported: number;
      status: "synced" | "not_modified" | "deactivated" | "failed";
    }
  | {
      ok: false;
      error: string;
      code: "INVALID_URL" | "BLOCKED_URL" | "FETCH_FAILED" | "PARSE_FAILED";
    };

export const icalSubscribe: ToolExecutor<
  z.infer<typeof subscribeArgs>,
  IcalSubscribeResult
> = {
  schema: {
    name: "ical_subscribe",
    description:
      "Subscribe to an iCal / `.ics` / `webcal://` calendar feed (school timetable, holiday calendar, sports schedule, etc.) and run a first sync immediately. Use this whenever the user pastes an iCal URL in chat or asks Steadii to subscribe to a feed — DO NOT tell them to navigate to Settings → Connections. The tool validates the URL (SSRF guard, http/https only), inserts the subscription, and triggers an inline sync so the user sees imported events on their next calendar render. Idempotent: if the user already has the same URL subscribed, returns the existing subscription with a fresh sync outcome instead of duplicating. Pass `label` if the user gave the feed a friendly name; otherwise omit and the URL itself is the identity.",
    mutability: "write",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description:
            "The iCal URL (`webcal://`, `https://`, or `http://`). Will be normalised to https:// for storage.",
        },
        label: {
          type: ["string", "null"],
          description: "Friendly label for the subscription (optional).",
        },
      },
      required: ["url"],
      additionalProperties: false,
    },
  },
  async execute(ctx, rawArgs) {
    const args = subscribeArgs.parse(rawArgs);
    try {
      const result = await subscribeToIcal({
        userId: ctx.userId,
        rawUrl: args.url,
        label: args.label ?? null,
      });
      const eventsImported =
        result.syncOutcome.status === "synced"
          ? result.syncOutcome.eventsUpserted
          : 0;
      await db.insert(auditLog).values({
        userId: ctx.userId,
        action: "ical.subscribe",
        toolName: "ical_subscribe",
        resourceType: "ical_subscription",
        resourceId: result.subscription.id,
        result:
          result.syncOutcome.status === "failed" ||
          result.syncOutcome.status === "deactivated"
            ? "failure"
            : "success",
        detail: {
          alreadySubscribed: result.alreadyExisted,
          syncStatus: result.syncOutcome.status,
          eventsImported,
        },
      });
      return {
        ok: true,
        subscriptionId: result.subscription.id,
        label: result.subscription.label,
        alreadySubscribed: result.alreadyExisted,
        eventsImported,
        status: result.syncOutcome.status,
      };
    } catch (err) {
      if (err instanceof IcalSubscribeError) {
        await db.insert(auditLog).values({
          userId: ctx.userId,
          action: "ical.subscribe",
          toolName: "ical_subscribe",
          resourceType: "ical_subscription",
          result: "failure",
          detail: { code: err.code, message: err.message },
        });
        return { ok: false, error: err.message, code: err.code };
      }
      const message = err instanceof Error ? err.message : String(err);
      await db.insert(auditLog).values({
        userId: ctx.userId,
        action: "ical.subscribe",
        toolName: "ical_subscribe",
        resourceType: "ical_subscription",
        result: "failure",
        detail: { code: "FETCH_FAILED", message },
      });
      return { ok: false, error: message, code: "FETCH_FAILED" };
    }
  },
};

export const ICAL_TOOLS = [icalSubscribe];

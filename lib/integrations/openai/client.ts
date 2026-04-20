import "server-only";
import OpenAI from "openai";
import { env } from "@/lib/env";

let cached: OpenAI | null = null;

export function openai(): OpenAI {
  if (!cached) {
    cached = new OpenAI({
      apiKey: env().OPENAI_API_KEY,
      timeout: 60_000,
      maxRetries: 2,
    });
  }
  return cached;
}

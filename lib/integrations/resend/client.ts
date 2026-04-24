import "server-only";
import { Resend } from "resend";
import { env } from "@/lib/env";

// Cached singleton — the Resend SDK is thin so a simple memoized factory is
// enough. Callers that need to mock should `vi.mock('@/lib/integrations/resend/client')`.
let cached: Resend | null = null;

export class ResendNotConfiguredError extends Error {
  code = "RESEND_NOT_CONFIGURED" as const;
  constructor() {
    super("RESEND_API_KEY is not set.");
  }
}

export function resend(): Resend {
  if (cached) return cached;
  const e = env();
  if (!e.RESEND_API_KEY) throw new ResendNotConfiguredError();
  cached = new Resend(e.RESEND_API_KEY);
  return cached;
}

export function getFromEmail(): string {
  const e = env();
  return e.RESEND_FROM_EMAIL || "agent@mysteadii.xyz";
}

// Formatted "Steadii Agent <agent@mysteadii.xyz>" — memory locks the
// from-name so the user always sees it's the agent, never a human.
export function getFromAddress(): string {
  return `Steadii Agent <${getFromEmail()}>`;
}

import "server-only";
import { Receiver } from "@upstash/qstash";

// Upstash QStash publishes scheduled cron messages to our /api/cron/* routes
// with an `Upstash-Signature` header. We verify it here so anyone hitting
// the URL directly without a valid signature gets 401. Two keys are accepted
// to support seamless rotation (current + next) — Upstash auto-rotates on
// their side.
//
// Dev convenience: when neither signing key is set AND we're not in
// production, verification is skipped so `pnpm dev` can hit the routes
// without the QStash machinery. NEVER trust this bypass in production —
// the key check below requires `NODE_ENV !== "production"` AND empty keys,
// so a misconfigured prod env can't accidentally open the endpoints.
export async function verifyQStashSignature(
  req: Request,
  rawBody: string
): Promise<boolean> {
  const current = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const next = process.env.QSTASH_NEXT_SIGNING_KEY;

  if (!current && !next) {
    if (process.env.NODE_ENV !== "production") {
      return true;
    }
    return false;
  }

  const signature = req.headers.get("upstash-signature");
  if (!signature) return false;

  try {
    const receiver = new Receiver({
      currentSigningKey: current ?? "",
      nextSigningKey: next ?? "",
    });
    await receiver.verify({ signature, body: rawBody });
    return true;
  } catch {
    return false;
  }
}

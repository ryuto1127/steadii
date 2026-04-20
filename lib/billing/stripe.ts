import "server-only";
import Stripe from "stripe";
import { env } from "@/lib/env";

let cached: Stripe | null = null;

export function stripe(): Stripe {
  if (!cached) {
    cached = new Stripe(env().STRIPE_SECRET_KEY, {
      // Stripe's SDK pins a default apiVersion; omit to use the library's
      // bundled value, which matches its TypeScript types.
    });
  }
  return cached;
}

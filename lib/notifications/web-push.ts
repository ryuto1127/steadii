import "server-only";

// Wave 2 web-push placeholder. The handoff doc allows shipping an
// email-only fallback if push wiring blows scope; the actual service
// worker / push subscription flow lands in Wave 3 once we're sure the
// notification tier matrix is what users want. Keeping the contract
// here so call sites can flip from `isWebPushEnabled() === false`
// (current state — emits no push, the daily digest is the only
// channel) to `true` without a structural rewrite.
//
// Flag source: `STEADII_WEB_PUSH_ENABLED` env var. Defaulting to false
// means production stays on the existing email digest channel until
// the wiring is verified end-to-end.

export function isWebPushEnabled(): boolean {
  return process.env.STEADII_WEB_PUSH_ENABLED === "true";
}

export function isWebPushSupportedClient(): boolean {
  if (typeof window === "undefined") return false;
  return "Notification" in window && "serviceWorker" in navigator;
}

// Call site for "first queue item landed". For Wave 2 this is a no-op
// when the flag is off; the daily digest cron picks up the new item
// anyway. When the flag is on (Wave 3+), this will fan out a web-push
// payload via the registered subscription.
export async function notifyFirstQueueItem(_userId: string): Promise<void> {
  if (!isWebPushEnabled()) {
    // Email-only path — the existing 7am digest covers the user within
    // the 24h promise from the Step 3 commitment screen.
    return;
  }
  // TODO(wave-3): dispatch through the web-push subscription stored on
  // the user. Schema columns + push_subscriptions table arrive with
  // the Wave 3 hardening pass.
}

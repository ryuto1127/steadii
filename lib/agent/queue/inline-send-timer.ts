// Client-side 10s send-undo timer for queue Draft cards (PR 2).
//
// The queue card surfaces a primary 送信 CTA that does not send
// immediately — it kicks a 10-second client timer with an inline 取り消し
// affordance. If the user clicks 取り消し within 10s, the send is dropped
// before any server work happens. If the timer elapses without an undo,
// the actual server send action fires.
//
// Why client-side (vs. piggybacking the existing QStash-backed server
// undo on /app/inbox/<id>): the queue card is a high-velocity surface;
// the user can fire-and-forget across multiple cards in a single sitting
// and a server round-trip per click would muddy the optimistic feel.
// Trade-off: closing the browser within the 10s window cancels the send
// (the timer dies with the page). Acceptable for α — explicit user
// click + 10s of attention is the contract, not "background commit
// after I close the tab".
//
// This module is intentionally DOM-free so it tests cleanly under
// vitest's node environment. The React wrapper in queue-list.tsx owns
// the toast UI + router refresh; this module owns ONLY the timer state
// and the start/cancel/elapse transitions.

export type TimerStatus = "pending" | "cancelled" | "elapsed";

export type InlineSendTimer = {
  // Token returned to callers so they can later cancel the timer.
  // Opaque string keyed on the card id + a monotonic counter so two
  // back-to-back clicks on the same card produce distinct tokens (the
  // user's second click means "I cancelled and clicked Send again").
  token: string;
  // Returns the current timer state — pending, cancelled, or elapsed.
  // Cheap; safe to call from a render path.
  status: () => TimerStatus;
  // Cancels the pending send. No-op if the timer already elapsed or was
  // previously cancelled. Returns true when the cancel actually
  // dropped a pending send; false otherwise.
  cancel: () => boolean;
};

export type InlineSendDeps = {
  // Underlying timer primitives — injected so tests can swap in
  // vi.useFakeTimers without monkey-patching globals.
  setTimeout: (cb: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

export const SEND_UNDO_WINDOW_MS = 10_000;

let monotonicCounter = 0;

// Start a single send timer. When `windowMs` elapses without cancel(),
// `onElapse` fires (which is what actually calls the send API). When
// cancel() is called first, `onElapse` never fires. Either way, status
// becomes terminal (`elapsed` or `cancelled`) and further cancels are
// no-ops.
export function startInlineSendTimer(args: {
  cardId: string;
  windowMs?: number;
  onElapse: () => void;
  deps?: InlineSendDeps;
}): InlineSendTimer {
  const windowMs = args.windowMs ?? SEND_UNDO_WINDOW_MS;
  const deps: InlineSendDeps = args.deps ?? {
    setTimeout: (cb, ms) => globalThis.setTimeout(cb, ms),
    clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
  };

  monotonicCounter += 1;
  const token = `${args.cardId}:${monotonicCounter}`;
  let state: TimerStatus = "pending";

  const handle = deps.setTimeout(() => {
    // If cancelled in the same tick the timer fires, the cancel wins —
    // but in practice the clearTimeout path means the callback never
    // runs. The guard here is defense-in-depth for hosts where
    // clearTimeout is a no-op race-wise.
    if (state !== "pending") return;
    state = "elapsed";
    args.onElapse();
  }, windowMs);

  return {
    token,
    status: () => state,
    cancel: () => {
      if (state !== "pending") return false;
      state = "cancelled";
      deps.clearTimeout(handle);
      return true;
    },
  };
}

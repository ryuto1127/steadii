import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SEND_UNDO_WINDOW_MS,
  startInlineSendTimer,
} from "@/lib/agent/queue/inline-send-timer";

// PR 2 — verifies the client-side 10s send-undo timer machine used by
// the queue Draft cards on /app. The machine is DOM-free so we drive
// it with vitest's fake timers; the visual side (sonner toast, card
// dim) is wired in queue-list.tsx and not exercised here.

describe("startInlineSendTimer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires onElapse after the default 10s window", () => {
    const onElapse = vi.fn();
    const timer = startInlineSendTimer({ cardId: "draft:card-1", onElapse });
    expect(timer.status()).toBe("pending");

    vi.advanceTimersByTime(SEND_UNDO_WINDOW_MS - 1);
    expect(onElapse).not.toHaveBeenCalled();
    expect(timer.status()).toBe("pending");

    vi.advanceTimersByTime(1);
    expect(onElapse).toHaveBeenCalledTimes(1);
    expect(timer.status()).toBe("elapsed");
  });

  it("cancel() before elapsed prevents onElapse and flips status to cancelled", () => {
    const onElapse = vi.fn();
    const timer = startInlineSendTimer({ cardId: "draft:card-2", onElapse });

    vi.advanceTimersByTime(SEND_UNDO_WINDOW_MS - 1);
    const cancelled = timer.cancel();
    expect(cancelled).toBe(true);
    expect(timer.status()).toBe("cancelled");

    // Advance well past the original window — onElapse must NOT fire.
    vi.advanceTimersByTime(SEND_UNDO_WINDOW_MS * 2);
    expect(onElapse).not.toHaveBeenCalled();
  });

  it("double-cancel is a no-op (returns false on the second call)", () => {
    const onElapse = vi.fn();
    const timer = startInlineSendTimer({ cardId: "draft:card-3", onElapse });
    expect(timer.cancel()).toBe(true);
    expect(timer.cancel()).toBe(false);
    expect(timer.status()).toBe("cancelled");
  });

  it("cancel() after elapsed is a no-op (status stays elapsed)", () => {
    const onElapse = vi.fn();
    const timer = startInlineSendTimer({ cardId: "draft:card-4", onElapse });

    vi.advanceTimersByTime(SEND_UNDO_WINDOW_MS);
    expect(timer.status()).toBe("elapsed");

    expect(timer.cancel()).toBe(false);
    expect(timer.status()).toBe("elapsed");
  });

  it("honors a custom windowMs (used by tests + dev-preview tooling)", () => {
    const onElapse = vi.fn();
    const timer = startInlineSendTimer({
      cardId: "draft:card-5",
      windowMs: 250,
      onElapse,
    });

    vi.advanceTimersByTime(249);
    expect(onElapse).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onElapse).toHaveBeenCalledTimes(1);
    expect(timer.status()).toBe("elapsed");
  });

  it("issues a unique token per timer so back-to-back clicks distinguish", () => {
    const onElapse = vi.fn();
    const a = startInlineSendTimer({ cardId: "draft:same", onElapse });
    a.cancel();
    const b = startInlineSendTimer({ cardId: "draft:same", onElapse });
    expect(a.token).not.toBe(b.token);
    expect(a.token.startsWith("draft:same:")).toBe(true);
    expect(b.token.startsWith("draft:same:")).toBe(true);
  });

  it("uses injected deps for setTimeout / clearTimeout when supplied", () => {
    const fakeHandle = { isFake: true };
    const setTimeoutSpy = vi.fn().mockReturnValue(fakeHandle);
    const clearTimeoutSpy = vi.fn();
    const onElapse = vi.fn();

    const timer = startInlineSendTimer({
      cardId: "draft:card-6",
      onElapse,
      deps: {
        setTimeout: setTimeoutSpy,
        clearTimeout: clearTimeoutSpy,
      },
    });
    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    expect(setTimeoutSpy).toHaveBeenCalledWith(
      expect.any(Function),
      SEND_UNDO_WINDOW_MS
    );

    timer.cancel();
    expect(clearTimeoutSpy).toHaveBeenCalledWith(fakeHandle);
  });
});

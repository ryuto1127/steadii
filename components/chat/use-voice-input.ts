"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type VoiceState = "idle" | "listening" | "processing";
export type VoiceTriggerKey = "caps_lock" | "alt_right";
export type VoiceErrorKind =
  | "mic_denied"
  | "transcribe_failed"
  | "cleanup_failed"
  | "rate_limited"
  | "too_short";

const FALLBACK_STORAGE_KEY = "steadii.voice.fallback_alt_right";
const HINT_USES_KEY = "steadii.voice.hint_uses";
const HINT_USES_HIDE_AT = 3;
const HINT_REENGAGE_AFTER_DAYS = 7;
const HINT_LAST_USE_KEY = "steadii.voice.last_use_at";

// If a Caps Lock keydown is followed by keyup within this many ms on the
// VERY FIRST attempt, the browser is treating Caps Lock as a toggle (no
// hold semantics). We persist a fallback-to-Right-Option flag so the user
// gets a working trigger from then on. Generous threshold to avoid false
// positives — a real "I tapped briefly" press easily exceeds 80ms.
const CAPS_LOCK_HOLD_PROBE_MS = 80;
const RECORDING_MIN_MS = 500;
const RECORDING_MAX_MS = 60_000;
// Two-option chooser auto-dismiss window. After this long, the chooser
// quietly resolves to "full" — equivalent to clicking Send full. Kept short
// enough that an inattentive user gets the long version (the safer default
// — they can always edit) without leaving the chooser hanging.
const PENDING_CHOICE_AUTO_DISMISS_MS = 8_000;

export type VoicePendingChoice = {
  cleaned: string;
  shortened: string;
};
export type VoiceChoiceKind = "full" | "short";

export function useVoiceInput(args: {
  triggerKey: VoiceTriggerKey;
  containerRef: React.RefObject<HTMLElement | null>;
  onResult: (cleanedText: string) => void;
  onError: (kind: VoiceErrorKind, detail?: string) => void;
  chatId?: string | null;
  enabled?: boolean;
}): {
  state: VoiceState;
  fallbackActive: boolean;
  hintVisible: boolean;
  effectiveKey: VoiceTriggerKey;
  registerSuccessfulUse: () => void;
  pendingChoice: VoicePendingChoice | null;
  selectChoice: (kind: VoiceChoiceKind) => void;
  dismissChoice: () => void;
} {
  const {
    triggerKey,
    containerRef,
    onResult,
    onError,
    chatId,
    enabled = true,
  } = args;

  const [state, setState] = useState<VoiceState>("idle");
  const [fallbackActive, setFallbackActive] = useState(false);
  const [hintVisible, setHintVisible] = useState(true);
  const [pendingChoice, setPendingChoice] =
    useState<VoicePendingChoice | null>(null);

  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingStartRef = useRef<number>(0);
  const isRecordingRef = useRef(false);
  const triggerArmedRef = useRef(false);
  const capsKeydownAtRef = useRef<number | null>(null);
  const pendingChoiceTimerRef = useRef<number | null>(null);
  const pendingChoiceRef = useRef<VoicePendingChoice | null>(null);
  // Latest onResult ref. The chooser auto-dismiss timer captures onResult
  // at the time the choice was offered; if the parent rerenders with a
  // new closure, we still want the timer to call the *current* onResult.
  const onResultRef = useRef(onResult);
  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  // Hydrate fallback + hint state from localStorage. SSR-safe (we only
  // read inside an effect).
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (window.localStorage.getItem(FALLBACK_STORAGE_KEY) === "1") {
        setFallbackActive(true);
      }
      const uses = Number(window.localStorage.getItem(HINT_USES_KEY) ?? "0");
      const lastUseRaw = window.localStorage.getItem(HINT_LAST_USE_KEY);
      const lastUseAt = lastUseRaw ? Number(lastUseRaw) : 0;
      const daysSinceLast =
        lastUseAt > 0 ? (Date.now() - lastUseAt) / 86_400_000 : Infinity;
      // Hide once the user has tried it 3 times AND used it in the last
      // 7 days. Re-show once if they've stopped using voice.
      if (uses >= HINT_USES_HIDE_AT && daysSinceLast <= HINT_REENGAGE_AFTER_DAYS) {
        setHintVisible(false);
      }
    } catch {
      // localStorage may be disabled (private browsing, embed contexts).
      // Falling back to "always show hint" is fine — better than crashing.
    }
  }, []);

  const effectiveKey: VoiceTriggerKey =
    fallbackActive && triggerKey === "caps_lock" ? "alt_right" : triggerKey;

  const clearPendingChoiceTimer = useCallback(() => {
    if (pendingChoiceTimerRef.current !== null) {
      window.clearTimeout(pendingChoiceTimerRef.current);
      pendingChoiceTimerRef.current = null;
    }
  }, []);

  const selectChoice = useCallback(
    (kind: VoiceChoiceKind) => {
      const choice = pendingChoiceRef.current;
      if (!choice) return;
      clearPendingChoiceTimer();
      pendingChoiceRef.current = null;
      setPendingChoice(null);
      const text = kind === "short" ? choice.shortened : choice.cleaned;
      onResultRef.current(text);
    },
    [clearPendingChoiceTimer]
  );

  const dismissChoice = useCallback(() => {
    clearPendingChoiceTimer();
    pendingChoiceRef.current = null;
    setPendingChoice(null);
  }, [clearPendingChoiceTimer]);

  const offerPendingChoice = useCallback(
    (choice: VoicePendingChoice) => {
      clearPendingChoiceTimer();
      pendingChoiceRef.current = choice;
      setPendingChoice(choice);
      pendingChoiceTimerRef.current = window.setTimeout(() => {
        // Auto-dismiss → default to full (cleaned). Mirror selectChoice
        // semantics so registerSuccessfulUse still fires.
        const current = pendingChoiceRef.current;
        if (!current) return;
        pendingChoiceRef.current = null;
        pendingChoiceTimerRef.current = null;
        setPendingChoice(null);
        onResultRef.current(current.cleaned);
      }, PENDING_CHOICE_AUTO_DISMISS_MS);
    },
    [clearPendingChoiceTimer]
  );

  const registerSuccessfulUse = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      const next =
        Number(window.localStorage.getItem(HINT_USES_KEY) ?? "0") + 1;
      window.localStorage.setItem(HINT_USES_KEY, String(next));
      window.localStorage.setItem(HINT_LAST_USE_KEY, String(Date.now()));
      if (next >= HINT_USES_HIDE_AT) setHintVisible(false);
    } catch {
      // ignore storage errors
    }
  }, []);

  const cleanup = useCallback(() => {
    isRecordingRef.current = false;
    triggerArmedRef.current = false;
    capsKeydownAtRef.current = null;
    const stream = mediaStreamRef.current;
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      mediaStreamRef.current = null;
    }
    recorderRef.current = null;
    chunksRef.current = [];
  }, []);

  const stopAndUpload = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder || !isRecordingRef.current) {
      cleanup();
      return;
    }
    const startedAt = recordingStartRef.current;
    const heldMs = Date.now() - startedAt;
    isRecordingRef.current = false;

    // Wait for the dataavailable + stop event so chunksRef is populated.
    await new Promise<void>((resolve) => {
      const onStop = () => {
        recorder.removeEventListener("stop", onStop);
        resolve();
      };
      recorder.addEventListener("stop", onStop);
      try {
        recorder.stop();
      } catch {
        resolve();
      }
    });

    // Release the mic regardless of upload outcome.
    const stream = mediaStreamRef.current;
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      mediaStreamRef.current = null;
    }

    if (heldMs < RECORDING_MIN_MS) {
      // Accidental press-release. Spec says silent abort.
      setState("idle");
      cleanup();
      return;
    }

    const blob = new Blob(chunksRef.current, {
      type: recorder.mimeType || "audio/webm",
    });
    chunksRef.current = [];
    recorderRef.current = null;

    if (blob.size === 0) {
      setState("idle");
      cleanup();
      return;
    }

    setState("processing");

    try {
      const form = new FormData();
      const ext = (recorder.mimeType || "").includes("webm") ? "webm" : "ogg";
      form.set("audio", blob, `voice.${ext}`);
      if (chatId) form.set("chatId", chatId);

      const resp = await fetch("/api/voice", {
        method: "POST",
        body: form,
      });
      if (resp.status === 429) {
        onError("rate_limited");
        setState("idle");
        return;
      }
      if (!resp.ok || !resp.body) {
        onError("transcribe_failed");
        setState("idle");
        return;
      }

      // SSE: the route streams `delta` events, then optionally `shortened`,
      // then a final `done` event. We buffer deltas internally and emit the
      // cleaned text once at the end (matching the non-streaming UX) so the
      // chooser flow + voiceFlashKey animation still work cleanly.
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let cleaned = "";
      let cleanedFinal: string | null = null;
      let transcriptFallback = "";
      let shortened: string | null = null;
      let cleanupSkipped = false;
      let streamErrored = false;

      // Deferred callback fired once the chooser overlay has been resolved,
      // OR immediately if no chooser is needed. Centralizing here prevents
      // double-firing onResult when the stream parser sees both a `delta`
      // accumulator and the final `done` cleaned text.
      const finalize = () => {
        const text = (cleanedFinal ?? cleaned ?? transcriptFallback).trim();
        if (!text) {
          setState("idle");
          return;
        }
        if (cleanupSkipped) onError("cleanup_failed");
        if (shortened && shortened !== text) {
          offerPendingChoice({ cleaned: text, shortened });
          registerSuccessfulUse();
          setState("idle");
          return;
        }
        onResult(text);
        registerSuccessfulUse();
        setState("idle");
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data:")) continue;
          try {
            const payload = JSON.parse(line.slice(5).trim()) as {
              type: string;
              delta?: string;
              cleaned?: string;
              transcript?: string;
              shortened?: string;
              cleanupSkipped?: boolean;
              code?: string;
              message?: string;
            };
            if (payload.type === "delta" && typeof payload.delta === "string") {
              cleaned += payload.delta;
            } else if (
              payload.type === "shortened" &&
              typeof payload.shortened === "string"
            ) {
              shortened = payload.shortened;
            } else if (payload.type === "done") {
              cleanedFinal =
                payload.cleaned ?? cleaned ?? payload.transcript ?? "";
              transcriptFallback = payload.transcript ?? "";
              cleanupSkipped = !!payload.cleanupSkipped;
            } else if (payload.type === "error") {
              streamErrored = true;
            }
          } catch {
            // ignore malformed event
          }
        }
      }

      if (streamErrored) {
        onError("transcribe_failed");
        setState("idle");
        return;
      }
      finalize();
    } catch (err) {
      onError("transcribe_failed", err instanceof Error ? err.message : "");
      setState("idle");
    } finally {
      cleanup();
    }
  }, [
    cleanup,
    chatId,
    onError,
    onResult,
    offerPendingChoice,
    registerSuccessfulUse,
  ]);

  const startRecording = useCallback(async () => {
    if (isRecordingRef.current) return;
    if (typeof navigator === "undefined" || !navigator.mediaDevices) {
      onError("mic_denied", "MediaDevices API unavailable");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      onError("mic_denied", err instanceof Error ? err.message : "");
      return;
    }

    let mimeType = "audio/webm;codecs=opus";
    if (
      typeof MediaRecorder !== "undefined" &&
      !MediaRecorder.isTypeSupported(mimeType)
    ) {
      mimeType = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "";
    }
    const recorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream);
    chunksRef.current = [];
    recorder.addEventListener("dataavailable", (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    });
    recorderRef.current = recorder;
    mediaStreamRef.current = stream;
    recordingStartRef.current = Date.now();
    isRecordingRef.current = true;
    recorder.start();
    setState("listening");

    // Hard ceiling — protects against stuck-key scenarios where keyup
    // never fires (focus changes, OS lock, etc).
    window.setTimeout(() => {
      if (isRecordingRef.current) {
        void stopAndUpload();
      }
    }, RECORDING_MAX_MS);
  }, [onError, stopAndUpload]);

  // Key listeners on the document. We only react when the focused element
  // is inside the chat input container — voice should not fire while the
  // user is typing in a different surface (Settings inputs, etc).
  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;

    const isContainerFocused = (): boolean => {
      const container = containerRef.current;
      if (!container) return false;
      const active = document.activeElement;
      if (!active) return false;
      return container === active || container.contains(active);
    };

    const matchesTrigger = (e: KeyboardEvent): boolean => {
      if (effectiveKey === "caps_lock") return e.code === "CapsLock";
      return e.code === "AltRight";
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (!matchesTrigger(e)) return;
      if (!isContainerFocused()) return;
      // Suppress OS Caps Lock toggle while we own the key.
      if (effectiveKey === "caps_lock") e.preventDefault();
      if (e.repeat) return;
      if (triggerArmedRef.current) return;
      triggerArmedRef.current = true;
      capsKeydownAtRef.current = Date.now();
      void startRecording();
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (!matchesTrigger(e)) return;
      if (!triggerArmedRef.current) return;
      // Caps Lock unreliability probe. On macOS (and many Linux desktops)
      // Caps Lock is an OS-level toggle, not a hold key — keydown fires
      // when the light comes on, the *next* keyup fires when the light
      // goes off. The user experiences this as
      //   tap 1 → listening (recording starts)
      //   speak (light stays on)
      //   tap 2 → processing (recording stops, light goes off)
      // — NOT the hold-to-talk Steadii ships. Detect this and persist
      // the fallback to Right Alt so subsequent attempts work as
      // designed.
      //
      // Two signals together cover the common cases:
      //   1. Quick tap-release (<80ms) — browser emits keyup almost
      //      immediately even though caps remained ON. Original probe.
      //   2. Caps Lock STILL ON at keyup — OS treated this press as
      //      "toggle ON" rather than "hold". Catches the long-speak
      //      pattern where heldMs is well above 80ms.
      if (
        effectiveKey === "caps_lock" &&
        !fallbackActive &&
        capsKeydownAtRef.current
      ) {
        const heldMs = Date.now() - capsKeydownAtRef.current;
        const stillLitAtRelease = e.getModifierState("CapsLock");
        if (heldMs < CAPS_LOCK_HOLD_PROBE_MS || stillLitAtRelease) {
          try {
            window.localStorage.setItem(FALLBACK_STORAGE_KEY, "1");
          } catch {
            // ignore
          }
          setFallbackActive(true);
          // Tear down without uploading — the clip is meaningless OR
          // (in the toggle-still-lit case) we abort the false start so
          // the user gets a clean retry on Right Alt.
          isRecordingRef.current = false;
          const recorder = recorderRef.current;
          if (recorder && recorder.state !== "inactive") {
            try {
              recorder.stop();
            } catch {
              // ignore
            }
          }
          cleanup();
          setState("idle");
          return;
        }
      }
      void stopAndUpload();
    };

    document.addEventListener("keydown", onKeyDown, { capture: true });
    document.addEventListener("keyup", onKeyUp, { capture: true });
    return () => {
      document.removeEventListener("keydown", onKeyDown, { capture: true });
      document.removeEventListener("keyup", onKeyUp, { capture: true });
    };
  }, [
    enabled,
    effectiveKey,
    fallbackActive,
    containerRef,
    startRecording,
    stopAndUpload,
    cleanup,
  ]);

  // Final unmount safety: if the component unmounts mid-recording, stop
  // tracks so the mic indicator goes away.
  useEffect(() => {
    return () => {
      const stream = mediaStreamRef.current;
      if (stream) {
        for (const track of stream.getTracks()) track.stop();
      }
      if (pendingChoiceTimerRef.current !== null) {
        window.clearTimeout(pendingChoiceTimerRef.current);
      }
    };
  }, []);

  return {
    state,
    fallbackActive,
    hintVisible,
    effectiveKey,
    registerSuccessfulUse,
    pendingChoice,
    selectChoice,
    dismissChoice,
  };
}

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

  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingStartRef = useRef<number>(0);
  const isRecordingRef = useRef(false);
  const triggerArmedRef = useRef(false);
  const capsKeydownAtRef = useRef<number | null>(null);

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
      if (!resp.ok) {
        onError("transcribe_failed");
        setState("idle");
        return;
      }
      const data = (await resp.json()) as {
        cleaned?: string;
        transcript?: string;
        cleanupSkipped?: boolean;
      };
      const text = (data.cleaned || data.transcript || "").trim();
      if (!text) {
        // No speech captured at all — silently return to idle. Toast on
        // empty would be noisy if user just released early.
        setState("idle");
        return;
      }
      if (data.cleanupSkipped) {
        onError("cleanup_failed");
      }
      onResult(text);
      registerSuccessfulUse();
      setState("idle");
    } catch (err) {
      onError("transcribe_failed", err instanceof Error ? err.message : "");
      setState("idle");
    } finally {
      cleanup();
    }
  }, [cleanup, chatId, onError, onResult, registerSuccessfulUse]);

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
      // Caps Lock unreliability probe — only on the very first attempt.
      // If the press-release cycle was suspiciously short, the browser
      // is emitting toggle events rather than true hold/release. Persist
      // the fallback flag and abort the recording so we don't ship a 50ms
      // clip to Whisper.
      if (
        effectiveKey === "caps_lock" &&
        !fallbackActive &&
        capsKeydownAtRef.current
      ) {
        const heldMs = Date.now() - capsKeydownAtRef.current;
        if (heldMs < CAPS_LOCK_HOLD_PROBE_MS) {
          try {
            window.localStorage.setItem(FALLBACK_STORAGE_KEY, "1");
          } catch {
            // ignore
          }
          setFallbackActive(true);
          // Tear down without uploading — the clip is meaningless.
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
    };
  }, []);

  return {
    state,
    fallbackActive,
    hintVisible,
    effectiveKey,
    registerSuccessfulUse,
  };
}

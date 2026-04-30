"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import type { VoiceTriggerKey } from "@/components/chat/use-voice-input";
import { VoiceOverlay } from "./voice-overlay";
import { GlobalVoicePill } from "./global-voice-pill";

// Phase 3 universal Caps Lock model:
//   tap (<250ms) - chat overlay closed         → open overlay
//   tap (<250ms) - chat overlay open           → close overlay
//   hold (>=250ms) - chat composer focused     → useVoiceInput handles it
//   hold (>=250ms) - chat composer not focused → global agent voice
//
// The provider mounts a single document-level keyboard listener at the /app
// layout level. Existing per-composer useVoiceInput() instances continue to
// own focused-input voice (Phase 1); this layer only handles the
// non-focused-input cases. Coordination is via a marker attribute on the
// composer form (`data-voice-composer="true"`) — the global handler bails
// when that container has focus, avoiding double-fire.
//
// Public marketing routes (`/`, `/login`, `/onboarding`) do not mount this
// provider, so Caps Lock retains its OS toggle behavior outside the app.

const TAP_VS_HOLD_MS = 250;
const HOLD_RECORD_DELAY_MS = 250;
const RECORDING_MIN_MS = 500;
const RECORDING_MAX_MS = 60_000;

const COMPOSER_MARKER_SELECTOR = "[data-voice-composer]";

export type GlobalVoiceState = "idle" | "listening" | "processing";

type VoiceAppContextValue = {
  overlayOpen: boolean;
  openOverlay: () => void;
  closeOverlay: () => void;
  toggleOverlay: () => void;
  globalVoiceState: GlobalVoiceState;
  effectiveKey: VoiceTriggerKey;
  registerGlobalUse: () => void;
  globalUses: number;
};

const VoiceAppContext = createContext<VoiceAppContextValue | null>(null);

export function useVoiceApp(): VoiceAppContextValue {
  const ctx = useContext(VoiceAppContext);
  if (!ctx) {
    throw new Error(
      "useVoiceApp must be used inside <VoiceAppProvider>"
    );
  }
  return ctx;
}

const FALLBACK_STORAGE_KEY = "steadii.voice.fallback_alt_right";
// Phase 3 introduces a SEPARATE counter from Phase 1's `steadii.voice.hint_uses`
// so the home composer hint and the global non-chat-page hint fade
// independently — a user who's mastered hold-to-talk in chat may still
// need to learn tap-to-summon. See handoff §D.
const GLOBAL_USES_KEY = "steadii.voice.global_uses";
const GLOBAL_LAST_USE_KEY = "steadii.voice.global_last_use_at";

export function VoiceAppProvider({
  voiceTriggerKey,
  children,
}: {
  voiceTriggerKey: VoiceTriggerKey;
  children: ReactNode;
}) {
  const tVoice = useTranslations("voice");
  const pathname = usePathname();
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [globalVoiceState, setGlobalVoiceState] = useState<GlobalVoiceState>("idle");
  const [fallbackActive, setFallbackActive] = useState(false);
  const [globalUses, setGlobalUses] = useState(0);

  const overlayOpenRef = useRef(false);
  useEffect(() => {
    overlayOpenRef.current = overlayOpen;
  }, [overlayOpen]);

  // Hydrate fallback flag from localStorage so the global handler honors
  // the same Right-Option fallback that Phase 1 already learned about.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (window.localStorage.getItem(FALLBACK_STORAGE_KEY) === "1") {
        setFallbackActive(true);
      }
      const uses = Number(
        window.localStorage.getItem(GLOBAL_USES_KEY) ?? "0"
      );
      if (!Number.isNaN(uses)) setGlobalUses(uses);
    } catch {
      // localStorage unavailable — stick with defaults.
    }
  }, []);

  const effectiveKey: VoiceTriggerKey =
    fallbackActive && voiceTriggerKey === "caps_lock"
      ? "alt_right"
      : voiceTriggerKey;

  const openOverlay = useCallback(() => setOverlayOpen(true), []);
  const closeOverlay = useCallback(() => setOverlayOpen(false), []);
  const toggleOverlay = useCallback(() => setOverlayOpen((v) => !v), []);

  const registerGlobalUse = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      const next =
        Number(window.localStorage.getItem(GLOBAL_USES_KEY) ?? "0") + 1;
      window.localStorage.setItem(GLOBAL_USES_KEY, String(next));
      window.localStorage.setItem(
        GLOBAL_LAST_USE_KEY,
        String(Date.now())
      );
      setGlobalUses(next);
    } catch {
      // ignore
    }
  }, []);

  // Document-level Caps Lock handler. Coordination with chat-input's
  // useVoiceInput happens through the composer marker selector — when a
  // chat-input is focused we bail out of the global path entirely.
  const keydownAtRef = useRef<number | null>(null);
  const armedRef = useRef(false);
  const recordTimerRef = useRef<number | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingStartRef = useRef<number>(0);
  const isRecordingRef = useRef(false);

  const cleanupRecording = useCallback(() => {
    isRecordingRef.current = false;
    const stream = mediaStreamRef.current;
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      mediaStreamRef.current = null;
    }
    recorderRef.current = null;
    chunksRef.current = [];
    if (recordTimerRef.current !== null) {
      window.clearTimeout(recordTimerRef.current);
      recordTimerRef.current = null;
    }
  }, []);

  const beginRecording = useCallback(async () => {
    if (isRecordingRef.current) return;
    if (typeof navigator === "undefined" || !navigator.mediaDevices) {
      toast.error(tVoice("error_mic_denied"));
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast.error(tVoice("error_mic_denied"));
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
    setGlobalVoiceState("listening");

    // Hard ceiling against stuck-key scenarios (focus changes, OS lock).
    window.setTimeout(() => {
      if (isRecordingRef.current) {
        void stopAndDispatch();
      }
    }, RECORDING_MAX_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tVoice]);

  // Stops the recorder, uploads to /api/voice for Whisper + Mini cleanup,
  // then POSTs the cleaned text to /api/voice/agent. The agent endpoint
  // returns either a `kind: "operation"` payload (toast it) or a
  // `kind: "chat"` payload (open the overlay, pre-populated).
  const stopAndDispatch = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder || !isRecordingRef.current) {
      cleanupRecording();
      setGlobalVoiceState("idle");
      return;
    }
    const startedAt = recordingStartRef.current;
    const heldMs = Date.now() - startedAt;
    isRecordingRef.current = false;

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

    const stream = mediaStreamRef.current;
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      mediaStreamRef.current = null;
    }

    if (heldMs < RECORDING_MIN_MS) {
      cleanupRecording();
      setGlobalVoiceState("idle");
      return;
    }

    const blob = new Blob(chunksRef.current, {
      type: recorder.mimeType || "audio/webm",
    });
    chunksRef.current = [];
    recorderRef.current = null;
    if (blob.size === 0) {
      cleanupRecording();
      setGlobalVoiceState("idle");
      return;
    }

    setGlobalVoiceState("processing");

    try {
      const form = new FormData();
      const ext = (recorder.mimeType || "").includes("webm") ? "webm" : "ogg";
      form.set("audio", blob, `voice.${ext}`);
      form.set("surface", "global");

      const voiceResp = await fetch("/api/voice", {
        method: "POST",
        body: form,
      });
      if (voiceResp.status === 429) {
        toast.error(tVoice("error_rate_limited"));
        setGlobalVoiceState("idle");
        return;
      }
      if (!voiceResp.ok) {
        toast.error(tVoice("error_transcribe_failed"));
        setGlobalVoiceState("idle");
        return;
      }
      const voiceJson = (await voiceResp.json()) as {
        cleaned?: string;
        transcript?: string;
        cleanupSkipped?: boolean;
      };
      const cleaned = (voiceJson.cleaned || voiceJson.transcript || "").trim();
      if (!cleaned) {
        // Silent return — empty speech is usually accidental.
        setGlobalVoiceState("idle");
        return;
      }

      const agentResp = await fetch("/api/voice/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: cleaned }),
      });
      if (!agentResp.ok) {
        toast.error(tVoice("error_agent_failed"));
        setGlobalVoiceState("idle");
        return;
      }
      const agentJson = (await agentResp.json()) as
        | {
            kind: "operation";
            summary: string;
            executed: Array<{ tool: string; ok: boolean }>;
          }
        | {
            kind: "chat";
            chatId: string;
            userMessage: string;
            assistantMessage: string;
            needsConfirmation?: boolean;
          };

      if (agentJson.kind === "operation") {
        const allOk = agentJson.executed.every((e) => e.ok);
        if (allOk) {
          toast.success(agentJson.summary);
        } else {
          toast.error(tVoice("error_operation_partial"));
        }
        registerGlobalUse();
      } else {
        // Chat mode: open overlay with the freshly created chat. The overlay
        // re-fetches messages by chatId; the eager userMessage/assistantMessage
        // strings are kept on the result for an instant first paint.
        window.dispatchEvent(
          new CustomEvent("steadii:open-chat-in-overlay", {
            detail: {
              chatId: agentJson.chatId,
              userMessage: agentJson.userMessage,
              assistantMessage: agentJson.assistantMessage,
              needsConfirmation: agentJson.needsConfirmation ?? false,
            },
          })
        );
        registerGlobalUse();
      }
    } catch (err) {
      toast.error(tVoice("error_transcribe_failed"));
      console.warn("global voice dispatch failed", err);
    } finally {
      setGlobalVoiceState("idle");
      cleanupRecording();
    }
  }, [cleanupRecording, registerGlobalUse, tVoice]);

  // The actual document-level Caps Lock listener. We bail when a chat
  // composer is focused so Phase 1's per-composer useVoiceInput owns
  // the keypress (focused-input case is its responsibility).
  useEffect(() => {
    if (typeof window === "undefined") return;

    const isComposerFocused = (): boolean => {
      const active = document.activeElement as HTMLElement | null;
      if (!active) return false;
      return !!active.closest(COMPOSER_MARKER_SELECTOR);
    };

    const matchesTrigger = (e: KeyboardEvent): boolean => {
      if (effectiveKey === "caps_lock") return e.code === "CapsLock";
      return e.code === "AltRight";
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (!matchesTrigger(e)) return;
      // Suppress the OS toggle every time, even when we're going to bail —
      // useVoiceInput also calls preventDefault and the call is idempotent.
      if (effectiveKey === "caps_lock") e.preventDefault();
      if (e.repeat) return;
      // Composer focused → defer entirely to Phase 1 useVoiceInput. Per spec:
      // "Tap Caps Lock on /app (chat input focused) → no overlay (no-op when
      // already in chat input)" + hold inside chat composer is Phase 1 voice.
      if (isComposerFocused()) return;
      if (armedRef.current) return;
      armedRef.current = true;
      keydownAtRef.current = Date.now();
      // Defer mic acquisition until we cross the tap-vs-hold threshold so a
      // tap doesn't cause a transient mic-permission blip in the browser
      // tab. Recording starts a touch later than the keydown moment, but
      // hold-to-talk users naturally pause briefly before speaking.
      recordTimerRef.current = window.setTimeout(() => {
        recordTimerRef.current = null;
        void beginRecording();
      }, HOLD_RECORD_DELAY_MS);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (!matchesTrigger(e)) return;
      if (!armedRef.current) return;
      armedRef.current = false;
      const downAt = keydownAtRef.current ?? Date.now();
      keydownAtRef.current = null;
      const heldMs = Date.now() - downAt;

      if (recordTimerRef.current !== null) {
        window.clearTimeout(recordTimerRef.current);
        recordTimerRef.current = null;
      }

      if (heldMs < TAP_VS_HOLD_MS) {
        // TAP — toggle overlay. The composer-focus check on keydown means
        // we only ever reach this branch when no chat composer is focused.
        setOverlayOpen((v) => !v);
        return;
      }
      // HOLD — wrap up recording (if it actually started).
      if (isRecordingRef.current) {
        void stopAndDispatch();
      } else {
        // Hold passed 250ms but the timer hadn't fired yet → start now then
        // immediately stop. Edge case; user gets a near-empty clip and the
        // 500ms RECORDING_MIN_MS check filters it out.
        setGlobalVoiceState("idle");
      }
    };

    document.addEventListener("keydown", onKeyDown, { capture: true });
    document.addEventListener("keyup", onKeyUp, { capture: true });
    return () => {
      document.removeEventListener("keydown", onKeyDown, { capture: true });
      document.removeEventListener("keyup", onKeyUp, { capture: true });
    };
  }, [effectiveKey, beginRecording, stopAndDispatch]);

  // Final safety: release mic on unmount.
  useEffect(() => {
    return () => {
      const stream = mediaStreamRef.current;
      if (stream) {
        for (const track of stream.getTracks()) track.stop();
      }
      if (recordTimerRef.current !== null) {
        window.clearTimeout(recordTimerRef.current);
      }
    };
  }, []);

  // Close overlay automatically when route changes — Cmd+K-style popups
  // shouldn't survive navigation.
  useEffect(() => {
    setOverlayOpen(false);
  }, [pathname]);

  const value: VoiceAppContextValue = {
    overlayOpen,
    openOverlay,
    closeOverlay,
    toggleOverlay,
    globalVoiceState,
    effectiveKey,
    registerGlobalUse,
    globalUses,
  };

  return (
    <VoiceAppContext.Provider value={value}>
      {children}
      {overlayOpen ? <VoiceOverlay /> : null}
      {globalVoiceState !== "idle" ? (
        <GlobalVoicePill state={globalVoiceState} />
      ) : null}
    </VoiceAppContext.Provider>
  );
}

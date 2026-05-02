"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { ArrowRight, Bell, BellOff } from "lucide-react";
import { dismissOnboardingWaitAction } from "@/app/(auth)/onboarding/actions";
import { CommandPalette } from "@/components/chat/command-palette";
import { cn } from "@/lib/utils/cn";

// Wave 2 onboarding Step 3 — commitment + wait. The screen has three
// jobs:
//
// 1. Reset the user's mental model from "explore the app" to "wait for
//    Steadii". The pivot demands the onboarding *feel* like delegation,
//    not a feature tour.
// 2. Give the user something to do *now* if they want — the embedded
//    command palette dispatches a chat / command immediately.
// 3. Capture push-notification permission opportunistically. If push
//    isn't wired (Wave 2 ships email-fallback only behind a feature
//    flag — see `lib/notifications/web-push.ts`), the toggle becomes a
//    "we'll email you within 24h" reassurance instead.
//
// Pushing is feature-flag-gated on the server; the client receives a
// `pushSupported` prop. When false, we render the email-only variant.
export function OnboardingWaitStep({
  pushSupported,
}: {
  pushSupported: boolean;
}) {
  const t = useTranslations("onboarding_wait");
  const [pending, startTransition] = useTransition();
  const [pushDecision, setPushDecision] = useState<
    "pending" | "granted" | "skipped"
  >("pending");

  const finish = () => {
    if (pending) return;
    startTransition(async () => {
      await dismissOnboardingWaitAction({
        pushPermissionGranted: pushDecision === "granted",
      });
    });
  };

  const requestPush = async () => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setPushDecision("skipped");
      return;
    }
    try {
      const result = await Notification.requestPermission();
      setPushDecision(result === "granted" ? "granted" : "skipped");
    } catch {
      setPushDecision("skipped");
    }
  };

  return (
    <div className="flex w-full flex-col items-center gap-6 text-center">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-[hsl(var(--foreground))]">
          {t("title")}
        </h1>
        <div className="flex flex-col gap-2 text-small text-[hsl(var(--muted-foreground))]">
          <p>{t("body_p1")}</p>
          <p>{t("body_p2")}</p>
          <p>{t("body_p3")}</p>
        </div>
      </div>

      <div data-command-palette className="w-full">
        <CommandPalette />
      </div>

      {pushSupported && pushDecision === "pending" ? (
        <div className="flex w-full flex-col items-center gap-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] p-3">
          <p className="text-small text-[hsl(var(--foreground))]">
            <Bell
              className="mr-1.5 inline-block align-text-top text-[hsl(var(--primary))]"
              size={14}
              strokeWidth={1.75}
            />
            {t("push_permission_prompt")}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={requestPush}
              className="inline-flex h-8 items-center rounded-full bg-[hsl(var(--foreground))] px-3 text-[12px] font-medium text-[hsl(var(--surface))] transition-default hover:opacity-90"
            >
              {t("push_permission_yes")}
            </button>
            <button
              type="button"
              onClick={() => setPushDecision("skipped")}
              className="inline-flex h-8 items-center rounded-full px-3 text-[12px] text-[hsl(var(--muted-foreground))] transition-hover hover:text-[hsl(var(--foreground))]"
            >
              {t("push_permission_no")}
            </button>
          </div>
        </div>
      ) : pushDecision === "granted" ? (
        <p className="inline-flex items-center gap-1 text-[12px] text-[hsl(var(--muted-foreground))]">
          <Bell size={12} strokeWidth={1.75} className="text-[hsl(var(--primary))]" />
          <span>{t("push_permission_yes")}</span>
        </p>
      ) : (
        <p className="inline-flex items-center gap-1 text-[12px] text-[hsl(var(--muted-foreground))]">
          <BellOff size={12} strokeWidth={1.75} />
          <span>{t("push_permission_no")}</span>
        </p>
      )}

      <button
        type="button"
        onClick={finish}
        disabled={pending}
        className={cn(
          "inline-flex h-9 items-center gap-1.5 rounded-md bg-[hsl(var(--primary))] px-4 text-body font-medium text-[hsl(var(--primary-foreground))] transition-default hover:opacity-90",
          pending && "opacity-60"
        )}
      >
        <span>{t("finish_button")}</span>
        <ArrowRight size={14} strokeWidth={2} />
      </button>
    </div>
  );
}

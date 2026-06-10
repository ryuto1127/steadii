"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { ArrowRight } from "lucide-react";
import { dismissOnboardingWaitAction } from "@/app/(auth)/onboarding/actions";
import { CommandPalette } from "@/components/chat/command-palette";
import { cn } from "@/lib/utils/cn";

// Wave 2 onboarding Step 3 — commitment + wait. The screen has two jobs:
//
// 1. Reset the user's mental model from "explore the app" to "wait for
//    Steadii". The pivot demands the onboarding *feel* like delegation,
//    not a feature tour.
// 2. Give the user something to do *now* if they want — the embedded
//    command palette dispatches a chat / command immediately.
//
// 2026-06-09 — the push-permission capture was removed. Web push was a
// no-op stub (lib/notifications/web-push.ts, now deleted); promising a
// push we never send was dishonest. The user's first proposal lands on
// Home and the daily digest email is the real notification channel.
export function OnboardingWaitStep() {
  const t = useTranslations("onboarding_wait");
  const [pending, startTransition] = useTransition();

  const finish = () => {
    if (pending) return;
    startTransition(async () => {
      await dismissOnboardingWaitAction();
    });
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

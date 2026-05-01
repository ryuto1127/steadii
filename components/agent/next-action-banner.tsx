import {
  Send,
  HelpCircle,
  Archive,
  Clock,
  Check,
  Pause,
  Star,
} from "lucide-react";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

type Action =
  | "draft_reply"
  | "ask_clarifying"
  | "archive"
  | "snooze"
  | "no_op"
  | "notify_only"
  | "paused";

type BannerSpec = {
  icon: ReactNode;
  titleKey:
    | "draft_reply_title"
    | "ask_clarifying_title"
    | "archive_title"
    | "snooze_title"
    | "no_op_title"
    | "notify_only_title"
    | "paused_title";
  bodyKey:
    | "draft_reply_body"
    | "ask_clarifying_body"
    | "archive_body"
    | "snooze_body"
    | "no_op_body"
    | "notify_only_body"
    | "paused_body";
  tone: "primary" | "warn" | "muted";
};

function specFor(action: Action): BannerSpec {
  switch (action) {
    case "draft_reply":
      return {
        icon: <Send size={14} strokeWidth={1.75} />,
        titleKey: "draft_reply_title",
        bodyKey: "draft_reply_body",
        tone: "primary",
      };
    case "ask_clarifying":
      return {
        icon: <HelpCircle size={14} strokeWidth={1.75} />,
        titleKey: "ask_clarifying_title",
        bodyKey: "ask_clarifying_body",
        tone: "warn",
      };
    case "archive":
      return {
        icon: <Archive size={14} strokeWidth={1.75} />,
        titleKey: "archive_title",
        bodyKey: "archive_body",
        tone: "muted",
      };
    case "snooze":
      return {
        icon: <Clock size={14} strokeWidth={1.75} />,
        titleKey: "snooze_title",
        bodyKey: "snooze_body",
        tone: "muted",
      };
    case "no_op":
      return {
        icon: <Check size={14} strokeWidth={1.75} />,
        titleKey: "no_op_title",
        bodyKey: "no_op_body",
        tone: "muted",
      };
    case "notify_only":
      return {
        icon: <Star size={14} strokeWidth={1.75} fill="currentColor" />,
        titleKey: "notify_only_title",
        bodyKey: "notify_only_body",
        tone: "primary",
      };
    case "paused":
      return {
        icon: <Pause size={14} strokeWidth={1.75} />,
        titleKey: "paused_title",
        bodyKey: "paused_body",
        tone: "warn",
      };
  }
}

export async function NextActionBanner({ action }: { action: Action }) {
  const t = await getTranslations("agent.next_action_banner");
  const spec = specFor(action);
  const colorByTone =
    spec.tone === "primary"
      ? "border-[hsl(var(--primary)/0.4)] bg-[hsl(var(--primary)/0.06)] text-[hsl(var(--primary))]"
      : spec.tone === "warn"
      ? "border-[hsl(38_92%_45%/0.4)] bg-[hsl(38_92%_45%/0.06)] text-[hsl(38_92%_38%)] dark:text-[hsl(38_92%_55%)]"
      : "border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] text-[hsl(var(--muted-foreground))]";

  return (
    <div
      className={`flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-small ${colorByTone}`}
    >
      <span className="mt-0.5 shrink-0">{spec.icon}</span>
      <div>
        <div className="font-medium">{t(spec.titleKey)}</div>
        <div
          className={
            spec.tone === "muted"
              ? "mt-0.5"
              : "mt-0.5 text-[hsl(var(--foreground))]"
          }
        >
          {t(spec.bodyKey)}
        </div>
      </div>
    </div>
  );
}

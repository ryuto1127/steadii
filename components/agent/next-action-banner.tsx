import {
  Send,
  HelpCircle,
  Archive,
  Clock,
  Check,
  Pause,
  Star,
} from "lucide-react";
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
  title: string;
  body: string;
  tone: "primary" | "warn" | "muted";
};

function specFor(action: Action): BannerSpec {
  switch (action) {
    case "draft_reply":
      return {
        icon: <Send size={14} strokeWidth={1.75} />,
        title: "Steadii drafted a reply.",
        body: "Review the draft below. Edit if needed, then Send.",
        tone: "primary",
      };
    case "ask_clarifying":
      return {
        icon: <HelpCircle size={14} strokeWidth={1.75} />,
        title: "Steadii needs more info from you.",
        body: "Provide the missing context below. Once you reply, Steadii drafts the response.",
        tone: "warn",
      };
    case "archive":
      return {
        icon: <Archive size={14} strokeWidth={1.75} />,
        title: "No reply needed.",
        body: "Steadii recommends archiving this. Dismiss when you've handled it.",
        tone: "muted",
      };
    case "snooze":
      return {
        icon: <Clock size={14} strokeWidth={1.75} />,
        title: "Steadii suggests revisiting later.",
        body: "Dismiss for now; the item will resurface when relevant.",
        tone: "muted",
      };
    case "no_op":
      return {
        icon: <Check size={14} strokeWidth={1.75} />,
        title: "No action proposed.",
        body: "Steadii didn't see anything that needs you. Dismiss to clear it.",
        tone: "muted",
      };
    case "notify_only":
      return {
        icon: <Star size={14} strokeWidth={1.75} fill="currentColor" />,
        title: "Important — no reply needed.",
        body: "Steadii flagged this so you don't miss it. Read and dismiss.",
        tone: "primary",
      };
    case "paused":
      return {
        icon: <Pause size={14} strokeWidth={1.75} />,
        title: "Paused — credits exhausted.",
        body: "Top up to resume draft generation. Classification continues for free.",
        tone: "warn",
      };
  }
}

export function NextActionBanner({ action }: { action: Action }) {
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
        <div className="font-medium">{spec.title}</div>
        <div
          className={
            spec.tone === "muted"
              ? "mt-0.5"
              : "mt-0.5 text-[hsl(var(--foreground))]"
          }
        >
          {spec.body}
        </div>
      </div>
    </div>
  );
}

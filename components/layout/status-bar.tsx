import { getTranslations } from "next-intl/server";

type Props = {
  creditsUsed: number;
  creditsLimit: number;
  plan: "free" | "pro" | "admin";
};

// 32px-tall persistent status bar at the bottom of the main column.
// Server component — reads translations via getTranslations so the
// labels follow the user's UI language (not the agent's).
export async function StatusBar({ creditsUsed, creditsLimit, plan }: Props) {
  const t = await getTranslations("status_bar");
  const remaining = Math.max(0, creditsLimit - creditsUsed);
  const planLabel =
    plan === "pro"
      ? t("plan_pro")
      : plan === "admin"
      ? t("plan_admin")
      : t("plan_free");

  const creditsText =
    plan === "admin"
      ? t("credits_unlimited", { plan: planLabel })
      : t("credits", { n: remaining, plan: planLabel });

  return (
    <footer
      className="sticky bottom-0 z-20 flex h-8 items-center justify-between gap-4 bg-[hsl(var(--surface-raised))] px-3.5 text-[12px] text-[hsl(var(--muted-foreground))]"
      style={{
        borderTop: "1px solid hsl(var(--border) / 0.6)",
        fontFamily: "var(--font-sans)",
      }}
      aria-label="Status bar"
    >
      <div className="flex items-center gap-4">
        <Shortcut k="⌘/" label={t("focus_input")} />
        <Shortcut k="↵" label={t("send")} />
        <Shortcut k="⌘K" label={t("actions")} />
      </div>
      <div className="flex items-center gap-3 tabular-nums">
        <span>{creditsText}</span>
      </div>
    </footer>
  );
}

function Shortcut({ k, label }: { k: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <kbd
        className="rounded-[4px] border px-1 py-[1px] font-mono text-[10px] leading-none text-[hsl(var(--foreground)/0.75)]"
        style={{
          borderColor: "hsl(var(--border) / 0.6)",
          backgroundColor: "hsl(var(--surface))",
        }}
      >
        {k}
      </kbd>
      <span>{label}</span>
    </span>
  );
}

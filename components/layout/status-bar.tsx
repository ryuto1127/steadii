type Props = {
  creditsUsed: number;
  creditsLimit: number;
  plan: "free" | "pro" | "admin";
};

// 28px-tall persistent status bar at the bottom of the main column.
// Mono shortcut keys on the left, credits + plan right-aligned.
export function StatusBar({ creditsUsed, creditsLimit, plan }: Props) {
  const remaining = Math.max(0, creditsLimit - creditsUsed);
  const planLabel = plan === "pro" ? "Pro" : plan === "admin" ? "Admin" : "Free";

  return (
    <footer
      className="sticky bottom-0 z-20 flex h-7 items-center justify-between gap-4 border-t border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-4 font-mono text-[11px] text-[hsl(var(--muted-foreground))]"
      aria-label="Status bar"
    >
      <div className="flex items-center gap-4">
        <Shortcut k="⌘/" label="Focus input" />
        <Shortcut k="↵" label="Send" />
        <Shortcut k="⌘K" label="Actions" />
      </div>
      <div className="flex items-center gap-3 tabular-nums">
        <span>
          {plan === "admin" ? "∞" : remaining} credits · {planLabel}
        </span>
      </div>
    </footer>
  );
}

function Shortcut({ k, label }: { k: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <kbd className="rounded-[3px] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-1 py-[1px] font-mono text-[10px] leading-none text-[hsl(var(--foreground))]">
        {k}
      </kbd>
      <span
        className="text-[11px]"
        style={{ fontFamily: "var(--font-sans)" }}
      >
        {label}
      </span>
    </span>
  );
}

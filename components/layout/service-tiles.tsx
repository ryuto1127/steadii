import Link from "next/link";
import { Calendar, FileText, Sparkles } from "lucide-react";

type Tile = {
  label: string;
  href: string;
  icon: typeof Calendar;
  bg: string;
  fg: string;
};

// Three pinned service tiles at the top of the sidebar — analogous to
// Arc's pinned-tab icons. Brand-ish colors; clicking opens the related
// settings pane. Tile visuals only; no status indicator yet.
const TILES: Tile[] = [
  {
    label: "Notion",
    href: "/app/settings",
    icon: FileText,
    bg: "#000000",
    fg: "#FFFFFF",
  },
  {
    label: "Google Calendar",
    href: "/app/calendar",
    icon: Calendar,
    bg: "#4285F4",
    fg: "#FFFFFF",
  },
  {
    label: "Steadii agent",
    href: "/app",
    icon: Sparkles,
    bg: "hsl(var(--primary))",
    fg: "hsl(var(--primary-foreground))",
  },
];

export function ServiceTiles() {
  return (
    <div className="flex gap-1.5 px-1 pb-4">
      {TILES.map((t) => {
        const Icon = t.icon;
        return (
          <Link
            key={t.label}
            href={t.href}
            aria-label={t.label}
            title={t.label}
            className="flex h-7 w-7 items-center justify-center rounded-lg transition-hover hover:brightness-110"
            style={{ backgroundColor: t.bg, color: t.fg }}
          >
            <Icon size={14} strokeWidth={1.75} />
          </Link>
        );
      })}
    </div>
  );
}

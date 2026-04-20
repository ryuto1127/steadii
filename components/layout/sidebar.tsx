import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  MessageCircle,
  Calendar,
  BookOpen,
  FileText,
  CheckSquare,
  FolderOpen,
  Settings,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

// Lucide icons share viewBox="0 0 24 24" but the painted content has
// inconsistent left margins: Calendar/BookOpen/CheckSquare draw their body
// at x=3, FileText/MessageCircle at x=4, while FolderOpen and Settings draw
// their body flush at x=2. At size=16 that puts the latter two ~1 px
// further left than the rest. Wrapper CSS can't fix this (the SVG bbox IS
// centered — it's the paint within that's shifted). We nudge the two
// outliers right by 1 px so the strokes visually align.
const ICON_OFFSET_PX: Record<string, number> = {
  resources: 1, // FolderOpen body at x=2
  settings: 1,  // Settings gear's leftmost spoke at x=2
};

type Item = { key: string; href: string; icon: LucideIcon };

const items: readonly Item[] = [
  { key: "chat", href: "/app/chat", icon: MessageCircle },
  { key: "calendar", href: "/app/calendar", icon: Calendar },
  { key: "mistakes", href: "/app/mistakes", icon: BookOpen },
  { key: "syllabus", href: "/app/syllabus", icon: FileText },
  { key: "assignments", href: "/app/assignments", icon: CheckSquare },
  { key: "resources", href: "/app/resources", icon: FolderOpen },
  { key: "settings", href: "/app/settings", icon: Settings },
];

export async function Sidebar() {
  const t = await getTranslations("nav");

  return (
    <aside
      className="flex h-screen w-60 flex-col bg-[hsl(var(--surface-raised))] px-3 py-6"
      aria-label="Primary"
    >
      <div className="px-3 pb-8 font-serif text-2xl text-[hsl(var(--foreground))]">
        Steadii
      </div>
      <nav className="flex-1 space-y-1">
        {items.map((item) => {
          const Icon = item.icon;
          const offset = ICON_OFFSET_PX[item.key] ?? 0;
          return (
            <Link
              key={item.key}
              href={item.href}
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--surface))] hover:text-[hsl(var(--foreground))]"
            >
              <span
                className="flex h-5 w-5 shrink-0 items-center justify-center"
                style={offset ? { transform: `translateX(${offset}px)` } : undefined}
                aria-hidden
              >
                <Icon size={16} strokeWidth={1.75} />
              </span>
              <span>{t(item.key)}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

export const __testing = { ICON_OFFSET_PX };

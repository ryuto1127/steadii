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

const items = [
  { key: "chat", href: "/app/chat", icon: MessageCircle },
  { key: "calendar", href: "/app/calendar", icon: Calendar },
  { key: "mistakes", href: "/app/mistakes", icon: BookOpen },
  { key: "syllabus", href: "/app/syllabus", icon: FileText },
  { key: "assignments", href: "/app/assignments", icon: CheckSquare },
  { key: "resources", href: "/app/resources", icon: FolderOpen },
  { key: "settings", href: "/app/settings", icon: Settings },
] as const;

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
          return (
            <Link
              key={item.key}
              href={item.href}
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--surface))] hover:text-[hsl(var(--foreground))]"
            >
              <Icon size={16} strokeWidth={1.75} />
              <span>{t(item.key)}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

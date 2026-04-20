import { getTranslations } from "next-intl/server";
import { SidebarNav } from "./sidebar-nav";
import { NAV_ITEM_KEYS } from "./nav-items";

export async function Sidebar() {
  const t = await getTranslations("nav");
  const labels: Record<string, string> = {};
  for (const key of NAV_ITEM_KEYS) labels[key] = t(key);

  return (
    <aside
      className="sticky top-0 flex h-screen w-56 shrink-0 flex-col border-r border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-3 py-5"
      aria-label="Primary"
    >
      <div className="px-3 pb-6 text-[15px] font-semibold tracking-tight text-[hsl(var(--foreground))]">
        Steadii
      </div>
      <SidebarNav labels={labels} />
    </aside>
  );
}

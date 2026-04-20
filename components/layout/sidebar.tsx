import { getTranslations } from "next-intl/server";
import { SidebarNav } from "./sidebar-nav";
import { ICON_OFFSET_PX, NAV_ITEM_KEYS } from "./nav-items";

export async function Sidebar() {
  const t = await getTranslations("nav");
  const labels: Record<string, string> = {};
  for (const key of NAV_ITEM_KEYS) labels[key] = t(key);

  return (
    <aside
      className="flex h-screen w-60 flex-col bg-[hsl(var(--surface-raised))] px-3 py-6"
      aria-label="Primary"
    >
      <div className="px-3 pb-8 font-serif text-2xl text-[hsl(var(--foreground))]">
        Steadii
      </div>
      <SidebarNav labels={labels} />
    </aside>
  );
}

// Kept for the sidebar-icon-offsets.test.ts import path. Clients of this
// test should migrate to importing from `./nav-items` directly.
export const __testing = { ICON_OFFSET_PX };

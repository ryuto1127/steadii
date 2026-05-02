"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

// Tiny shared-state hub for the mobile nav drawer. Trigger and drawer are
// both client components that mount in different parts of the layout, so
// this context is the cheapest way to wire them up without lifting the
// fetched sidebar data into a client tree.
type MobileNavCtx = {
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
};

const Ctx = createContext<MobileNavCtx | null>(null);

export function MobileNavProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close the drawer on route change. Without this the drawer stays open
  // after the user taps a nav link and the new page reads as broken.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Lock body scroll while the drawer is open so the user's swipe doesn't
  // accidentally scroll the underlying page.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Esc closes — keyboard users get the same out as click-on-backdrop.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const toggle = useCallback(() => setOpen((v) => !v), []);

  return <Ctx.Provider value={{ open, setOpen, toggle }}>{children}</Ctx.Provider>;
}

function useMobileNav(): MobileNavCtx {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error("useMobileNav requires <MobileNavProvider>");
  }
  return ctx;
}

export function MobileNavTrigger({ className }: { className?: string }) {
  const { open, toggle } = useMobileNav();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={open ? "Close menu" : "Open menu"}
      aria-expanded={open}
      className={cn(
        "inline-flex h-11 w-11 items-center justify-center rounded-lg text-[hsl(var(--foreground))] transition-hover hover:bg-[hsl(var(--surface-raised))]",
        className
      )}
    >
      {open ? (
        <X size={20} strokeWidth={1.75} />
      ) : (
        <Menu size={20} strokeWidth={1.75} />
      )}
    </button>
  );
}

export function MobileNavDrawer({ children }: { children: ReactNode }) {
  const { open, setOpen } = useMobileNav();
  const t = useTranslations("primary_nav");

  return (
    <div className="md:hidden" aria-hidden={!open}>
      {/* Backdrop. inset-0 + fixed so it covers everything; pointer-events
          gate avoids it eating taps when the drawer is closed. */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/50 transition-opacity duration-200",
          open ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        onClick={() => setOpen(false)}
        aria-hidden
      />
      {/* Drawer. Slides in from the left; max-w-[85vw] keeps a sliver of
          the page visible behind it as a "you can dismiss" affordance. */}
      <aside
        role="dialog"
        aria-modal={open}
        aria-label={t("aria_label")}
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col bg-[hsl(var(--background))] shadow-2xl transition-transform duration-200 ease-out",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {children}
      </aside>
    </div>
  );
}

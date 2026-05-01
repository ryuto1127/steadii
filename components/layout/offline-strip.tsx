"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";

export function OfflineStrip() {
  const t = useTranslations("offline_strip");
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (!offline) return null;

  return (
    <div className="sticky top-0 z-40 flex items-center justify-center gap-2 bg-[hsl(var(--destructive))] px-4 py-1.5 text-center text-small text-[hsl(var(--primary-foreground))]">
      <RefreshCw size={12} strokeWidth={1.5} aria-hidden />
      <span>{t("message")}</span>
    </div>
  );
}

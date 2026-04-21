"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

// Re-key the children on pathname change so React remounts the subtree,
// replaying the fade-in keyframe. Gives a cheap "page transition" feel
// without JS-controlled View Transitions API plumbing.
export function RouteTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="route-fade-in">
      {children}
    </div>
  );
}

"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ReactNode } from "react";

// next-themes upstream warning under React 19 / Next 16: "Encountered a script
// tag while rendering React component." Harmless (FOUC script still runs) and
// has no userland fix. Tracking: https://github.com/pacocoursey/next-themes/issues/387
export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}

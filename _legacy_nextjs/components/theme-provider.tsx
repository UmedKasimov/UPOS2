"use client";

import * as React from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";

import { APP_THEMES } from "@/lib/themes";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      themes={[...APP_THEMES]}
      enableSystem={false}
      disableTransitionOnChange
      storageKey="upos-finance-theme"
    >
      {children}
    </NextThemesProvider>
  );
}

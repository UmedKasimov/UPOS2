import type * as React from "react";

import { AppSidebar } from "@/components/shell/app-sidebar";
import { cn } from "@/lib/utils";

export function DashboardFrame({
  variant,
  title,
  description,
  children,
}: {
  variant: "user" | "admin";
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-background flex min-h-full">
      <AppSidebar variant={variant} />
      <div className="flex min-h-full min-w-0 flex-1 flex-col">
        <header className="border-border bg-background/80 supports-[backdrop-filter]:bg-background/60 sticky top-0 z-10 border-b px-8 py-6 backdrop-blur-md">
          <h1 className="text-foreground text-xl font-semibold tracking-tight">
            {title}
          </h1>
          {description ? (
            <p className="text-muted-foreground mt-1 max-w-2xl text-sm leading-relaxed">
              {description}
            </p>
          ) : null}
        </header>
        <main className={cn("flex-1 px-8 py-8")}>{children}</main>
      </div>
    </div>
  );
}

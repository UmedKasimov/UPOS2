import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Вход и регистрация",
};

export default function AuthLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="from-background via-background relative flex min-h-full flex-col bg-gradient-to-b to-[color-mix(in_oklch,var(--muted)_35%,transparent)]">
      <Link
        href="/"
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring absolute top-4 left-4 rounded-md text-sm font-medium outline-none focus-visible:ring-2 md:top-6 md:left-6"
      >
        На главную
      </Link>
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-16">
        {children}
      </div>
    </div>
  );
}

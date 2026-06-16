"use client";

import {
  ArrowLeftRight,
  LayoutDashboard,
  LogOut,
  Settings,
  Shield,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";

import { BrandWordmark } from "@/components/brand-wordmark";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
};

const userNav: NavItem[] = [
  { href: "/", label: "Главная", icon: LayoutDashboard },
  { href: "/settings", label: "Настройки", icon: Settings },
];

const adminNav: NavItem[] = [
  { href: "/admin", label: "Обзор", icon: Shield },
  { href: "/admin/settings", label: "Настройки", icon: Settings },
];

export function AppSidebar({
  variant,
  className,
}: {
  variant: "user" | "admin";
  className?: string;
}) {
  const pathname = usePathname();
  const { data: session, status } = useSession();
  const nav = variant === "admin" ? adminNav : userNav;
  const subtitle =
    variant === "admin"
      ? "Администрирование платформы."
      : "Обзор бизнеса и финансов.";

  const displayName =
    session?.user?.name?.trim() ||
    session?.user?.email?.split("@")[0] ||
    null;

  return (
    <aside
      className={cn(
        "border-sidebar-border bg-sidebar text-sidebar-foreground flex h-full w-64 shrink-0 flex-col border-r",
        className,
      )}
    >
      <div className="border-sidebar-border border-b px-4 py-5">
        <BrandWordmark href={variant === "admin" ? "/admin" : "/"} subtitle={subtitle} />
      </div>
      <nav className="flex flex-1 flex-col gap-1 p-3" aria-label="Основная навигация">
        {nav.map(({ href, label, icon: Icon }) => {
          const active =
            href === "/"
              ? pathname === "/"
              : pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-sidebar-ring flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium outline-none transition-colors focus-visible:ring-2",
                active &&
                  "bg-sidebar-accent text-sidebar-accent-foreground font-semibold",
              )}
            >
              <Icon className="size-4 shrink-0 opacity-80" aria-hidden />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="border-sidebar-border mt-auto border-t p-3">
        {status === "loading" ? (
          <div className="bg-muted mx-1 h-14 animate-pulse rounded-lg" />
        ) : session?.user ? (
          <div className="flex flex-col gap-2">
            <div className="min-w-0 px-1">
              <p
                className="truncate text-sm leading-tight font-semibold"
                title={displayName ?? undefined}
              >
                {displayName ?? "Профиль"}
              </p>
              {session.user.email ? (
                <p
                  className="text-muted-foreground truncate text-[11px] leading-snug"
                  title={session.user.email}
                >
                  {session.user.email}
                </p>
              ) : null}
            </div>
            {variant === "admin" ? (
              <Link
                href="/"
                className="text-muted-foreground hover:text-foreground focus-visible:ring-ring flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium outline-none transition-colors focus-visible:ring-2"
              >
                <ArrowLeftRight className="size-4 shrink-0" aria-hidden />
                Рабочее место
              </Link>
            ) : null}
            <button
              type="button"
              onClick={() =>
                signOut({
                  callbackUrl: "/auth",
                })
              }
              className="text-muted-foreground hover:text-foreground focus-visible:ring-ring flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium outline-none transition-colors focus-visible:ring-2"
            >
              <LogOut className="size-4 shrink-0" aria-hidden />
              Выйти
            </button>
          </div>
        ) : null}
      </div>
    </aside>
  );
}

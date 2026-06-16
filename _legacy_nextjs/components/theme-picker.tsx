"use client";

import { Leaf, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AppThemeId } from "@/lib/themes";

const OPTIONS: {
  id: AppThemeId;
  label: string;
  description: string;
  Icon: typeof Sun;
}[] = [
  {
    id: "light",
    label: "Светлая",
    description: "Нейтральная палитра для дневной работы.",
    Icon: Sun,
  },
  {
    id: "dark",
    label: "Тёмная",
    description: "Контрастная тёмная тема в стиле U-POS.",
    Icon: Moon,
  },
  {
    id: "emerald",
    label: "Изумрудная",
    description: "Спокойные зелёные акценты для финансовых данных.",
    Icon: Leaf,
  },
];

export function ThemePicker({
  variant = "full",
}: {
  variant?: "full" | "minimal";
}) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    queueMicrotask(() => setMounted(true));
  }, []);

  if (!mounted) {
    if (variant === "minimal") {
      return (
        <div
          className="bg-muted h-9 w-[104px] animate-pulse rounded-lg"
          aria-hidden
        />
      );
    }
    return (
      <div className="grid gap-3 sm:grid-cols-3">
        {OPTIONS.map(({ id }) => (
          <div
            key={id}
            className="h-[88px] animate-pulse rounded-xl bg-muted sm:h-[104px]"
          />
        ))}
      </div>
    );
  }

  const active = theme ?? "dark";

  if (variant === "minimal") {
    return (
      <div
        role="radiogroup"
        aria-label="Тема интерфейса"
        className="border-border bg-muted/25 inline-flex gap-0.5 rounded-lg border p-0.5"
      >
        {OPTIONS.map(({ id, label, Icon }) => {
          const selected = active === id;
          return (
            <Button
              key={id}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={label}
              title={label}
              variant={selected ? "default" : "ghost"}
              size="icon-sm"
              className={cn(
                "size-8 shrink-0 rounded-md shadow-none [&_svg]:size-[17px]",
                !selected && "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setTheme(id)}
            >
              <Icon aria-hidden />
            </Button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {OPTIONS.map(({ id, label, description, Icon }) => {
        const selected = active === id;
        return (
          <Button
            key={id}
            type="button"
            variant={selected ? "default" : "outline"}
            className="h-auto flex-col items-start gap-2 py-4 text-left whitespace-normal sm:min-h-[104px]"
            onClick={() => setTheme(id)}
          >
            <span className="flex w-full items-center gap-2 font-semibold">
              <Icon className="size-4 shrink-0" aria-hidden />
              {label}
            </span>
            <span className="text-muted-foreground text-xs font-normal leading-snug">
              {description}
            </span>
          </Button>
        );
      })}
    </div>
  );
}

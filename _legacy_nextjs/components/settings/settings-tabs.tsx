"use client";

import { Bell } from "lucide-react";
import * as React from "react";

import { IntegrationPanels } from "@/components/settings/integration-panels";
import { ThemePicker } from "@/components/theme-picker";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SETTINGS_STORAGE_KEYS } from "@/lib/settings-storage";

export function SettingsTabs({
  context,
}: {
  context: "user" | "admin";
}) {
  const [telegramToken, setTelegramToken] = React.useState("");
  const [telegramSaved, setTelegramSaved] = React.useState(false);

  React.useEffect(() => {
    queueMicrotask(() => {
      const stored = window.localStorage.getItem(
        SETTINGS_STORAGE_KEYS.telegramBotToken,
      );
      if (stored) setTelegramToken(stored);
    });
  }, []);

  const hintIntro =
    context === "admin"
      ? "Общие параметры экрана администратора."
      : "Персонализация и каналы оповещений для вашего рабочего места.";

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Tabs defaultValue="general" orientation="horizontal">
        <TabsList variant="line" className="mb-4">
          <TabsTrigger value="general">Основное</TabsTrigger>
          <TabsTrigger value="integrations">Интеграции</TabsTrigger>
        </TabsList>
        <TabsContent value="general" className="flex flex-col gap-6">
          <div className="border-border flex items-center justify-between gap-4 rounded-xl border px-4 py-2.5">
            <span className="text-muted-foreground text-sm">Тема</span>
            <ThemePicker variant="minimal" />
          </div>

          <Card>
            <CardHeader className="space-y-1">
              <div className="flex items-center gap-2">
                <Bell className="text-muted-foreground size-4" aria-hidden />
                <CardTitle>Уведомления</CardTitle>
              </div>
              <CardDescription>
                Токен бота Telegram для отчётов по бизнесу и серверных
                уведомлений (алерты, сводки, ошибки интеграций). Создайте бота
                через @BotFather и вставьте токен здесь.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="space-y-2">
                <Label htmlFor="telegram-bot-token">Токен Telegram-бота</Label>
                <Input
                  id="telegram-bot-token"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Например: 123456789:AAHe..."
                  value={telegramToken}
                  onChange={(e) => setTelegramToken(e.target.value)}
                />
              </div>
              <Button
                type="button"
                className="w-fit"
                onClick={() => {
                  window.localStorage.setItem(
                    SETTINGS_STORAGE_KEYS.telegramBotToken,
                    telegramToken.trim(),
                  );
                  setTelegramSaved(true);
                  window.setTimeout(() => setTelegramSaved(false), 4000);
                }}
              >
                Сохранить
              </Button>
              {telegramSaved ? (
                <p className="text-muted-foreground text-xs" role="status">
                  Токен записан только в этом браузере. Для продакшена он будет
                  храниться на сервере и не попадёт в Git.
                </p>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="integrations" className="flex flex-col gap-4">
          <p className="text-muted-foreground text-sm leading-relaxed">
            {hintIntro} Здесь задаются параметры обмена с внешними системами — пока
            только каркас форм и локальное сохранение; позже подключим проверку и
            синхронизацию на сервере.
          </p>
          <Separator />
          <IntegrationPanels />
        </TabsContent>
      </Tabs>
    </div>
  );
}

"use client";

import { useSearchParams } from "next/navigation";
import * as React from "react";

import { AdminCredentialsForm } from "@/components/auth/admin-credentials-form";
import { BrandWordmark } from "@/components/brand-wordmark";
import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";
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
import { safeRelativeCallback } from "@/lib/callback-url";

const AUTH_ERRORS: Record<string, string> = {
  Configuration:
    "Проверьте файл .env.local: AUTH_SECRET, AUTH_GOOGLE_ID и AUTH_GOOGLE_SECRET.",
  AccessDenied: "Вход отменён или доступ запрещён.",
  Verification: "Ссылка для входа устарела. Попробуйте снова.",
  OAuthSignin: "Не удалось начать вход через Google.",
  OAuthCallback: "Ошибка ответа от Google после входа.",
  OAuthCreateAccount: "Не удалось создать аккаунт через Google.",
  Callback: "Ошибка обработки входа (callback).",
  Default: "Не удалось выполнить вход. Попробуйте ещё раз.",
};

export function AuthScreen() {
  const searchParams = useSearchParams();
  const errorCode = searchParams.get("error");
  const errorMessage = errorCode
    ? (AUTH_ERRORS[errorCode] ?? AUTH_ERRORS.Default)
    : null;

  const callbackRaw = searchParams.get("callbackUrl");
  const afterLoginPath = safeRelativeCallback(callbackRaw);

  const [formNotice, setFormNotice] = React.useState<string | null>(null);

  const flashNotice = (msg: string) => {
    setFormNotice(msg);
    window.setTimeout(() => setFormNotice(null), 6000);
  };

  return (
    <div className="flex w-full max-w-[440px] flex-col items-center gap-8">
      <BrandWordmark href="/" />

      <Card className="ring-border/80 w-full shadow-lg ring-1">
        <CardHeader className="space-y-1 text-center">
          <CardTitle className="text-xl font-semibold tracking-tight">
            Доступ к UPOS Finance
          </CardTitle>
          <CardDescription className="text-balance">
            Вход только после авторизации. Через Google создаётся аккаунт при первом
            входе; пароль по почте подключим позже.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {errorMessage ? (
            <p
              className="border-destructive/40 bg-destructive/10 text-destructive mb-5 rounded-lg border px-3 py-2 text-xs leading-relaxed"
              role="alert"
            >
              {errorMessage}
              {errorCode ? (
                <span className="text-muted-foreground mt-1 block font-mono text-[0.7rem]">
                  Код: {errorCode}
                </span>
              ) : null}
            </p>
          ) : null}

          <Tabs defaultValue="signin">
            <TabsList variant="line" className="mb-6 grid w-full grid-cols-2">
              <TabsTrigger value="signin">Вход</TabsTrigger>
              <TabsTrigger value="signup">Регистрация</TabsTrigger>
            </TabsList>

            <TabsContent value="signin" className="flex flex-col gap-5">
              <GoogleSignInButton
                label="Войти через Google"
                callbackUrl={afterLoginPath}
              />

              <div className="flex items-center gap-3">
                <Separator className="flex-1" />
                <span className="text-muted-foreground text-xs">или</span>
                <Separator className="flex-1" />
              </div>

              <form
                className="flex flex-col gap-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  flashNotice(
                    "Вход по паролю появится после подключения базы и API. Пока используйте Google.",
                  );
                }}
              >
                <div className="space-y-2">
                  <Label htmlFor="signin-email">Электронная почта</Label>
                  <Input
                    id="signin-email"
                    type="email"
                    autoComplete="email"
                    required
                    placeholder="you@company.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signin-password">Пароль</Label>
                  <Input
                    id="signin-password"
                    type="password"
                    autoComplete="current-password"
                    required
                    placeholder="••••••••"
                  />
                </div>
                <label className="text-muted-foreground flex cursor-pointer items-center gap-2 text-xs">
                  <input type="checkbox" className="accent-primary size-3.5" />
                  Запомнить это устройство
                </label>
                <Button type="submit" className="w-full">
                  Войти
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="signup" className="flex flex-col gap-5">
              <GoogleSignInButton
                label="Зарегистрироваться через Google"
                callbackUrl={afterLoginPath}
              />

              <div className="flex items-center gap-3">
                <Separator className="flex-1" />
                <span className="text-muted-foreground text-xs">или</span>
                <Separator className="flex-1" />
              </div>

              <form
                className="flex flex-col gap-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  const p = String(fd.get("sup-password") ?? "");
                  const p2 = String(fd.get("sup-password2") ?? "");
                  if (p !== p2) {
                    flashNotice("Пароли не совпадают.");
                    return;
                  }
                  flashNotice(
                    "Регистрация по почте и паролю будет доступна после бэкенда. Пока создайте аккаунт через Google.",
                  );
                }}
              >
                <div className="space-y-2">
                  <Label htmlFor="sup-name">Имя и фамилия</Label>
                  <Input
                    id="sup-name"
                    name="sup-name"
                    autoComplete="name"
                    required
                    placeholder="Иван Иванов"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sup-email">Электронная почта</Label>
                  <Input
                    id="sup-email"
                    name="sup-email"
                    type="email"
                    autoComplete="email"
                    required
                    placeholder="you@company.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sup-password">Пароль</Label>
                  <Input
                    id="sup-password"
                    name="sup-password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    placeholder="Не менее 8 символов"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sup-password2">Повтор пароля</Label>
                  <Input
                    id="sup-password2"
                    name="sup-password2"
                    type="password"
                    autoComplete="new-password"
                    required
                    placeholder="Повторите пароль"
                  />
                </div>
                <Button type="submit" className="w-full">
                  Создать аккаунт
                </Button>
              </form>
            </TabsContent>
          </Tabs>

          <Separator className="my-6" />
          <AdminCredentialsForm />

          {formNotice ? (
            <p
              className="border-border bg-muted/40 text-muted-foreground mt-6 rounded-lg border px-3 py-2 text-xs leading-relaxed"
              role="status"
            >
              {formNotice}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

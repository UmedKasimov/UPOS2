"use client";

import { signIn } from "next-auth/react";
import { Shield } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function AdminCredentialsForm() {
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        setBusy(true);
        try {
          const res = await signIn("admin-credentials", {
            username,
            password,
            redirect: false,
            callbackUrl: "/admin",
          });
          if (res?.error) {
            setError("Неверный логин или пароль.");
            return;
          }
          if (res?.url) {
            window.location.href = res.url;
          } else {
            window.location.href = "/admin";
          }
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="flex items-center gap-2">
        <Shield className="text-muted-foreground size-4" aria-hidden />
        <span className="text-muted-foreground text-xs font-medium">
          Вход администратора (логин и пароль из .env.local)
        </span>
      </div>
      <div className="space-y-2">
        <Label htmlFor="admin-user">Логин</Label>
        <Input
          id="admin-user"
          name="username"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="admin-pass">Пароль</Label>
        <Input
          id="admin-pass"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>
      {error ? (
        <p className="text-destructive text-xs" role="alert">
          {error}
        </p>
      ) : null}
      <Button type="submit" variant="secondary" className="w-full" disabled={busy}>
        {busy ? "Вход…" : "Войти в админ-панель"}
      </Button>
    </form>
  );
}

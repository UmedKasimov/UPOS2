"use client";

import { ChevronDown } from "lucide-react";
import * as React from "react";

import {
  LogoIbox,
  LogoOneC,
  LogoYespos,
} from "@/components/settings/integration-logos";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  SETTINGS_STORAGE_KEYS,
  type IboxIntegrationForm,
  type OneCIntegrationForm,
  type YesposIntegrationForm,
} from "@/lib/settings-storage";

function SaveNotice({ ok }: { ok: boolean }) {
  if (!ok) return null;
  return (
    <p className="text-muted-foreground text-xs" role="status">
      Сохранено локально в браузере. Позже данные будут перенесены на сервер с
      шифрованием.
    </p>
  );
}

const empty1c: OneCIntegrationForm = { baseUrl: "", username: "", password: "" };
const emptyYespos: YesposIntegrationForm = { apiBaseUrl: "", apiKey: "" };
const emptyIbox: IboxIntegrationForm = {
  apiUrl: "",
  apiKey: "",
  terminalId: "",
};

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...JSON.parse(raw) } as T;
  } catch {
    return fallback;
  }
}

function IntegrationShell({
  logo,
  title,
  summary,
  apiHint,
  children,
}: {
  logo: React.ReactNode;
  title: string;
  summary: string;
  apiHint: string;
  children: React.ReactNode;
}) {
  return (
    <Collapsible className="border-border bg-card overflow-hidden rounded-xl border shadow-sm">
      <CollapsibleTrigger className="group hover:bg-muted/40 flex w-full items-center gap-4 px-4 py-3 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <div className="bg-muted/50 flex size-16 shrink-0 items-center justify-center rounded-lg">
          {logo}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-foreground font-semibold">{title}</div>
          <div className="text-muted-foreground mt-0.5 text-xs leading-snug">
            {summary}
          </div>
        </div>
        <ChevronDown className="text-muted-foreground size-5 shrink-0 transition-transform group-data-[panel-open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="border-border border-t px-4 pt-2 pb-4">
        <p className="text-muted-foreground mb-4 text-xs leading-relaxed">
          {apiHint}
        </p>
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function IntegrationPanels() {
  const [oneC, setOneC] = React.useState<OneCIntegrationForm>(empty1c);
  const [yespos, setYespos] = React.useState<YesposIntegrationForm>(emptyYespos);
  const [ibox, setIbox] = React.useState<IboxIntegrationForm>(emptyIbox);
  const [saved1c, setSaved1c] = React.useState(false);
  const [savedYespos, setSavedYespos] = React.useState(false);
  const [savedIbox, setSavedIbox] = React.useState(false);

  React.useEffect(() => {
    queueMicrotask(() => {
      setOneC(readJson(SETTINGS_STORAGE_KEYS.integration1c, empty1c));
      setYespos(readJson(SETTINGS_STORAGE_KEYS.integrationYespos, emptyYespos));
      setIbox(readJson(SETTINGS_STORAGE_KEYS.integrationIbox, emptyIbox));
    });
  }, []);

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <IntegrationShell
        logo={<LogoOneC className="h-9 w-auto max-w-[72px]" />}
        title="1С:Предприятие"
        summary="Учётная система и торговля через стандартный OData REST."
        apiHint={
          "После публикации информационной базы на веб-сервере (IIS или Apache) становится доступен интерфейс OData — обычно путь вида «…/odata/standard.odata/». Поддерживаются операции GET/POST/PATCH для справочников и документов; для сложных сценариев в конфигурации добавляют HTTP-сервисы. Укажите URL корня OData и учётные данные пользователя ИБ."
        }
      >
        <div className="flex flex-col gap-3">
          <div className="space-y-2">
            <Label htmlFor="onec-url">URL OData (корень)</Label>
            <Input
              id="onec-url"
              autoComplete="off"
              placeholder="https://server/im/your-base/odata/standard.odata/"
              value={oneC.baseUrl}
              onChange={(e) =>
                setOneC((s) => ({ ...s, baseUrl: e.target.value }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="onec-user">Пользователь</Label>
            <Input
              id="onec-user"
              autoComplete="username"
              value={oneC.username}
              onChange={(e) =>
                setOneC((s) => ({ ...s, username: e.target.value }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="onec-pass">Пароль</Label>
            <Input
              id="onec-pass"
              type="password"
              autoComplete="current-password"
              value={oneC.password}
              onChange={(e) =>
                setOneC((s) => ({ ...s, password: e.target.value }))
              }
            />
          </div>
          <Button
            type="button"
            className="mt-1 w-fit"
            onClick={() => {
              window.localStorage.setItem(
                SETTINGS_STORAGE_KEYS.integration1c,
                JSON.stringify(oneC),
              );
              setSaved1c(true);
              window.setTimeout(() => setSaved1c(false), 4000);
            }}
          >
            Сохранить
          </Button>
          <SaveNotice ok={saved1c} />
        </div>
      </IntegrationShell>

      <IntegrationShell
        logo={<LogoYespos className="h-9 w-auto max-w-[120px]" />}
        title="YESPOS"
        summary="POS и склад; доступ к API по подписке."
        apiHint={
          "YESPOS распространяется как PHP/jQuery-приложение с опциями месячной подписки на API. Точные endpoint и формат запросов задаёт поставщик после выдачи API-ключа. Укажите базовый URL вашего экземпляра и ключ из личного кабинета или договора."
        }
      >
        <div className="flex flex-col gap-3">
          <div className="space-y-2">
            <Label htmlFor="yespos-url">Базовый URL API</Label>
            <Input
              id="yespos-url"
              autoComplete="off"
              placeholder="https://your-domain.example/api/"
              value={yespos.apiBaseUrl}
              onChange={(e) =>
                setYespos((s) => ({ ...s, apiBaseUrl: e.target.value }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="yespos-key">API-ключ</Label>
            <Input
              id="yespos-key"
              type="password"
              autoComplete="off"
              value={yespos.apiKey}
              onChange={(e) =>
                setYespos((s) => ({ ...s, apiKey: e.target.value }))
              }
            />
          </div>
          <Button
            type="button"
            className="mt-1 w-fit"
            onClick={() => {
              window.localStorage.setItem(
                SETTINGS_STORAGE_KEYS.integrationYespos,
                JSON.stringify(yespos),
              );
              setSavedYespos(true);
              window.setTimeout(() => setSavedYespos(false), 4000);
            }}
          >
            Сохранить
          </Button>
          <SaveNotice ok={savedYespos} />
        </div>
      </IntegrationShell>

      <IntegrationShell
        logo={<LogoIbox className="h-9 w-auto max-w-[96px]" />}
        title="IBOX"
        summary="Фискальные терминалы и кассовое оборудование (конфигурация по договору)."
        apiHint={
          "Формат обмена зависит от модели ПО и регистратора (HTTP/JSON, проприетарные шлюзы и т.д.). Уточните у поставщика IBOX базовый URL шлюза, ключ доступа и при необходимости идентификатор терминала. Поля ниже — универсальный каркас до подключения официального SDK."
        }
      >
        <div className="flex flex-col gap-3">
          <div className="space-y-2">
            <Label htmlFor="ibox-url">URL шлюза API</Label>
            <Input
              id="ibox-url"
              autoComplete="off"
              placeholder="https://gateway.example/v1/"
              value={ibox.apiUrl}
              onChange={(e) =>
                setIbox((s) => ({ ...s, apiUrl: e.target.value }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ibox-key">Ключ / токен</Label>
            <Input
              id="ibox-key"
              type="password"
              autoComplete="off"
              value={ibox.apiKey}
              onChange={(e) =>
                setIbox((s) => ({ ...s, apiKey: e.target.value }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ibox-term">ID терминала (необязательно)</Label>
            <Input
              id="ibox-term"
              autoComplete="off"
              value={ibox.terminalId}
              onChange={(e) =>
                setIbox((s) => ({ ...s, terminalId: e.target.value }))
              }
            />
          </div>
          <Button
            type="button"
            className="mt-1 w-fit"
            onClick={() => {
              window.localStorage.setItem(
                SETTINGS_STORAGE_KEYS.integrationIbox,
                JSON.stringify(ibox),
              );
              setSavedIbox(true);
              window.setTimeout(() => setSavedIbox(false), 4000);
            }}
          >
            Сохранить
          </Button>
          <SaveNotice ok={savedIbox} />
        </div>
      </IntegrationShell>
    </div>
  );
}

# U-POS FINANCE

Веб-приложение для финансового учёта, кассы и отчётов: **FastAPI** (Python 3.11+), **PostgreSQL**, серверный рендер через **Jinja2** и страничный фронтенд на ванильном JavaScript/CSS.

## Структура репозитория

| Путь | Назначение |
|------|------------|
| [`pyweb/upos/`](pyweb/upos/) | Основное приложение (маршруты, шаблоны, статика, хранилища) |
| [`pyweb/requirements.txt`](pyweb/requirements.txt) | Зависимости Python |
| [`_legacy_nextjs/`](_legacy_nextjs/) | Устаревший фронтенд на Next.js (не является точкой входа для текущего продукта) |
| [`Dockerfile`](Dockerfile) | Образ для деплоя (копирует `pyweb`) |
| [`railway.toml`](railway.toml) | Конфигурация Railway (`/health`) |

Подробнее о переменных окружения: [`.env.example`](.env.example).

## Быстрый старт (локально)

1. Установите **PostgreSQL** и создайте базу (или используйте облачный инстанс).
2. Скопируйте [`.env.example`](.env.example) в **`pyweb/.env.local`** или **`.env.local` в корне репозитория** и задайте минимум:
   - `DATABASE_URL` — строка подключения `postgresql+psycopg://…` или стандартный `postgresql://…` / `postgres://…` (приложение нормализует схему драйвера).
   - `AUTH_SECRET` — секрет подписи cookie-сессии (в продакшене обязателен).
3. При **первом** запуске с пустой таблицей `users` задайте `ADMIN_BASIC_USER` и `ADMIN_BASIC_PASSWORD` — будет создан первый администратор (`bootstrap_from_env` в приложении).

**Windows:** из каталога `pyweb` запустите [`run.cmd`](pyweb/run.cmd) (создаёт venv, ставит зависимости, `uvicorn` с `--reload` на `127.0.0.1:3000`).

**Вручную:**

```bash
cd pyweb
python -m venv .venv
# активируйте venv под вашу ОС
pip install -r requirements.txt
python -m uvicorn upos.main:app --reload --reload-dir upos --host 127.0.0.1 --port 3000
```

Откройте в браузере: http://127.0.0.1:3000 — редирект на `/auth` или рабочий экран после входа.

## Деплой

Сборка из **корня** репозитория через [`Dockerfile`](Dockerfile): Uvicorn слушает `PORT` (по умолчанию 3000). Healthcheck: **`GET /health`**.

## Основная архитектура

- **Сессии:** подписанные cookie (`SessionMiddleware`), имя cookie `upos_finance_session`. В продакшене на Railway включается `Secure` для cookie при `RAILWAY_ENVIRONMENT=production` или `SESSION_HTTPS_ONLY=true`.
- **Доступ:** middleware редиректит неавторизованных на `/auth`; маршруты `/admin/*` только для `role == "admin"`; админам закрыты пользовательские экраны (`/schet`, `/kassa`, и т.д.) с редиректом на `/admin`.
- **Workspace:** данные изолированы по владельцу (`workspace_owner_id` или `user_id`); у сотрудников `workspace_owner_id` указывает на работодателя.
- **CSRF:** формы входа/настроек и изменяющие JSON API принимают токен (заголовок `X-CSRF-Token` или поле формы); актуальный токен: `GET /api/csrf-token`.

### Ключевые HTTP-маршруты

- **`/auth`**, **`POST /auth/login`**, **`POST /auth/logout`**
- Рабочий UI: **`/schet`**, **`/kassa`**, **`/reports`**, **`/settings`**, **`/employees`**
- API (фрагмент): **`/api/treasury`**, **`/api/transactions`**, **`/api/categories`**, **`/api/fx/rates`**, **`/api/integrations/greenwhite/*`**
- Админ: **`/admin`**, **`/admin/settings`**, **`/admin/users`**
- Диагностика: **`/health`**, **`/health/db`** (наличие ожидаемых таблиц в `public`)

### Данные и код

| Модуль | Роль |
|--------|------|
| [`pyweb/upos/db.py`](pyweb/upos/db.py) | Подключение PostgreSQL, `init_db()`, пул соединений |
| [`pyweb/upos/db_models.py`](pyweb/upos/db_models.py) | SQLAlchemy-модели |
| [`pyweb/upos/transactions_store.py`](pyweb/upos/transactions_store.py) | Операции, категории, отчёт P/L, движения по счетам, связь с проводками |
| [`pyweb/upos/treasury_store.py`](pyweb/upos/treasury_store.py) | «Казна»: счета, остатки по валютам (`FinanceAccount` / `AccountBalance`), метаданные в `Treasury`, **`apply_transaction_posting`** для подтверждённых операций |
| [`pyweb/upos/users_store.py`](pyweb/upos/users_store.py) | Пользователи, bcrypt, админы, сотрудники, payload сессии |
| [`pyweb/upos/main.py`](pyweb/upos/main.py) | Сборка `FastAPI`-приложения и все маршруты |

Одноразовый импорт из старых локальных JSON (если были): см. комментарий в `.env.example` для `python -m upos.migrate_json_to_postgres`.

## Telegram-уведомления

Вкладка **Настройки → Telegram уведомление** (только для генерального директора бизнеса).

1. Задайте **`AUTH_URL`** — публичный HTTPS-адрес приложения (тот же домен, что открываете в браузере). Без него webhook Telegram не регистрируется.
2. Вставьте токен бота → **Проверить**. Отобразятся имя и `@username` бота.
3. Добавьте бота в группу Telegram и назначьте **администратором**. Группа появится в списке (только чаты, где бот — админ).
4. Включите галочку у нужных групп — туда уйдут отчёты.
5. Сотрудники пишут боту `/start`, отправляют контакт; заявка появляется во вкладке **Ожидают** — одобряет генеральный директор.

**Что приходит автоматически:**

- Каждая **подтверждённая** операция в кассе (тип, сумма, счета, автор, контрагент).
- **Ежедневный** итог в **21:00** по часовому поясу организации.

**Тестовые отчёты** — кнопки на той же вкладке (не нужно ждать операцию или конец дня).

**Локальная разработка:** webhook на `localhost` не работает; для проверки бота используйте тест-кнопки или туннель (ngrok) с `AUTH_URL` на публичный URL.

**Ускорение старта на продакшене:** после первого успешного деплоя задайте `UPOS_SKIP_SCHEMA_ALIGN=1` (см. [`.env.example`](.env.example)). Диагностика: `GET /health` и `GET /health/db` (поле `startup_ms` — время этапов `init_db`).

## Разработка

- DDL-ориентир: [`pyweb/upos/schema_postgres.sql`](pyweb/upos/schema_postgres.sql); при старте вызывается `Base.metadata.create_all` и (если не отключено) выравнивание колонок ([`pg_schema_align.py`](pyweb/upos/pg_schema_align.py)).
- В репозитории **нет** набора автотестов (`pytest`/`unittest`); регрессии проверяйте ручными сценариями по экранам и API выше.

## Лицензия и вклад

Уточните у владельца репозитория условия использования и процесс код-ревью.

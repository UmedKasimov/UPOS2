-- UPOS FINANCE — схема PostgreSQL (схема public).
-- При старте приложения также вызывается SQLAlchemy create_all + pg_schema_align
-- (только ADD COLUMN IF NOT EXISTS, без DROP). Этот файл — для ручного применения в Query Railway.
-- Повторный запуск безопасен благодаря IF NOT EXISTS (кроме уникальных конфликтов при ручном редактировании).

BEGIN;

CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(36) PRIMARY KEY,
    account_id VARCHAR(5),
    username VARCHAR(64) NOT NULL,
    email VARCHAR(320),
    password_hash TEXT NOT NULL,
    name VARCHAR(160) NOT NULL,
    role VARCHAR(16) NOT NULL DEFAULT 'user',
    superuser BOOLEAN NOT NULL DEFAULT false,
    is_frozen BOOLEAN NOT NULL DEFAULT false,
    employer_user_id VARCHAR(36) REFERENCES users (id) ON DELETE CASCADE,
    organization_id VARCHAR(36),
    position VARCHAR(160) NOT NULL DEFAULT '',
    staff_role VARCHAR(32) NOT NULL DEFAULT 'viewer',
    employee_role_id VARCHAR(36),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_users_account_id UNIQUE (account_id),
    CONSTRAINT uq_users_username UNIQUE (username),
    CONSTRAINT uq_users_email UNIQUE (email)
);

CREATE TABLE IF NOT EXISTS roles (
    id VARCHAR(36) PRIMARY KEY,
    workspace_owner_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    key VARCHAR(40) NOT NULL,
    name VARCHAR(120) NOT NULL,
    permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_system BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_roles_workspace_key UNIQUE (workspace_owner_id, key)
);

CREATE TABLE IF NOT EXISTS organizations (
    id VARCHAR(36) PRIMARY KEY,
    owner_user_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name VARCHAR(160) NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    is_default BOOLEAN NOT NULL DEFAULT false,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_organizations_owner_name UNIQUE (owner_user_id, name)
);

CREATE TABLE IF NOT EXISTS employee_organizations (
    employee_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    organization_id VARCHAR(36) NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (employee_id, organization_id)
);

CREATE TABLE IF NOT EXISTS workspace_settings (
    workspace_owner_id VARCHAR(36) PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS treasuries (
    workspace_owner_id VARCHAR(36) PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS global_settings (
    key VARCHAR(80) PRIMARY KEY,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS finance_accounts (
    id VARCHAR(36) PRIMARY KEY,
    workspace_owner_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name VARCHAR(160) NOT NULL,
    kind VARCHAR(40) NOT NULL DEFAULT 'custom',
    icon VARCHAR(80) NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    owner_employee_id VARCHAR(36) REFERENCES users (id) ON DELETE SET NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_finance_accounts_workspace_name UNIQUE (workspace_owner_id, name)
);

CREATE TABLE IF NOT EXISTS employee_account_access (
    employee_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    account_id VARCHAR(36) NOT NULL REFERENCES finance_accounts (id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (employee_id, account_id)
);

CREATE TABLE IF NOT EXISTS account_balances (
    id VARCHAR(36) PRIMARY KEY,
    account_id VARCHAR(36) NOT NULL REFERENCES finance_accounts (id) ON DELETE CASCADE,
    currency VARCHAR(3) NOT NULL,
    amount NUMERIC(18, 2) NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_account_balances_account_currency UNIQUE (account_id, currency)
);

CREATE TABLE IF NOT EXISTS finance_categories (
    id VARCHAR(36) PRIMARY KEY,
    workspace_owner_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name VARCHAR(160) NOT NULL,
    type VARCHAR(20) NOT NULL DEFAULT 'expense',
    parent_id VARCHAR(36) REFERENCES finance_categories (id) ON DELETE SET NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_finance_categories_workspace_type_name UNIQUE (workspace_owner_id, type, name)
);

CREATE TABLE IF NOT EXISTS counterparties (
    id VARCHAR(36) PRIMARY KEY,
    workspace_owner_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    kind VARCHAR(20) NOT NULL DEFAULT 'client',
    name VARCHAR(255) NOT NULL,
    tax_id VARCHAR(64) NOT NULL DEFAULT '',
    phone VARCHAR(64) NOT NULL DEFAULT '',
    external_source VARCHAR(40) NOT NULL DEFAULT '',
    external_id VARCHAR(180) NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_counterparties_external UNIQUE (workspace_owner_id, external_source, external_id)
);

CREATE TABLE IF NOT EXISTS branches (
    id VARCHAR(36) PRIMARY KEY,
    workspace_owner_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    external_source VARCHAR(40) NOT NULL DEFAULT '',
    external_id VARCHAR(180) NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_branches_external UNIQUE (workspace_owner_id, external_source, external_id)
);

CREATE TABLE IF NOT EXISTS transactions (
    id VARCHAR(36) PRIMARY KEY,
    workspace_owner_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    number INTEGER NOT NULL,
    amount NUMERIC(18, 2) NOT NULL DEFAULT 0,
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    client VARCHAR(255),
    employee_id VARCHAR(36) REFERENCES users (id) ON DELETE SET NULL,
    from_pocket_id VARCHAR(36),
    to_pocket_id VARCHAR(36),
    from_account_id VARCHAR(36) REFERENCES finance_accounts (id) ON DELETE SET NULL,
    to_account_id VARCHAR(36) REFERENCES finance_accounts (id) ON DELETE SET NULL,
    month VARCHAR(20),
    type VARCHAR(20) NOT NULL DEFAULT 'income',
    is_confirmed BOOLEAN NOT NULL DEFAULT true,
    status VARCHAR(20) NOT NULL DEFAULT 'confirmed',
    requires_confirmation BOOLEAN NOT NULL DEFAULT false,
    confirmed_by VARCHAR(36) REFERENCES users (id) ON DELETE SET NULL,
    confirmed_at TIMESTAMPTZ,
    category VARCHAR(100),
    category_id VARCHAR(36) REFERENCES finance_categories (id) ON DELETE SET NULL,
    counterparty_id VARCHAR(36) REFERENCES counterparties (id) ON DELETE SET NULL,
    branch_id VARCHAR(36) REFERENCES branches (id) ON DELETE SET NULL,
    branch VARCHAR(100),
    supplier VARCHAR(255),
    note TEXT,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_transactions_workspace_number UNIQUE (workspace_owner_id, number)
);

CREATE TABLE IF NOT EXISTS transaction_entries (
    id VARCHAR(36) PRIMARY KEY,
    transaction_id VARCHAR(36) NOT NULL REFERENCES transactions (id) ON DELETE CASCADE,
    account_id VARCHAR(36) NOT NULL REFERENCES finance_accounts (id) ON DELETE CASCADE,
    direction VARCHAR(10) NOT NULL,
    currency VARCHAR(3) NOT NULL,
    amount NUMERIC(18, 2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS external_records (
    id VARCHAR(36) PRIMARY KEY,
    workspace_owner_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    integration VARCHAR(40) NOT NULL,
    entity_type VARCHAR(80) NOT NULL,
    external_id VARCHAR(180) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    payload_hash VARCHAR(64) NOT NULL DEFAULT '',
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_external_records_identity UNIQUE (
        workspace_owner_id,
        integration,
        entity_type,
        external_id
    )
);

CREATE TABLE IF NOT EXISTS integration_sync_runs (
    id VARCHAR(36) PRIMARY KEY,
    workspace_owner_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    integration VARCHAR(40) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'running',
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    imported_count INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS products (
    id VARCHAR(36) PRIMARY KEY,
    workspace_owner_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    sku VARCHAR(100) NOT NULL DEFAULT '',
    barcode VARCHAR(100) NOT NULL DEFAULT '',
    external_source VARCHAR(40) NOT NULL DEFAULT '',
    external_id VARCHAR(180) NOT NULL DEFAULT '',
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_products_external UNIQUE (workspace_owner_id, external_source, external_id)
);

CREATE TABLE IF NOT EXISTS warehouses (
    id VARCHAR(36) PRIMARY KEY,
    workspace_owner_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    branch_id VARCHAR(36) REFERENCES branches (id) ON DELETE SET NULL,
    external_source VARCHAR(40) NOT NULL DEFAULT '',
    external_id VARCHAR(180) NOT NULL DEFAULT '',
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_warehouses_external UNIQUE (workspace_owner_id, external_source, external_id)
);

CREATE TABLE IF NOT EXISTS sale_documents (
    id VARCHAR(36) PRIMARY KEY,
    workspace_owner_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    number VARCHAR(100) NOT NULL DEFAULT '',
    amount NUMERIC(18, 2) NOT NULL DEFAULT 0,
    currency VARCHAR(3) NOT NULL DEFAULT 'UZS',
    counterparty_id VARCHAR(36) REFERENCES counterparties (id) ON DELETE SET NULL,
    branch_id VARCHAR(36) REFERENCES branches (id) ON DELETE SET NULL,
    external_source VARCHAR(40) NOT NULL DEFAULT '',
    external_id VARCHAR(180) NOT NULL DEFAULT '',
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_sale_documents_external UNIQUE (workspace_owner_id, external_source, external_id)
);

CREATE TABLE IF NOT EXISTS purchase_documents (
    id VARCHAR(36) PRIMARY KEY,
    workspace_owner_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    number VARCHAR(100) NOT NULL DEFAULT '',
    amount NUMERIC(18, 2) NOT NULL DEFAULT 0,
    currency VARCHAR(3) NOT NULL DEFAULT 'UZS',
    counterparty_id VARCHAR(36) REFERENCES counterparties (id) ON DELETE SET NULL,
    branch_id VARCHAR(36) REFERENCES branches (id) ON DELETE SET NULL,
    external_source VARCHAR(40) NOT NULL DEFAULT '',
    external_id VARCHAR(180) NOT NULL DEFAULT '',
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_purchase_documents_external UNIQUE (workspace_owner_id, external_source, external_id)
);

CREATE TABLE IF NOT EXISTS payment_documents (
    id VARCHAR(36) PRIMARY KEY,
    workspace_owner_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    number VARCHAR(100) NOT NULL DEFAULT '',
    amount NUMERIC(18, 2) NOT NULL DEFAULT 0,
    currency VARCHAR(3) NOT NULL DEFAULT 'UZS',
    counterparty_id VARCHAR(36) REFERENCES counterparties (id) ON DELETE SET NULL,
    transaction_id VARCHAR(36) REFERENCES transactions (id) ON DELETE SET NULL,
    direction VARCHAR(10) NOT NULL DEFAULT 'in',
    external_source VARCHAR(40) NOT NULL DEFAULT '',
    external_id VARCHAR(180) NOT NULL DEFAULT '',
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_payment_documents_external UNIQUE (workspace_owner_id, external_source, external_id)
);

CREATE TABLE IF NOT EXISTS expense_documents (
    id VARCHAR(36) PRIMARY KEY,
    workspace_owner_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    number VARCHAR(100) NOT NULL DEFAULT '',
    amount NUMERIC(18, 2) NOT NULL DEFAULT 0,
    currency VARCHAR(3) NOT NULL DEFAULT 'UZS',
    category_id VARCHAR(36) REFERENCES finance_categories (id) ON DELETE SET NULL,
    counterparty_id VARCHAR(36) REFERENCES counterparties (id) ON DELETE SET NULL,
    transaction_id VARCHAR(36) REFERENCES transactions (id) ON DELETE SET NULL,
    external_source VARCHAR(40) NOT NULL DEFAULT '',
    external_id VARCHAR(180) NOT NULL DEFAULT '',
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_expense_documents_external UNIQUE (workspace_owner_id, external_source, external_id)
);

CREATE TABLE IF NOT EXISTS telegram_bot_configs (
    workspace_owner_id VARCHAR(36) PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    bot_token TEXT NOT NULL DEFAULT '',
    bot_id BIGINT NULL,
    bot_username VARCHAR(80) NOT NULL DEFAULT '',
    bot_first_name VARCHAR(160) NOT NULL DEFAULT '',
    webhook_secret VARCHAR(64) NOT NULL DEFAULT '',
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_error TEXT NULL,
    notification_prefs JSONB NOT NULL DEFAULT '{}'::jsonb,
    connected_at TIMESTAMPTZ NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS telegram_chats (
    id VARCHAR(36) PRIMARY KEY,
    workspace_owner_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    chat_id BIGINT NOT NULL,
    chat_type VARCHAR(32) NOT NULL DEFAULT 'group',
    title VARCHAR(255) NOT NULL DEFAULT '',
    bot_is_admin BOOLEAN NOT NULL DEFAULT false,
    is_enabled BOOLEAN NOT NULL DEFAULT false,
    discovered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_telegram_chats_workspace_chat UNIQUE (workspace_owner_id, chat_id)
);

CREATE TABLE IF NOT EXISTS telegram_subscribers (
    id VARCHAR(36) PRIMARY KEY,
    workspace_owner_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    telegram_user_id BIGINT NOT NULL,
    chat_id BIGINT NOT NULL,
    display_name VARCHAR(255) NOT NULL DEFAULT '',
    username VARCHAR(80) NOT NULL DEFAULT '',
    phone VARCHAR(40) NOT NULL DEFAULT '',
    contact_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_by_user_id VARCHAR(36) REFERENCES users (id) ON DELETE SET NULL,
    decided_at TIMESTAMPTZ NULL,
    CONSTRAINT uq_telegram_subscribers_workspace_user UNIQUE (workspace_owner_id, telegram_user_id)
);

CREATE TABLE IF NOT EXISTS telegram_delivery_log (
    id VARCHAR(36) PRIMARY KEY,
    workspace_owner_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    kind VARCHAR(40) NOT NULL DEFAULT '',
    target_chat_id BIGINT NULL,
    dedupe_key VARCHAR(120) NOT NULL DEFAULT '',
    ok BOOLEAN NOT NULL DEFAULT false,
    error TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_telegram_delivery_log_dedupe
    ON telegram_delivery_log (workspace_owner_id, dedupe_key, created_at DESC);

CREATE TABLE IF NOT EXISTS user_auth_sessions (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    user_agent TEXT NOT NULL DEFAULT '',
    device_label VARCHAR(160) NOT NULL DEFAULT '',
    os_family VARCHAR(32) NOT NULL DEFAULT 'unknown',
    browser_family VARCHAR(40) NOT NULL DEFAULT '',
    device_type VARCHAR(20) NOT NULL DEFAULT 'desktop',
    ip_address VARCHAR(64) NOT NULL DEFAULT '',
    geo_label VARCHAR(120) NOT NULL DEFAULT '',
    client_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at TIMESTAMPTZ NULL,
    blocked_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS ix_user_auth_sessions_user_last_seen
    ON user_auth_sessions (user_id, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS hr_employees (
    id VARCHAR(36) PRIMARY KEY,
    workspace_owner_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    first_name VARCHAR(120) NOT NULL DEFAULT '',
    last_name VARCHAR(120) NOT NULL DEFAULT '',
    position VARCHAR(160) NOT NULL DEFAULT '',
    passport_series VARCHAR(16) NOT NULL DEFAULT '',
    passport_number VARCHAR(32) NOT NULL DEFAULT '',
    photo_path VARCHAR(255) NULL,
    monthly_salary NUMERIC(18, 2) NOT NULL DEFAULT 0,
    is_courier BOOLEAN NOT NULL DEFAULT false,
    status VARCHAR(24) NOT NULL DEFAULT 'active',
    hired_at VARCHAR(10) NOT NULL DEFAULT '',
    dismissed_at VARCHAR(10) NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hr_attendance (
    id VARCHAR(36) PRIMARY KEY,
    workspace_owner_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    employee_id VARCHAR(36) NOT NULL REFERENCES hr_employees (id) ON DELETE CASCADE,
    work_date VARCHAR(10) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'present',
    note TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_hr_attendance_employee_date UNIQUE (employee_id, work_date)
);

CREATE TABLE IF NOT EXISTS delivery_shipments (
    id VARCHAR(36) PRIMARY KEY,
    workspace_owner_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    number INTEGER NOT NULL,
    shipment_date VARCHAR(10) NOT NULL DEFAULT '',
    courier_name VARCHAR(255) NOT NULL DEFAULT '',
    employee_id VARCHAR(36) NULL REFERENCES hr_employees (id) ON DELETE SET NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'UZS',
    total_amount NUMERIC(18, 2) NOT NULL DEFAULT 0,
    paid_amount NUMERIC(18, 2) NOT NULL DEFAULT 0,
    debt_amount NUMERIC(18, 2) NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'open',
    note TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_delivery_shipments_workspace_number UNIQUE (workspace_owner_id, number)
);

CREATE TABLE IF NOT EXISTS delivery_shipment_items (
    id VARCHAR(36) PRIMARY KEY,
    shipment_id VARCHAR(36) NOT NULL REFERENCES delivery_shipments (id) ON DELETE CASCADE,
    product_name VARCHAR(255) NOT NULL DEFAULT '',
    quantity NUMERIC(18, 3) NOT NULL DEFAULT 1,
    amount NUMERIC(18, 2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_delivery_shipments_workspace_courier
    ON delivery_shipments (workspace_owner_id, courier_name, currency, shipment_date);

COMMIT;

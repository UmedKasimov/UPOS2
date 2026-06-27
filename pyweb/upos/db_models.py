from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    account_id: Mapped[str | None] = mapped_column(String(5), nullable=True, unique=True)
    username: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    email: Mapped[str | None] = mapped_column(String(320), nullable=True, unique=True)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False, default="user")
    superuser: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_frozen: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))
    avatar_path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    employer_user_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=True,
    )
    organization_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    position: Mapped[str] = mapped_column(String(160), nullable=False, default="")
    staff_role: Mapped[str] = mapped_column(String(32), nullable=False, default="viewer")
    employee_role_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class Organization(Base):
    __tablename__ = "organizations"
    __table_args__ = (
        UniqueConstraint("owner_user_id", "name", name="uq_organizations_owner_name"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(160), nullable=False, default="", server_default=text("''"))
    note: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default=text("''"))
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=text("true"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class EmployeeOrganization(Base):
    __tablename__ = "employee_organizations"

    employee_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        primary_key=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )


class EmployeeAccountAccess(Base):
    __tablename__ = "employee_account_access"

    employee_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    account_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("finance_accounts.id", ondelete="CASCADE"),
        primary_key=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )


class HrEmployee(Base):
    __tablename__ = "hr_employees"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    workspace_owner_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    first_name: Mapped[str] = mapped_column(String(120), nullable=False, default="", server_default=text("''"))
    last_name: Mapped[str] = mapped_column(String(120), nullable=False, default="", server_default=text("''"))
    position_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("positions.id", ondelete="SET NULL"),
        nullable=True,
    )
    position: Mapped[str] = mapped_column(String(160), nullable=False, default="", server_default=text("''"))
    passport_series: Mapped[str] = mapped_column(String(16), nullable=False, default="", server_default=text("''"))
    passport_number: Mapped[str] = mapped_column(String(32), nullable=False, default="", server_default=text("''"))
    photo_path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    monthly_salary: Mapped[object] = mapped_column(Numeric(18, 2), nullable=False, default=0, server_default=text("0"))
    is_courier: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="active", server_default=text("'active'"))
    hired_at: Mapped[str] = mapped_column(String(10), nullable=False, default="", server_default=text("''"))
    dismissed_at: Mapped[str] = mapped_column(String(10), nullable=False, default="", server_default=text("''"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class Position(Base):
    __tablename__ = "positions"
    __table_args__ = (
        UniqueConstraint("organization_id", "name", name="uq_positions_organization_name"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class HrAttendance(Base):
    __tablename__ = "hr_attendance"
    __table_args__ = (
        UniqueConstraint("employee_id", "work_date", name="uq_hr_attendance_employee_date"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    workspace_owner_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    employee_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("hr_employees.id", ondelete="CASCADE"),
        nullable=False,
    )
    work_date: Mapped[str] = mapped_column(String(10), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="present", server_default=text("'present'"))
    note: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default=text("''"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class DeliveryShipment(Base):
    __tablename__ = "delivery_shipments"
    __table_args__ = (
        UniqueConstraint("workspace_owner_id", "number", name="uq_delivery_shipments_workspace_number"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    workspace_owner_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    number: Mapped[int] = mapped_column(Integer, nullable=False)
    shipment_date: Mapped[str] = mapped_column(String(10), nullable=False, default="", server_default=text("''"))
    courier_name: Mapped[str] = mapped_column(String(255), nullable=False, default="", server_default=text("''"))
    employee_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("hr_employees.id", ondelete="SET NULL"),
        nullable=True,
    )
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="UZS", server_default=text("'UZS'"))
    total_amount: Mapped[object] = mapped_column(Numeric(18, 2), nullable=False, default=0, server_default=text("0"))
    paid_amount: Mapped[object] = mapped_column(Numeric(18, 2), nullable=False, default=0, server_default=text("0"))
    debt_amount: Mapped[object] = mapped_column(Numeric(18, 2), nullable=False, default=0, server_default=text("0"))
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="open", server_default=text("'open'"))
    doc_status: Mapped[str] = mapped_column(String(20), nullable=False, default="new", server_default=text("'new'"))
    note: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default=text("''"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class DeliveryShipmentItem(Base):
    __tablename__ = "delivery_shipment_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    shipment_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("delivery_shipments.id", ondelete="CASCADE"),
        nullable=False,
    )
    product_name: Mapped[str] = mapped_column(String(255), nullable=False, default="", server_default=text("''"))
    quantity: Mapped[object] = mapped_column(Numeric(18, 3), nullable=False, default=1, server_default=text("1"))
    amount: Mapped[object] = mapped_column(Numeric(18, 2), nullable=False, default=0, server_default=text("0"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )


class Role(Base):
    __tablename__ = "roles"
    __table_args__ = (
        UniqueConstraint("workspace_owner_id", "key", name="uq_roles_workspace_key"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    workspace_owner_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    key: Mapped[str] = mapped_column(String(40), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    permissions: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb"))
    is_system: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=text("true"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class WorkspaceSetting(Base):
    __tablename__ = "workspace_settings"

    workspace_owner_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    data: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class Treasury(Base):
    __tablename__ = "treasuries"

    workspace_owner_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    data: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class GlobalSetting(Base):
    __tablename__ = "global_settings"

    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    data: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class FinanceAccount(Base):
    __tablename__ = "finance_accounts"
    __table_args__ = (
        UniqueConstraint("workspace_owner_id", "name", name="uq_finance_accounts_workspace_name"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    workspace_owner_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    kind: Mapped[str] = mapped_column(String(40), nullable=False, default="custom", server_default=text("'custom'"))
    icon: Mapped[str] = mapped_column(String(80), nullable=False, default="", server_default=text("''"))
    note: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default=text("''"))
    owner_employee_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=text("true"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class AccountBalance(Base):
    __tablename__ = "account_balances"
    __table_args__ = (
        UniqueConstraint("account_id", "currency", name="uq_account_balances_account_currency"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    account_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("finance_accounts.id", ondelete="CASCADE"),
        nullable=False,
    )
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    amount: Mapped[object] = mapped_column(Numeric(18, 2), nullable=False, default=0, server_default=text("0"))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class FinanceCategory(Base):
    __tablename__ = "finance_categories"
    __table_args__ = (
        UniqueConstraint("workspace_owner_id", "type", "name", name="uq_finance_categories_workspace_type_name"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    workspace_owner_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    type: Mapped[str] = mapped_column(String(20), nullable=False, default="expense", server_default=text("'expense'"))
    parent_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("finance_categories.id", ondelete="SET NULL"),
        nullable=True,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=text("true"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class Counterparty(Base):
    __tablename__ = "counterparties"
    __table_args__ = (
        UniqueConstraint(
            "workspace_owner_id",
            "external_source",
            "external_id",
            name="uq_counterparties_external",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    workspace_owner_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    kind: Mapped[str] = mapped_column(String(20), nullable=False, default="client", server_default=text("'client'"))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    tax_id: Mapped[str] = mapped_column(String(64), nullable=False, default="", server_default=text("''"))
    phone: Mapped[str] = mapped_column(String(64), nullable=False, default="", server_default=text("''"))
    external_source: Mapped[str] = mapped_column(String(40), nullable=False, default="", server_default=text("''"))
    external_id: Mapped[str] = mapped_column(String(180), nullable=False, default="", server_default=text("''"))
    data: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class Branch(Base):
    __tablename__ = "branches"
    __table_args__ = (
        UniqueConstraint("workspace_owner_id", "external_source", "external_id", name="uq_branches_external"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    workspace_owner_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    external_source: Mapped[str] = mapped_column(String(40), nullable=False, default="", server_default=text("''"))
    external_id: Mapped[str] = mapped_column(String(180), nullable=False, default="", server_default=text("''"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class Transaction(Base):
    __tablename__ = "transactions"
    __table_args__ = (
        UniqueConstraint("workspace_owner_id", "number", name="uq_transactions_workspace_number"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    workspace_owner_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    number: Mapped[int] = mapped_column(Integer, nullable=False)
    amount: Mapped[object] = mapped_column(Numeric(18, 2), nullable=False, default=0, server_default=text("0"))
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="USD", server_default=text("'USD'"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    client: Mapped[str | None] = mapped_column(String(255), nullable=True)
    employee_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    from_pocket_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    to_pocket_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    from_account_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("finance_accounts.id", ondelete="SET NULL"),
        nullable=True,
    )
    to_account_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("finance_accounts.id", ondelete="SET NULL"),
        nullable=True,
    )
    month: Mapped[str | None] = mapped_column(String(20), nullable=True)
    type: Mapped[str] = mapped_column(String(20), nullable=False, server_default=text("'income'")) # income, expense, transfer
    is_confirmed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=text("true"))
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="confirmed", server_default=text("'confirmed'"))
    requires_confirmation: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))
    confirmed_by: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    category: Mapped[str | None] = mapped_column(String(100), nullable=True)
    category_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("finance_categories.id", ondelete="SET NULL"),
        nullable=True,
    )
    counterparty_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("counterparties.id", ondelete="SET NULL"),
        nullable=True,
    )
    branch_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("branches.id", ondelete="SET NULL"),
        nullable=True,
    )
    branch: Mapped[str | None] = mapped_column(String(100), nullable=True)
    supplier: Mapped[str | None] = mapped_column(String(255), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    data: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb"))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class TransactionEntry(Base):
    __tablename__ = "transaction_entries"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    transaction_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("transactions.id", ondelete="CASCADE"),
        nullable=False,
    )
    account_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("finance_accounts.id", ondelete="CASCADE"),
        nullable=False,
    )
    direction: Mapped[str] = mapped_column(String(10), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    amount: Mapped[object] = mapped_column(Numeric(18, 2), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )


class ExternalRecord(Base):
    __tablename__ = "external_records"
    __table_args__ = (
        UniqueConstraint(
            "workspace_owner_id",
            "integration",
            "entity_type",
            "external_id",
            name="uq_external_records_identity",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    workspace_owner_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    integration: Mapped[str] = mapped_column(String(40), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(80), nullable=False)
    external_id: Mapped[str] = mapped_column(String(180), nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb"))
    payload_hash: Mapped[str] = mapped_column(String(64), nullable=False, default="", server_default=text("''"))
    synced_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )


class IntegrationSyncRun(Base):
    __tablename__ = "integration_sync_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    workspace_owner_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    integration: Mapped[str] = mapped_column(String(40), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="running", server_default=text("'running'"))
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    imported_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    data: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb"))


class Product(Base):
    __tablename__ = "products"
    __table_args__ = (
        UniqueConstraint("workspace_owner_id", "external_source", "external_id", name="uq_products_external"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    workspace_owner_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    sku: Mapped[str] = mapped_column(String(100), nullable=False, default="", server_default=text("''"))
    barcode: Mapped[str] = mapped_column(String(100), nullable=False, default="", server_default=text("''"))
    external_source: Mapped[str] = mapped_column(String(40), nullable=False, default="", server_default=text("''"))
    external_id: Mapped[str] = mapped_column(String(180), nullable=False, default="", server_default=text("''"))
    data: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class Warehouse(Base):
    __tablename__ = "warehouses"
    __table_args__ = (
        UniqueConstraint("workspace_owner_id", "external_source", "external_id", name="uq_warehouses_external"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    workspace_owner_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    branch_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("branches.id", ondelete="SET NULL"), nullable=True)
    external_source: Mapped[str] = mapped_column(String(40), nullable=False, default="", server_default=text("''"))
    external_id: Mapped[str] = mapped_column(String(180), nullable=False, default="", server_default=text("''"))
    data: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class SaleDocument(Base):
    __tablename__ = "sale_documents"
    __table_args__ = (
        UniqueConstraint("workspace_owner_id", "external_source", "external_id", name="uq_sale_documents_external"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    workspace_owner_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    number: Mapped[str] = mapped_column(String(100), nullable=False, default="", server_default=text("''"))
    amount: Mapped[object] = mapped_column(Numeric(18, 2), nullable=False, default=0, server_default=text("0"))
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="UZS", server_default=text("'UZS'"))
    counterparty_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("counterparties.id", ondelete="SET NULL"), nullable=True)
    branch_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("branches.id", ondelete="SET NULL"), nullable=True)
    external_source: Mapped[str] = mapped_column(String(40), nullable=False, default="", server_default=text("''"))
    external_id: Mapped[str] = mapped_column(String(180), nullable=False, default="", server_default=text("''"))
    data: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class PurchaseDocument(Base):
    __tablename__ = "purchase_documents"
    __table_args__ = (
        UniqueConstraint("workspace_owner_id", "external_source", "external_id", name="uq_purchase_documents_external"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    workspace_owner_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    number: Mapped[str] = mapped_column(String(100), nullable=False, default="", server_default=text("''"))
    amount: Mapped[object] = mapped_column(Numeric(18, 2), nullable=False, default=0, server_default=text("0"))
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="UZS", server_default=text("'UZS'"))
    counterparty_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("counterparties.id", ondelete="SET NULL"), nullable=True)
    branch_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("branches.id", ondelete="SET NULL"), nullable=True)
    external_source: Mapped[str] = mapped_column(String(40), nullable=False, default="", server_default=text("''"))
    external_id: Mapped[str] = mapped_column(String(180), nullable=False, default="", server_default=text("''"))
    data: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class WarehouseOperation(Base):
    __tablename__ = "warehouse_operations"
    __table_args__ = (
        UniqueConstraint("workspace_owner_id", "number", name="uq_warehouse_operations_workspace_number"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    workspace_owner_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    number: Mapped[str] = mapped_column(String(100), nullable=False, default="", server_default=text("''"))
    operation_type: Mapped[str] = mapped_column(String(24), nullable=False, default="adjustment", server_default=text("'adjustment'"))
    warehouse_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("warehouses.id", ondelete="SET NULL"), nullable=True)
    product_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("products.id", ondelete="SET NULL"), nullable=True)
    quantity: Mapped[object] = mapped_column(Numeric(18, 3), nullable=False, default=0, server_default=text("0"))
    amount: Mapped[object] = mapped_column(Numeric(18, 2), nullable=False, default=0, server_default=text("0"))
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="UZS", server_default=text("'UZS'"))
    data: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class CrmRecord(Base):
    __tablename__ = "crm_records"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    workspace_owner_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    item_type: Mapped[str] = mapped_column(String(24), nullable=False, default="task", server_default=text("'task'"))
    title: Mapped[str] = mapped_column(String(255), nullable=False, default="", server_default=text("''"))
    counterparty_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("counterparties.id", ondelete="SET NULL"), nullable=True)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="new", server_default=text("'new'"))
    stage_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    responsible_user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    due_date: Mapped[str] = mapped_column(String(10), nullable=False, default="", server_default=text("''"))
    next_action_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_activity_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    amount: Mapped[object] = mapped_column(Numeric(18, 2), nullable=False, default=0, server_default=text("0"))
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="UZS", server_default=text("'UZS'"))
    data: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class CrmActivity(Base):
    """Единый таймлайн CRM: звонки, сообщения, заметки, смены этапа/статуса."""

    __tablename__ = "crm_activities"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    workspace_owner_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    counterparty_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("counterparties.id", ondelete="SET NULL"), nullable=True)
    crm_record_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("crm_records.id", ondelete="SET NULL"), nullable=True)
    kind: Mapped[str] = mapped_column(String(24), nullable=False, default="note", server_default=text("'note'"))
    channel: Mapped[str] = mapped_column(String(24), nullable=False, default="manual", server_default=text("'manual'"))
    direction: Mapped[str] = mapped_column(String(10), nullable=False, default="system", server_default=text("'system'"))
    title: Mapped[str] = mapped_column(String(255), nullable=False, default="", server_default=text("''"))
    body: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default=text("''"))
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb"))
    actor_user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class PaymentDocument(Base):
    __tablename__ = "payment_documents"
    __table_args__ = (
        UniqueConstraint("workspace_owner_id", "external_source", "external_id", name="uq_payment_documents_external"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    workspace_owner_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    number: Mapped[str] = mapped_column(String(100), nullable=False, default="", server_default=text("''"))
    amount: Mapped[object] = mapped_column(Numeric(18, 2), nullable=False, default=0, server_default=text("0"))
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="UZS", server_default=text("'UZS'"))
    counterparty_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("counterparties.id", ondelete="SET NULL"), nullable=True)
    transaction_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("transactions.id", ondelete="SET NULL"), nullable=True)
    direction: Mapped[str] = mapped_column(String(10), nullable=False, default="in", server_default=text("'in'"))
    external_source: Mapped[str] = mapped_column(String(40), nullable=False, default="", server_default=text("''"))
    external_id: Mapped[str] = mapped_column(String(180), nullable=False, default="", server_default=text("''"))
    data: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class ExpenseDocument(Base):
    __tablename__ = "expense_documents"
    __table_args__ = (
        UniqueConstraint("workspace_owner_id", "external_source", "external_id", name="uq_expense_documents_external"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    workspace_owner_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    number: Mapped[str] = mapped_column(String(100), nullable=False, default="", server_default=text("''"))
    amount: Mapped[object] = mapped_column(Numeric(18, 2), nullable=False, default=0, server_default=text("0"))
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="UZS", server_default=text("'UZS'"))
    category_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("finance_categories.id", ondelete="SET NULL"), nullable=True)
    counterparty_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("counterparties.id", ondelete="SET NULL"), nullable=True)
    transaction_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("transactions.id", ondelete="SET NULL"), nullable=True)
    external_source: Mapped[str] = mapped_column(String(40), nullable=False, default="", server_default=text("''"))
    external_id: Mapped[str] = mapped_column(String(180), nullable=False, default="", server_default=text("''"))
    data: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class TelegramBotConfig(Base):
    __tablename__ = "telegram_bot_configs"

    workspace_owner_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    bot_token: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default=text("''"))
    bot_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    bot_username: Mapped[str] = mapped_column(String(80), nullable=False, default="", server_default=text("''"))
    bot_first_name: Mapped[str] = mapped_column(String(160), nullable=False, default="", server_default=text("''"))
    webhook_secret: Mapped[str] = mapped_column(String(64), nullable=False, default="", server_default=text("''"))
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=text("true"))
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    notification_prefs: Mapped[dict] = mapped_column(
        JSONB,
        nullable=False,
        default=dict,
        server_default=text("'{}'::jsonb"),
    )
    connected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class TelegramChat(Base):
    __tablename__ = "telegram_chats"
    __table_args__ = (
        UniqueConstraint("workspace_owner_id", "chat_id", name="uq_telegram_chats_workspace_chat"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    workspace_owner_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    chat_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    chat_type: Mapped[str] = mapped_column(String(32), nullable=False, default="group", server_default=text("'group'"))
    title: Mapped[str] = mapped_column(String(255), nullable=False, default="", server_default=text("''"))
    bot_is_admin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))
    discovered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class TelegramSubscriber(Base):
    __tablename__ = "telegram_subscribers"
    __table_args__ = (
        UniqueConstraint("workspace_owner_id", "telegram_user_id", name="uq_telegram_subscribers_workspace_user"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    workspace_owner_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    telegram_user_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    chat_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    display_name: Mapped[str] = mapped_column(String(255), nullable=False, default="", server_default=text("''"))
    username: Mapped[str] = mapped_column(String(80), nullable=False, default="", server_default=text("''"))
    phone: Mapped[str] = mapped_column(String(40), nullable=False, default="", server_default=text("''"))
    contact_payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb"))
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending", server_default=text("'pending'"))
    requested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    decided_by_user_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class UserAuthSession(Base):
    __tablename__ = "user_auth_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_agent: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default=text("''"))
    device_label: Mapped[str] = mapped_column(String(160), nullable=False, default="", server_default=text("''"))
    os_family: Mapped[str] = mapped_column(String(32), nullable=False, default="unknown", server_default=text("'unknown'"))
    browser_family: Mapped[str] = mapped_column(String(40), nullable=False, default="", server_default=text("''"))
    device_type: Mapped[str] = mapped_column(String(20), nullable=False, default="desktop", server_default=text("'desktop'"))
    ip_address: Mapped[str] = mapped_column(String(64), nullable=False, default="", server_default=text("''"))
    geo_label: Mapped[str] = mapped_column(String(120), nullable=False, default="", server_default=text("''"))
    client_meta: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    blocked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class TelegramDeliveryLog(Base):
    __tablename__ = "telegram_delivery_log"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    workspace_owner_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    kind: Mapped[str] = mapped_column(String(40), nullable=False, default="", server_default=text("''"))
    target_chat_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    dedupe_key: Mapped[str] = mapped_column(String(120), nullable=False, default="", server_default=text("''"))
    ok: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

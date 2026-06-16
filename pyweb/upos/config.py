from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

_PKG_DIR = Path(__file__).resolve().parent
_PYWEB_ROOT = _PKG_DIR.parent


def _env_file_candidates() -> tuple[str, ...]:
    repo_root = _PYWEB_ROOT.parent
    paths: list[Path] = []
    for root in (_PYWEB_ROOT, repo_root):
        for name in (".env.local", ".env"):
            p = root / name
            if p.is_file():
                paths.append(p)
    return tuple(str(p) for p in paths)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=_env_file_candidates() or (),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    auth_secret: str = Field(
        default="dev-only-change-me",
        validation_alias=AliasChoices("AUTH_SECRET", "NEXTAUTH_SECRET"),
    )
    auth_url: str = Field(
        default="http://127.0.0.1:3000",
        validation_alias=AliasChoices("AUTH_URL", "NEXTAUTH_URL"),
    )
    database_url: str = Field(
        default="",
        validation_alias=AliasChoices("DATABASE_URL", "DATABASE_PUBLIC_URL"),
    )

    admin_basic_user: str | None = None
    admin_basic_password: str | None = None
    billing_root_user: str | None = None
    billing_root_password: str | None = None
    admin_display_name: str = "Администратор"

    # Railway sets PORT env var; bind to 0.0.0.0 in production.
    host: str = Field(
        default="0.0.0.0",
        validation_alias=AliasChoices("UPOS_HOST", "HOST"),
    )
    port: int = Field(
        default=3000,
        validation_alias=AliasChoices("PORT", "UPOS_PORT"),
    )


def schema_align_on_startup() -> bool:
    """Whether to run pg_schema_align on process start (slow on large DBs)."""
    import os

    if (os.getenv("UPOS_SKIP_SCHEMA_ALIGN") or "").strip().lower() in {"1", "true", "yes"}:
        return False
    raw = (os.getenv("UPOS_SCHEMA_ALIGN_ON_START") or "").strip().lower()
    if raw in {"0", "false", "no"}:
        return False
    if raw in {"1", "true", "yes"}:
        return True
    if (os.getenv("RAILWAY_ENVIRONMENT") or "").strip().lower() == "production":
        return False
    return True


def db_connect_timeout_seconds() -> int:
    import os

    try:
        return max(2, int(os.getenv("UPOS_DB_CONNECT_TIMEOUT", "5") or "5"))
    except ValueError:
        return 5


@lru_cache
def get_settings() -> Settings:
    return Settings()


def user_is_admin(user: dict | None) -> bool:
    return bool(user and user.get("role") == "admin")

from __future__ import annotations

import copy
from dataclasses import dataclass
from typing import Any


CLOPOS_DEFAULT_API_BASE_URL = "https://integrations.clopos.com/open-api/v2"


@dataclass(frozen=True)
class IntegrationProvider:
    key: str
    label: str
    logo_path: str
    badge_path: str
    default: dict[str, Any]
    required_fields: tuple[str, ...]
    active_fields: tuple[str, ...]
    logo_class: str = ""
    test_connection: bool = False


INTEGRATION_PROVIDERS: tuple[IntegrationProvider, ...] = (
    IntegrationProvider(
        key="greenwhite",
        label="Smartup",
        logo_path="integrations/smartup.svg",
        badge_path="integrations/smartup.svg",
        default={
            "base_url": "",
            "username": "",
            "password": "",
            "project_code": "trade",
            "filial_id": "",
            "filial_code": "",
            "sync_days": 7,
            "export_timeout": 25,
            "token": "",
            "organization_id": "",
            "sync_enabled": False,
            "last_sync_at": "",
        },
        required_fields=("base_url", "username", "password"),
        active_fields=(
            "base_url",
            "username",
            "filial_id",
            "filial_code",
            "sync_enabled",
            "last_sync_at",
        ),
        logo_class="integr-card-logo--wide",
        test_connection=True,
    ),
    IntegrationProvider(
        key="onec",
        label="1C",
        logo_path="integrations/1c.svg",
        badge_path="integrations/1c.svg",
        default={"base_url": "", "username": "", "password": ""},
        required_fields=("base_url", "username"),
        active_fields=("base_url", "username"),
    ),
    IntegrationProvider(
        key="yespos",
        label="YESPOS",
        logo_path="integrations/yespos.png",
        badge_path="integrations/yespos-mark.png",
        default={"api_base_url": "", "api_key": ""},
        required_fields=("api_base_url", "api_key"),
        active_fields=("api_base_url", "api_key"),
        logo_class="integr-card-logo--wide",
    ),
    IntegrationProvider(
        key="ibox",
        label="IBOX",
        logo_path="integrations/ibox.svg",
        badge_path="integrations/ibox-mark.svg",
        default={"api_url": "", "api_key": "", "terminal_id": ""},
        required_fields=("api_url", "api_key", "terminal_id"),
        active_fields=("api_url", "api_key", "terminal_id"),
        logo_class="integr-card-logo--wide",
    ),
    IntegrationProvider(
        key="clopos",
        label="Clopos",
        logo_path="integrations/clopos.svg",
        badge_path="integrations/clopos-mark.svg",
        default={
            "api_base_url": CLOPOS_DEFAULT_API_BASE_URL,
            "client_id": "",
            "client_secret": "",
            "brand": "",
            "integrator_id": "",
            "venue_id": "",
            "token": "",
            "expires_at": "",
        },
        required_fields=("client_id", "client_secret", "brand", "integrator_id"),
        active_fields=("client_id", "client_secret", "brand", "integrator_id", "token"),
        logo_class="integr-card-logo--wide",
        test_connection=True,
    ),
)

INTEGRATION_PROVIDER_BY_KEY = {provider.key: provider for provider in INTEGRATION_PROVIDERS}


def default_integration_settings() -> dict[str, dict[str, Any]]:
    return {provider.key: copy.deepcopy(provider.default) for provider in INTEGRATION_PROVIDERS}


def integration_block_has_value(block: dict[str, object], *keys: str) -> bool:
    for key in keys:
        value = block.get(key)
        if isinstance(value, bool):
            if value:
                return True
            continue
        if value is not None and str(value).strip():
            return True
    return False


def integration_block_has_all_values(block: dict[str, object], *keys: str) -> bool:
    for key in keys:
        value = block.get(key)
        if isinstance(value, bool):
            if not value:
                return False
            continue
        if value is None or not str(value).strip():
            return False
    return True


def integration_configured(key: str, block: dict[str, object]) -> bool:
    provider = INTEGRATION_PROVIDER_BY_KEY.get(key)
    if provider is None:
        return False
    return integration_block_has_all_values(block, *provider.required_fields)


def integration_badges(settings: dict[str, Any]) -> list[dict[str, object]]:
    raw_integrations = settings.get("integrations") if isinstance(settings, dict) else {}
    integrations = raw_integrations if isinstance(raw_integrations, dict) else {}
    out: list[dict[str, object]] = []
    for provider in INTEGRATION_PROVIDERS:
        value = integrations.get(provider.key)
        block = value if isinstance(value, dict) else {}
        out.append(
            {
                "key": provider.key,
                "label": provider.label,
                "icon": provider.badge_path,
                "active": integration_block_has_value(block, *provider.active_fields),
            }
        )
    return out

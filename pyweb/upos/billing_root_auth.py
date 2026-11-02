from __future__ import annotations

import hashlib
import hmac
import logging
import smtplib
import ssl
from email.message import EmailMessage

from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from passlib.context import CryptContext

from upos.config import get_settings
from upos.db import session_scope
from upos.db_models import GlobalSetting

logger = logging.getLogger(__name__)

_STORE_KEY = "billing_root_auth"
_TOKEN_SALT = "billing-root-password-reset-v1"
_TOKEN_MAX_AGE_SECONDS = 30 * 60
_pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")


def _load_state() -> dict:
    with session_scope() as session:
        row = session.get(GlobalSetting, _STORE_KEY)
        return dict(row.data) if row and isinstance(row.data, dict) else {}


def _save_state(data: dict) -> None:
    with session_scope() as session:
        row = session.get(GlobalSetting, _STORE_KEY)
        if row is None:
            session.add(GlobalSetting(key=_STORE_KEY, data=dict(data)))
        else:
            row.data = dict(data)


def configured_email() -> str:
    state_email = str(_load_state().get("email") or "").strip().lower()
    return state_email or get_settings().billing_root_email.strip().lower()


def masked_email() -> str:
    email = configured_email()
    if "@" not in email:
        return ""
    local, domain = email.split("@", 1)
    visible = local[:2]
    return f"{visible}{'*' * max(3, len(local) - len(visible))}@{domain}"


def verify_password(password: str, fallback_password: str) -> bool:
    password_hash = str(_load_state().get("password_hash") or "")
    if password_hash:
        try:
            return bool(_pwd.verify(password, password_hash))
        except ValueError:
            logger.exception("Invalid billing root password hash")
            return False
    return hmac.compare_digest(password, fallback_password)


def _password_marker() -> str:
    state = _load_state()
    source = str(state.get("password_hash") or get_settings().billing_root_password or get_settings().admin_basic_password or "root12345")
    return hashlib.sha256(source.encode("utf-8")).hexdigest()[:24]


def create_reset_token(email: str) -> str:
    serializer = URLSafeTimedSerializer(get_settings().auth_secret, salt=_TOKEN_SALT)
    return serializer.dumps({"email": email.strip().lower(), "marker": _password_marker()})


def validate_reset_token(token: str) -> bool:
    serializer = URLSafeTimedSerializer(get_settings().auth_secret, salt=_TOKEN_SALT)
    try:
        payload = serializer.loads(token, max_age=_TOKEN_MAX_AGE_SECONDS)
    except (BadSignature, SignatureExpired):
        return False
    return bool(
        isinstance(payload, dict)
        and hmac.compare_digest(str(payload.get("email") or ""), configured_email())
        and hmac.compare_digest(str(payload.get("marker") or ""), _password_marker())
    )


def set_password(password: str) -> None:
    state = _load_state()
    state["email"] = configured_email()
    state["password_hash"] = _pwd.hash(password)
    _save_state(state)


def smtp_ready() -> bool:
    settings = get_settings()
    sender = settings.smtp_from_email.strip() or settings.smtp_user.strip()
    credentials_ready = not settings.smtp_user.strip() or bool(settings.smtp_password)
    return bool(settings.smtp_host.strip() and sender and credentials_ready)


def send_reset_email(email: str, reset_url: str) -> None:
    settings = get_settings()
    message = EmailMessage()
    message["Subject"] = "Сброс пароля биллинга UPOS"
    message["From"] = settings.smtp_from_email.strip() or settings.smtp_user.strip()
    message["To"] = email
    message.set_content(
        "Для задания нового root-пароля биллинга UPOS откройте ссылку:\n\n"
        f"{reset_url}\n\n"
        "Ссылка действует 30 минут и станет недействительной после смены пароля. "
        "Если вы не запрашивали сброс, проигнорируйте письмо."
    )

    context = ssl.create_default_context()
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as smtp:
        if settings.smtp_use_tls:
            smtp.starttls(context=context)
        if settings.smtp_user:
            smtp.login(settings.smtp_user, settings.smtp_password)
        smtp.send_message(message)


def send_reset_email_safely(email: str, reset_url: str) -> None:
    try:
        send_reset_email(email, reset_url)
    except Exception:
        logger.exception("Billing root reset email delivery failed")

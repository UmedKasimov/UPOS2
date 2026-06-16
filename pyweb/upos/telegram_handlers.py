"""Telegram webhook update handling."""

from __future__ import annotations

import html
import logging
import re
import time
from typing import Any

from upos.telegram_client import (
    answer_callback_query,
    bot_is_admin,
    contact_request_keyboard,
    edit_message_reply_markup,
    edit_message_text,
    get_chat_member,
    remove_keyboard,
    send_message,
)
from upos.telegram_reports import (
    balance_report_keyboard,
    format_balance_snapshot,
)
from upos.telegram_store import (
    disable_subscriber_by_telegram_user,
    get_bot_config_with_token,
    get_subscriber_by_telegram_user,
    remove_chat_by_telegram_id,
    upsert_chat,
    upsert_subscriber_request,
    workspace_display_name,
)
from upos.transactions_store import decide_transaction_telegram_limit_approval

logger = logging.getLogger(__name__)

_PHONE_RE = re.compile(r"\+?\d[\d\s\-()]{6,}\d")
_ADMIN_STATUSES = frozenset({"administrator", "creator"})
_WELCOME_DEDUPE_SEC = 90.0
_recent_group_welcome: dict[str, float] = {}


def _esc(value: Any) -> str:
    return html.escape(str(value or ""), quote=False)


def _chat_title(chat: dict[str, Any]) -> str:
    for key in ("title", "first_name", "username"):
        value = str(chat.get(key) or "").strip()
        if value:
            return value
    return f"Chat {chat.get('id')}"


def _user_display(user: dict[str, Any]) -> str:
    parts = [str(user.get("first_name") or "").strip(), str(user.get("last_name") or "").strip()]
    name = " ".join(part for part in parts if part).strip()
    if name:
        return name
    username = str(user.get("username") or "").strip()
    if username:
        return f"@{username}"
    return "Пользователь"


def _is_admin_status(status: str) -> bool:
    return str(status or "").lower() in _ADMIN_STATUSES


def _welcome_allowed(workspace_owner_id: str, chat_id: int, kind: str) -> bool:
    key = f"{workspace_owner_id}:{chat_id}:{kind}"
    now = time.monotonic()
    prev = _recent_group_welcome.get(key)
    if prev is not None and now - prev < _WELCOME_DEDUPE_SEC:
        return False
    _recent_group_welcome[key] = now
    if len(_recent_group_welcome) > 500:
        cutoff = now - _WELCOME_DEDUPE_SEC
        for item in list(_recent_group_welcome):
            if _recent_group_welcome[item] < cutoff:
                del _recent_group_welcome[item]
    return True


def _report_action_from_text(text: str) -> str:
    value = str(text or "").strip()
    if not value:
        return ""
    lowered = value.lower()
    command = lowered.split(maxsplit=1)[0].split("@", 1)[0]
    if command in {"/balance", "/balances", "/ostatki"}:
        return "balance"
    compact = re.sub(r"\s+", " ", lowered)
    if compact in {"остаток", "остатки", "ostatok", "balance", "balances"}:
        return "balance"
    if "остат" in compact and ("счет" in compact or "счёт" in compact or "касс" in compact):
        return "balance"
    return ""


def _send_balance_snapshot(workspace_owner_id: str, token: str, chat_id: int, bot_username: str = "") -> None:
    send_message(
        token,
        chat_id,
        format_balance_snapshot(workspace_owner_id),
        parse_mode="HTML",
        reply_markup=balance_report_keyboard(bot_username),
    )


def _handle_report_action_text(
    workspace_owner_id: str,
    token: str,
    chat_id: int,
    text: str,
    bot_username: str = "",
) -> bool:
    action = _report_action_from_text(text)
    if action == "balance":
        _send_balance_snapshot(workspace_owner_id, token, chat_id, bot_username)
        return True
    return False


def _send_group_welcome(
    token: str,
    chat_id: int,
    text: str,
    *,
    workspace_owner_id: str,
    kind: str,
) -> None:
    if not _welcome_allowed(workspace_owner_id, chat_id, kind):
        return
    try:
        send_message(token, chat_id, text, parse_mode="HTML")
    except Exception as exc:
        logger.warning("[telegram] group welcome chat=%s: %s", chat_id, exc)


def handle_telegram_update(workspace_owner_id: str, update: dict[str, Any]) -> None:
    if not isinstance(update, dict):
        return
    try:
        _handle_telegram_update_inner(workspace_owner_id, update)
    except Exception:
        logger.exception("[telegram] update handling failed wid=%s", workspace_owner_id)


def _handle_telegram_update_inner(workspace_owner_id: str, update: dict[str, Any]) -> None:
    cfg, token = get_bot_config_with_token(workspace_owner_id)
    if not cfg or not token:
        logger.warning("[telegram] no config for workspace %s", workspace_owner_id)
        return

    bot_id = int(cfg.get("bot_id") or 0)
    bot_username = str(cfg.get("bot_username") or "").strip()
    org_name = workspace_display_name(workspace_owner_id)

    if isinstance(update.get("callback_query"), dict):
        _handle_callback_query(workspace_owner_id, token, update["callback_query"])
        return

    if isinstance(update.get("my_chat_member"), dict):
        _handle_my_chat_member(workspace_owner_id, token, bot_id, update["my_chat_member"], org_name)
        return

    message = update.get("message")
    if not isinstance(message, dict):
        return

    chat = message.get("chat") or {}
    chat_id = int(chat.get("id") or 0)

    chat_type = str(chat.get("type") or "private")
    text = str(message.get("text") or "").strip()

    if chat_type in {"group", "supergroup"}:
        for member in message.get("new_chat_members") or []:
            if bool(member.get("is_bot")) and int(member.get("id") or 0) == bot_id:
                _on_bot_added_to_group(workspace_owner_id, token, bot_id, chat, org_name)
        if _handle_report_action_text(workspace_owner_id, token, chat_id, text, bot_username):
            return
        _discover_group_from_activity(workspace_owner_id, token, bot_id, chat)
        return

    if chat_type != "private":
        return

    user = message.get("from") or {}
    tg_user_id = int(user.get("id") or 0)
    if not tg_user_id:
        return

    contact = message.get("contact")

    if _report_action_from_text(text):
        sub = get_subscriber_by_telegram_user(workspace_owner_id, tg_user_id)
        if sub and sub.get("status") == "approved":
            _handle_report_action_text(workspace_owner_id, token, chat_id, text, bot_username)
            return

    if text.startswith("/stop"):
        disable_subscriber_by_telegram_user(workspace_owner_id, tg_user_id)
        send_message(
            token,
            chat_id,
            "🔕 Уведомления отключены.\n\nЧтобы снова попросить доступ, отправьте /start.",
            reply_markup=remove_keyboard(),
        )
        return

    if text.startswith("/help"):
        _handle_private_help(token, chat_id)
        return

    if text.startswith("/start"):
        _handle_private_start(workspace_owner_id, token, chat_id, tg_user_id, org_name)
        return

    if text.startswith("/status"):
        _handle_private_status(workspace_owner_id, token, chat_id, tg_user_id, org_name)
        return

    if contact:
        contact_user_id = int(contact.get("user_id") or 0)
        if contact_user_id and contact_user_id != tg_user_id:
            send_message(
                token,
                chat_id,
                "Пожалуйста, отправьте свой контакт кнопкой ниже. Чужой контакт для доступа не подходит.",
                reply_markup=contact_request_keyboard(),
            )
            return
        phone = str(contact.get("phone_number") or "").strip()
        first = str(contact.get("first_name") or "").strip()
        last = str(contact.get("last_name") or "").strip()
        name = " ".join(part for part in (first, last) if part).strip() or _user_display(user)
        _create_access_request(
            workspace_owner_id,
            token,
            chat_id,
            tg_user_id,
            name,
            str(user.get("username") or ""),
            phone,
            contact,
        )
        return

    if text and not text.startswith("/"):
        phone_match = _PHONE_RE.search(text)
        if phone_match:
            phone = phone_match.group(0).strip()
            name = text.replace(phone, "").strip(" ,;—-") or _user_display(user)
            _create_access_request(
                workspace_owner_id,
                token,
                chat_id,
                tg_user_id,
                name,
                str(user.get("username") or ""),
                phone,
                {"text": text},
            )
            return
        send_message(
            token,
            chat_id,
            (
                "Чтобы подать заявку на уведомления, отправьте контакт кнопкой ниже.\n\n"
                "Если кнопка недоступна, напишите: <b>Имя + телефон</b>.\n"
                "/status — проверить заявку, /stop — отключиться."
            ),
            reply_markup=contact_request_keyboard(),
        )
        return

    if text.startswith("/"):
        _handle_private_help(token, chat_id)


def _handle_callback_query(workspace_owner_id: str, token: str, query: dict[str, Any]) -> None:
    callback_id = str(query.get("id") or "")
    data = str(query.get("data") or "")
    message = query.get("message") if isinstance(query.get("message"), dict) else {}
    chat = message.get("chat") if isinstance(message.get("chat"), dict) else {}
    chat_id = int(chat.get("id") or 0)
    message_id = int(message.get("message_id") or 0)
    message_text = str(message.get("text") or "")
    preanswered = bool(query.get("_upos_preanswered"))

    if data.startswith("upos:lim:"):
        _handle_limit_approval_callback_fast(
            workspace_owner_id,
            token,
            callback_id,
            chat_id,
            message_id,
            message_text,
            data,
            preanswered=preanswered,
        )
        return

    if callback_id:
        try:
            answer_callback_query(token, callback_id, "Готово")
        except Exception as exc:
            logger.warning("[telegram] answer callback failed wid=%s: %s", workspace_owner_id, exc)

    if not chat_id:
        return

    if data == "upos:balance":
        cfg, _ = get_bot_config_with_token(workspace_owner_id)
        _send_balance_snapshot(workspace_owner_id, token, chat_id, str((cfg or {}).get("bot_username") or ""))
        return


def _answer_callback_safe(token: str, callback_id: str, text: str) -> None:
    if not callback_id:
        return
    try:
        answer_callback_query(token, callback_id, text)
    except Exception as exc:
        logger.warning("[telegram] answer callback failed: %s", exc)


def _edit_limit_approval_message(
    token: str,
    chat_id: int,
    message_id: int,
    original_text: str,
    status_text: str,
) -> None:
    if not chat_id or not message_id:
        return
    clean = str(original_text or "").strip()
    if len(clean) > 3800:
        clean = clean[:3800].rstrip() + "\n..."
    base = html.escape(clean, quote=False) if clean else "<b>Операция выше лимита</b>"
    updated_text = f"{base}\n\n<b>Статус: {html.escape(status_text, quote=False)}</b>"
    empty_keyboard = {"inline_keyboard": []}
    try:
        edit_message_text(token, chat_id, message_id, updated_text, reply_markup=empty_keyboard)
        return
    except Exception as exc:
        logger.warning("[telegram] approval message edit failed: %s", exc)
    try:
        edit_message_reply_markup(token, chat_id, message_id, empty_keyboard)
    except Exception as exc:
        logger.warning("[telegram] approval keyboard removal failed: %s", exc)


def _handle_limit_approval_callback_fast(
    workspace_owner_id: str,
    token: str,
    callback_id: str,
    chat_id: int,
    message_id: int,
    message_text: str,
    data: str,
    *,
    preanswered: bool = False,
) -> None:
    parts = str(data or "").split(":", 4)
    if len(parts) != 5 or parts[0] != "upos" or parts[1] != "lim" or parts[2] not in {"y", "n"}:
        _answer_callback_safe(token, callback_id, "Неверная кнопка")
        return

    approve = parts[2] == "y"
    tx_id = parts[3]
    approval_token = parts[4]
    if not preanswered:
        _answer_callback_safe(token, callback_id, "Проверяем операцию...")

    try:
        tx = decide_transaction_telegram_limit_approval(
            workspace_owner_id,
            tx_id,
            approval_token,
            approve=approve,
        )
    except PermissionError:
        logger.warning("[telegram] limit approval denied wid=%s tx=%s", workspace_owner_id, tx_id)
        _edit_limit_approval_message(token, chat_id, message_id, message_text, "нет доступа к подтверждению")
        return
    except ValueError as exc:
        msg = "уже обработана" if str(exc) == "not_pending" else "не удалось обработать"
        logger.warning("[telegram] limit approval failed wid=%s tx=%s error=%s", workspace_owner_id, tx_id, exc)
        _edit_limit_approval_message(token, chat_id, message_id, message_text, msg)
        return
    if tx is None:
        logger.warning("[telegram] limit approval tx not found wid=%s tx=%s", workspace_owner_id, tx_id)
        _edit_limit_approval_message(token, chat_id, message_id, message_text, "операция не найдена")
        return

    status_text = "подтверждена" if approve else "отклонена"
    logger.info("[telegram] limit approval applied wid=%s tx=%s status=%s", workspace_owner_id, tx_id, tx.get("status"))
    _edit_limit_approval_message(token, chat_id, message_id, message_text, f"операция {status_text}")
    if chat_id:
        try:
            send_message(token, chat_id, f"Операция №{tx.get('number') or ''} {status_text}.")
        except Exception as exc:
            logger.warning("[telegram] approval status message failed wid=%s: %s", workspace_owner_id, exc)
    if approve:
        try:
            from upos.telegram_notifier import notify_transaction_created

            notify_transaction_created(workspace_owner_id, tx)
        except Exception as exc:
            logger.warning("[telegram] approval follow-up notification failed wid=%s: %s", workspace_owner_id, exc)


def _handle_limit_approval_callback(
    workspace_owner_id: str,
    token: str,
    callback_id: str,
    chat_id: int,
    message_id: int,
    message_text: str,
    data: str,
) -> None:
    parts = str(data or "").split(":", 4)
    if len(parts) != 5 or parts[0] != "upos" or parts[1] != "lim" or parts[2] not in {"y", "n"}:
        if callback_id:
            answer_callback_query(token, callback_id, "Неверная кнопка")
        return
    approve = parts[2] == "y"
    tx_id = parts[3]
    approval_token = parts[4]
    try:
        tx = decide_transaction_telegram_limit_approval(
            workspace_owner_id,
            tx_id,
            approval_token,
            approve=approve,
        )
    except PermissionError:
        if callback_id:
            answer_callback_query(token, callback_id, "Нет доступа к подтверждению")
        return
    except ValueError as exc:
        msg = "Операция уже обработана" if str(exc) == "not_pending" else "Не удалось обработать"
        if callback_id:
            answer_callback_query(token, callback_id, msg)
        return
    if tx is None:
        if callback_id:
            answer_callback_query(token, callback_id, "Операция не найдена")
        return
    status_text = "подтверждена" if approve else "отклонена"
    if callback_id:
        answer_callback_query(token, callback_id, f"Операция {status_text}")
    if chat_id:
        try:
            send_message(token, chat_id, f"Операция №{tx.get('number') or ''} {status_text}.")
        except Exception as exc:
            logger.warning("[telegram] approval status message failed wid=%s: %s", workspace_owner_id, exc)
    if approve:
        try:
            from upos.telegram_notifier import notify_transaction_created

            notify_transaction_created(workspace_owner_id, tx)
        except Exception as exc:
            logger.warning("[telegram] approval follow-up notification failed wid=%s: %s", workspace_owner_id, exc)


def _create_access_request(
    workspace_owner_id: str,
    token: str,
    chat_id: int,
    tg_user_id: int,
    display_name: str,
    username: str,
    phone: str,
    contact_payload: dict[str, Any],
) -> None:
    row = upsert_subscriber_request(
        workspace_owner_id,
        telegram_user_id=tg_user_id,
        chat_id=chat_id,
        display_name=display_name,
        username=username,
        phone=phone,
        contact_payload=contact_payload,
    )
    if row.get("status") == "approved":
        msg = "✅ Вы уже подключены к уведомлениям.\n\n/stop — отключить уведомления."
    else:
        msg = "✅ Заявка отправлена. После одобрения Генеральным директором вы начнёте получать уведомления."
    send_message(token, chat_id, msg, reply_markup=remove_keyboard())


def _handle_private_help(token: str, chat_id: int) -> None:
    send_message(
        token,
        chat_id,
        (
            "<b>Команды бота U-POS FINANCE</b>\n\n"
            "/start — запросить доступ к уведомлениям\n"
            "/status — статус вашей заявки\n"
            "/stop — отключить уведомления\n"
            "/help — эта справка\n\n"
            "Для заявки отправьте контакт кнопкой или строку: <b>Имя + телефон</b>."
        ),
        reply_markup=remove_keyboard(),
    )


def _handle_private_start(
    workspace_owner_id: str,
    token: str,
    chat_id: int,
    tg_user_id: int,
    org_name: str,
) -> None:
    sub = get_subscriber_by_telegram_user(workspace_owner_id, tg_user_id)
    if sub and sub.get("status") == "disabled":
        send_message(
            token,
            chat_id,
            (
                f"🔕 Уведомления отключены для «{_esc(org_name)}».\n\n"
                "Чтобы снова подать заявку, отправьте контакт кнопкой ниже."
            ),
            reply_markup=contact_request_keyboard(),
        )
        return
    if sub and sub.get("status") == "approved":
        send_message(
            token,
            chat_id,
            f"✅ Вы подключены к уведомлениям «{_esc(org_name)}».\n\n/stop — отключить уведомления.",
            reply_markup=remove_keyboard(),
        )
        return
    if sub and sub.get("status") == "pending":
        send_message(
            token,
            chat_id,
            "⏳ Ваша заявка уже на рассмотрении. Ожидайте одобрения Генеральным директором.",
            reply_markup=remove_keyboard(),
        )
        return
    if sub and sub.get("status") == "rejected":
        send_message(
            token,
            chat_id,
            "❌ Доступ отклонён. Если доступ всё ещё нужен, обратитесь к руководству.",
            reply_markup=remove_keyboard(),
        )
        return
    send_message(
        token,
        chat_id,
        (
            f"👋 Добро пожаловать в бот уведомлений «{_esc(org_name)}».\n\n"
            "Чтобы получать кассовые операции и отчёты в личные сообщения, поделитесь контактом кнопкой ниже "
            "или отправьте строку: <b>Имя + телефон</b>.\n\n"
            "После этого заявка появится в U-POS FINANCE."
        ),
        reply_markup=contact_request_keyboard(),
    )


def _handle_private_status(
    workspace_owner_id: str,
    token: str,
    chat_id: int,
    tg_user_id: int,
    org_name: str,
) -> None:
    sub = get_subscriber_by_telegram_user(workspace_owner_id, tg_user_id)
    if not sub:
        send_message(
            token,
            chat_id,
            f"Заявки для «{_esc(org_name)}» пока нет. Отправьте /start, чтобы запросить доступ.",
            reply_markup=remove_keyboard(),
        )
        return
    status = str(sub.get("status") or "")
    if status == "approved":
        msg = "✅ Доступ одобрен. Вы получаете уведомления."
    elif status == "pending":
        msg = "⏳ Заявка ожидает одобрения."
    elif status == "disabled":
        msg = "🔕 Уведомления отключены. Отправьте /start, чтобы запросить доступ снова."
    else:
        msg = "❌ Заявка отклонена."
    send_message(token, chat_id, msg, reply_markup=remove_keyboard())


def _discover_group_from_activity(
    workspace_owner_id: str,
    token: str,
    bot_id: int,
    chat: dict[str, Any],
) -> None:
    """Register group when bot already was a member before webhook (any group message)."""
    chat_id = int(chat.get("id") or 0)
    if not chat_id or not bot_id:
        return
    title = _chat_title(chat)
    try:
        member = get_chat_member(token, chat_id, bot_id)
        is_admin = bot_is_admin(member)
    except Exception as exc:
        logger.warning("[telegram] discover group chat=%s: %s", chat_id, exc)
        return
    upsert_chat(
        workspace_owner_id,
        chat_id=chat_id,
        chat_type=str(chat.get("type") or "group"),
        title=title,
        bot_is_admin=is_admin,
    )


def _on_bot_added_to_group(
    workspace_owner_id: str,
    token: str,
    bot_id: int,
    chat: dict[str, Any],
    org_name: str,
) -> None:
    chat_id = int(chat.get("id") or 0)
    title = _chat_title(chat)
    try:
        member = get_chat_member(token, chat_id, bot_id)
        is_admin = bot_is_admin(member)
    except Exception as exc:
        logger.warning("[telegram] getChatMember on join %s: %s", chat_id, exc)
        is_admin = False
    upsert_chat(
        workspace_owner_id,
        chat_id=chat_id,
        chat_type=str(chat.get("type") or "group"),
        title=title,
        bot_is_admin=is_admin,
    )
    if is_admin:
        _send_group_welcome(
            token,
            chat_id,
            (
                f"✅ Бот «{_esc(org_name)}» подключён к группе «{_esc(title)}».\n\n"
                "Теперь включите эту группу в <b>Настройки → Telegram уведомление</b>."
            ),
            workspace_owner_id=workspace_owner_id,
            kind="admin_join",
        )
    else:
        _send_group_welcome(
            token,
            chat_id,
            (
                f"👋 Я в группе «{_esc(title)}».\n\n"
                "Назначьте меня <b>администратором</b>, чтобы группа появилась в U-POS FINANCE."
            ),
            workspace_owner_id=workspace_owner_id,
            kind="member_join",
        )


def _handle_my_chat_member(
    workspace_owner_id: str,
    token: str,
    bot_id: int,
    event: dict[str, Any],
    org_name: str,
) -> None:
    chat = event.get("chat") or {}
    chat_id = int(chat.get("id") or 0)
    chat_type = str(chat.get("type") or "group")
    if chat_type not in {"group", "supergroup", "channel"}:
        return

    new_member = event.get("new_chat_member") or {}
    old_member = event.get("old_chat_member") or {}
    new_user = new_member.get("user") or {}
    if int(new_user.get("id") or 0) != bot_id:
        return

    old_status = str(old_member.get("status") or "").lower()
    new_status = str(new_member.get("status") or "").lower()
    title = _chat_title(chat)
    is_admin = _is_admin_status(new_status)

    if new_status in {"kicked", "left"}:
        remove_chat_by_telegram_id(workspace_owner_id, chat_id)
        return

    upsert_chat(
        workspace_owner_id,
        chat_id=chat_id,
        chat_type=chat_type,
        title=title,
        bot_is_admin=is_admin,
    )

    if is_admin and not _is_admin_status(old_status):
        _send_group_welcome(
            token,
            chat_id,
            (
                f"✅ Спасибо! Теперь я администратор в «{_esc(title)}».\n\n"
                f"Включите эту группу для отчётов в U-POS FINANCE ({_esc(org_name)})."
            ),
            workspace_owner_id=workspace_owner_id,
            kind="promoted_admin",
        )
    elif new_status == "member" and old_status in {"left", "kicked", ""}:
        _send_group_welcome(
            token,
            chat_id,
            (
                f"👋 Бот «{_esc(org_name)}» добавлен в «{_esc(title)}».\n\n"
                "Назначьте меня <b>администратором</b>, чтобы получать отчёты по кассе."
            ),
            workspace_owner_id=workspace_owner_id,
            kind="joined_member",
        )
    elif _is_admin_status(old_status) and not is_admin:
        _send_group_welcome(
            token,
            chat_id,
            (
                f"⚠️ В группе «{_esc(title)}» у бота сняли права администратора.\n\n"
                "Группа отключена в U-POS FINANCE. Верните права админа, чтобы снова получать отчёты."
            ),
            workspace_owner_id=workspace_owner_id,
            kind="demoted_admin",
        )

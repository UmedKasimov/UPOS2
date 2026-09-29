"""Проверки автозапуска и продолжения прерванной синхронизации IBOX."""

from __future__ import annotations

import sys
import types
import unittest
from datetime import UTC, datetime, timedelta

db_stub = types.ModuleType("upos.db")
db_stub.session_scope = lambda: None
models_stub = types.ModuleType("upos.db_models")
for model_name in (
    "AccountBalance",
    "Branch",
    "Counterparty",
    "ExpenseDocument",
    "ExternalRecord",
    "FinanceAccount",
    "IntegrationSyncRun",
    "PaymentDocument",
    "Product",
    "PurchaseDocument",
    "SaleDocument",
    "Warehouse",
):
    setattr(models_stub, model_name, type(model_name, (), {}))
storage_stub = types.ModuleType("upos.storage")
storage_stub.load_workspace_settings = lambda workspace_owner_id: {}
storage_stub.save_workspace_settings = lambda workspace_owner_id, settings: None
sys.modules.setdefault("upos.db", db_stub)
sys.modules.setdefault("upos.db_models", models_stub)
sys.modules.setdefault("upos.storage", storage_stub)

from upos import smpro_store
from upos.smpro_client import DEFAULT_MODULES
from upos.smpro_store import _ibox_ready_to_sync, _sync_interval, is_run_stale


def only_modules(*names):
    """Настройка разделов: не указанные в ней модули считаются включёнными."""
    return {key: key in names for key in DEFAULT_MODULES}


def ready_config(**extra):
    config = {
        "api_url": "https://example.test",
        "api_key": "key",
        "filial_id": "1",
        "upos_branch_id": "branch",
        "sync_enabled": True,
    }
    config.update(extra)
    return config


class RunStaleTests(unittest.TestCase):
    def test_завершённый_запуск_не_считается_зависшим(self):
        self.assertFalse(is_run_stale({"status": "ok"}))

    def test_свежий_запуск_живой(self):
        moment = datetime.now(UTC).isoformat()
        self.assertFalse(is_run_stale({"status": "running", "started_at": moment}))

    def test_давно_стартовавший_но_отчитавшийся_запуск_живой(self):
        # Полная выгрузка идёт дольше пяти минут; пока приходят отметки о
        # пройденных модулях, обрывать её нельзя.
        started = (datetime.now(UTC) - timedelta(hours=2)).isoformat()
        heartbeat = (datetime.now(UTC) - timedelta(seconds=30)).isoformat()
        self.assertFalse(
            is_run_stale({"status": "running", "started_at": started, "data": {"heartbeat": heartbeat}})
        )

    def test_молчащий_запуск_считается_оборванным(self):
        started = (datetime.now(UTC) - timedelta(hours=2)).isoformat()
        heartbeat = (datetime.now(UTC) - timedelta(minutes=40)).isoformat()
        self.assertTrue(
            is_run_stale({"status": "running", "started_at": started, "data": {"heartbeat": heartbeat}})
        )

    def test_запуск_без_отметок_проверяется_по_старту(self):
        started = (datetime.now(UTC) - timedelta(minutes=30)).isoformat()
        self.assertTrue(is_run_stale({"status": "running", "started_at": started}))


class ReadyToSyncTests(unittest.TestCase):
    def test_полностью_настроенная_интеграция_готова(self):
        self.assertTrue(_ibox_ready_to_sync(ready_config()))

    def test_выключенная_синхронизация_пропускается(self):
        self.assertFalse(_ibox_ready_to_sync(ready_config(sync_enabled=False)))

    def test_без_филиала_upos_не_запускаем(self):
        self.assertFalse(_ibox_ready_to_sync(ready_config(upos_branch_id="")))

    def test_без_филиала_ibox_не_запускаем(self):
        self.assertFalse(_ibox_ready_to_sync(ready_config(filial_id="", terminal_id="", filial_ids=[])))

    def test_список_филиалов_заменяет_одиночный(self):
        self.assertTrue(_ibox_ready_to_sync(ready_config(filial_id="", filial_ids=["7"])))

    def test_все_разделы_выключены_запускать_нечего(self):
        config = ready_config(sync_modules=only_modules())
        self.assertFalse(_ibox_ready_to_sync(config))


class SyncIntervalTests(unittest.TestCase):
    def test_интервал_по_умолчанию_час(self):
        self.assertEqual(_sync_interval({}), timedelta(minutes=60))

    def test_свой_интервал_учитывается(self):
        self.assertEqual(_sync_interval({"sync_interval_minutes": 15}), timedelta(minutes=15))

    def test_слишком_частый_интервал_подтягивается_к_минимуму(self):
        self.assertEqual(_sync_interval({"sync_interval_minutes": 1}), timedelta(minutes=5))

    def test_мусор_в_настройке_не_ломает_расписание(self):
        self.assertEqual(_sync_interval({"sync_interval_minutes": "часто"}), timedelta(minutes=60))


class ClaimSyncTests(unittest.TestCase):
    def setUp(self):
        self._settings = smpro_store.load_workspace_settings
        self._status = smpro_store.last_smpro_status
        self._start = smpro_store.start_smpro_sync

    def tearDown(self):
        smpro_store.load_workspace_settings = self._settings
        smpro_store.last_smpro_status = self._status
        smpro_store.start_smpro_sync = self._start

    def prepare(self, config, status):
        smpro_store.load_workspace_settings = lambda wid: {"integrations": {"ibox": config}}
        smpro_store.last_smpro_status = lambda wid: status
        smpro_store.start_smpro_sync = lambda wid: {"id": "новый", "already_running": False}

    def test_прерванный_проход_продолжается_с_тем_же_номером(self):
        stale = {
            "id": "прежний",
            "status": "running",
            "started_at": (datetime.now(UTC) - timedelta(hours=1)).isoformat(),
            "data": {"heartbeat": (datetime.now(UTC) - timedelta(minutes=30)).isoformat()},
        }
        self.prepare(ready_config(), stale)
        claim = smpro_store.claim_smpro_sync("w1")
        self.assertEqual(claim, {"id": "прежний", "resumed": True})

    def test_живой_проход_не_трогаем(self):
        alive = {
            "id": "идёт",
            "status": "running",
            "started_at": datetime.now(UTC).isoformat(),
            "data": {"heartbeat": datetime.now(UTC).isoformat()},
        }
        self.prepare(ready_config(), alive)
        self.assertIsNone(smpro_store.claim_smpro_sync("w1"))

    def test_недавняя_синхронизация_ждёт_своего_часа(self):
        config = ready_config(last_sync_at=(datetime.now(UTC) - timedelta(minutes=10)).isoformat())
        self.prepare(config, {"id": "старый", "status": "ok"})
        self.assertIsNone(smpro_store.claim_smpro_sync("w1"))

    def test_по_истечении_интервала_стартует_новый_проход(self):
        config = ready_config(last_sync_at=(datetime.now(UTC) - timedelta(hours=3)).isoformat())
        self.prepare(config, {"id": "старый", "status": "ok"})
        claim = smpro_store.claim_smpro_sync("w1")
        self.assertEqual(claim, {"id": "новый", "resumed": False})

    def test_ненастроенная_интеграция_пропускается(self):
        self.prepare({"api_url": "", "api_key": ""}, None)
        self.assertIsNone(smpro_store.claim_smpro_sync("w1"))


class FakeClient:
    """Подставной клиент IBOX: запоминает, какие модули у него спросили."""

    def __init__(self, config):
        self.warnings = []
        FakeClient.requested = []

    def fetch_modules(self, modules, *, full_history, since, context=None):
        FakeClient.requested.extend(modules)
        FakeClient.last_context = context
        if "products" in modules:
            return {"products": [{"id": "p1"}], "price_types": [{"id": "pt1", "name": "Розница"}]}
        return {modules[0]: [{"id": f"{modules[0]}-1"}]}


class ResumeSyncTests(unittest.TestCase):
    def setUp(self):
        self.saved = {}
        self.finished = {}
        self.stored = []
        self._orig = {
            name: getattr(smpro_store, name)
            for name in (
                "SMProClient", "_store_entities", "_run_progress", "_save_run_progress",
                "_finish_run", "load_workspace_settings", "save_workspace_settings",
            )
        }
        smpro_store.SMProClient = FakeClient
        smpro_store._store_entities = lambda wid, entities: (self.stored.append(entities), 1)[1]
        smpro_store._save_run_progress = lambda run_id, progress, imported: self.saved.update(progress)
        smpro_store._finish_run = lambda run_id, status, imported, **kw: self.finished.update(
            {"status": status, "imported": imported, **kw}
        )
        smpro_store.load_workspace_settings = lambda wid: {
            "integrations": {"ibox": ready_config(sync_modules=only_modules("products", "stock", "sales"))}
        }
        smpro_store.save_workspace_settings = lambda wid, settings: None

    def tearDown(self):
        for name, value in self._orig.items():
            setattr(smpro_store, name, value)

    def test_первый_проход_забирает_все_выбранные_модули(self):
        smpro_store._run_progress = lambda run_id: {}
        smpro_store.run_smpro_sync("w1", "run1")
        self.assertEqual(FakeClient.requested, ["products", "stock", "sales"])
        self.assertEqual(self.finished.get("status"), "ok")

    def test_повтор_после_обрыва_не_переделывает_готовое(self):
        smpro_store._run_progress = lambda run_id: {
            "completed_modules": ["products", "stock"],
            "entities": {"products": 1},
            "imported": 1,
            "price_types": [{"id": "pt1", "name": "Розница"}],
            "full_history": True,
            "since": "",
        }
        smpro_store.run_smpro_sync("w1", "run1")
        self.assertEqual(FakeClient.requested, ["sales"])
        self.assertEqual(self.finished.get("imported"), 2)

    def test_типы_цен_переживают_обрыв_и_доходят_до_остатков(self):
        # Остатки перебираются по типам цен из модуля товаров: после обрыва
        # они должны прийти из сохранённого прогресса, а не потеряться.
        smpro_store._run_progress = lambda run_id: {
            "completed_modules": ["products"],
            "price_types": [{"id": "pt1", "name": "Розница"}],
        }
        smpro_store.run_smpro_sync("w1", "run1")
        self.assertEqual(FakeClient.last_context, {"price_types": [{"id": "pt1", "name": "Розница"}]})

    def test_прогресс_записывается_после_каждого_модуля(self):
        smpro_store._run_progress = lambda run_id: {}
        smpro_store.run_smpro_sync("w1", "run1")
        self.assertEqual(self.saved.get("completed_modules"), ["products", "stock", "sales"])


if __name__ == "__main__":
    unittest.main()

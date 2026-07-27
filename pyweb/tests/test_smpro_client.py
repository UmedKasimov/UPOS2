from __future__ import annotations

import unittest

import httpx

from upos.smpro_client import SMProClient, SMProError, SMProResource


class SMProClientTests(unittest.TestCase):
    def test_connection_loads_filials_without_filial_header(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            self.assertEqual(request.headers["Authorization"], "Bearer secret")
            self.assertNotIn("Filial-Id", request.headers)
            return httpx.Response(200, json={"data": [{"id": 7, "name": "Main"}]})

        client = SMProClient(
            {"api_url": "smpro.example", "api_key": "secret"},
            transport=httpx.MockTransport(handler),
        )

        result = client.test_connection()

        self.assertEqual(result["filial_count"], 1)
        self.assertEqual(result["filials"][0]["id"], 7)
        self.assertEqual(result["filial_id"], "7")
        self.assertEqual(result["filial_ids"], ["7"])

    def test_connection_uses_ascii_filial_code_when_id_is_not_ascii(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                json={"data": [{"id": "Главный филиал", "code": "branch-42"}]},
            )

        client = SMProClient(
            {"api_url": "smpro.example", "api_key": "secret"},
            transport=httpx.MockTransport(handler),
        )

        result = client.test_connection()

        self.assertEqual(result["filial_id"], "branch-42")

    def test_non_ascii_filial_header_returns_friendly_error(self) -> None:
        client = SMProClient(
            {
                "api_url": "smpro.example",
                "api_key": "secret",
                "filial_id": "Главный филиал",
            },
            transport=httpx.MockTransport(lambda request: httpx.Response(200, json={"data": []})),
        )

        with self.assertRaisesRegex(SMProError, "Технический ID филиала IBOX"):
            client.fetch_resource(
                SMProResource("orders", "api/integration/document/order/list"),
                full_history=True,
            )

    def test_resource_paginates_and_sends_filial(self) -> None:
        requested_pages: list[int] = []

        def handler(request: httpx.Request) -> httpx.Response:
            self.assertEqual(request.headers["Filial-Id"], "42")
            self.assertEqual(request.url.params["per_page"], "100")
            page = int(request.url.params["page"])
            requested_pages.append(page)
            return httpx.Response(
                200,
                json={
                    "data": [{"id": page}],
                    "meta": {"current_page": page, "last_page": 2},
                },
            )

        client = SMProClient(
            {
                "api_url": "https://smpro.example/",
                "api_key": "secret",
                "filial_id": "42",
            },
            transport=httpx.MockTransport(handler),
        )

        rows = client.fetch_resource(
            SMProResource("orders", "api/integration/document/order/list"),
            full_history=True,
        )

        self.assertEqual(requested_pages, [1, 2])
        self.assertEqual([row["id"] for row in rows], [1, 2])

    def test_incremental_sync_adds_period_from(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            self.assertEqual(request.url.params["period[from]"], "2026-07-01")
            return httpx.Response(200, json={"data": []})

        client = SMProClient(
            {"api_url": "smpro.example", "api_key": "secret", "filial_id": "42"},
            transport=httpx.MockTransport(handler),
        )

        client.fetch_resource(
            SMProResource("orders", "api/integration/document/order/list"),
            full_history=False,
            since="2026-07-01T12:00:00+00:00",
        )

    def test_modules_merge_rows_from_all_configured_filials(self) -> None:
        requested_filials: list[str] = []

        def handler(request: httpx.Request) -> httpx.Response:
            filial_id = request.headers["Filial-Id"]
            requested_filials.append(filial_id)
            return httpx.Response(
                200,
                json={"data": [{"id": int(filial_id) * 10}]},
            )

        client = SMProClient(
            {
                "api_url": "smpro.example",
                "api_key": "secret",
                "filial_id": "1",
                "filial_ids": ["1", "2", "3"],
            },
            transport=httpx.MockTransport(handler),
        )

        result = client.fetch_modules(["sales"], full_history=True)

        self.assertEqual(requested_filials, ["1", "2", "3"] * 3)
        self.assertEqual(
            [row["_ibox_filial_id"] for row in result["shipments"]],
            ["1", "2", "3"],
        )


if __name__ == "__main__":
    unittest.main()

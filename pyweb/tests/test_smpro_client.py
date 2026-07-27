from __future__ import annotations

import unittest

import httpx

from upos.smpro_client import SMProClient, SMProResource


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

    def test_resource_paginates_and_sends_filial(self) -> None:
        requested_pages: list[int] = []

        def handler(request: httpx.Request) -> httpx.Response:
            self.assertEqual(request.headers["Filial-Id"], "42")
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


if __name__ == "__main__":
    unittest.main()

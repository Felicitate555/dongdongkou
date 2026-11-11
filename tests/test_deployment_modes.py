import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.chdir(ROOT)

from server import config
from server.main import app


class DeploymentModeTests(unittest.TestCase):
    def test_system_click_batch_is_bounded_before_input(self):
        with patch("server.main.mouse.click") as click:
            response = TestClient(app).post("/api/mouse/click", json={"clicks": 1000000})
        self.assertEqual(response.status_code, 422)
        click.assert_not_called()

    def test_public_denies_every_input_and_control_route(self):
        payloads = {
            "/api/control/start": {}, "/api/control/stop": {},
            "/api/mouse/move": {"x": 10, "y": 10},
            "/api/mouse/click": {}, "/api/mouse/scroll": {},
            "/api/mouse/drag": {"x1": 1, "y1": 1, "x2": 2, "y2": 2},
            "/api/mouse/down": {}, "/api/mouse/up": {},
            "/api/keyboard/type": {"text": "test"},
            "/api/keyboard/hotkey": {"keys": ["escape"]},
        }
        with patch.dict(os.environ, {"DDK_DEPLOYMENT_MODE": "public", "DDK_SYSTEM_CONTROL": "1"}):
            client = TestClient(app)
            for route, body in payloads.items():
                with self.subTest(route=route):
                    self.assertEqual(client.post(route, json=body).status_code, 403)

    def test_local_rejects_input_without_session_and_after_stop(self):
        with (
            patch.dict(os.environ, {"DDK_DEPLOYMENT_MODE": "local", "DDK_SYSTEM_CONTROL": "1"}),
            patch("server.main.mouse.available", return_value=True),
            patch("server.main.mouse.position", return_value=(100, 100)),
            patch("server.main.mouse.release_all") as release,
            patch("server.main.mouse.mouse_down", return_value={"success": True}) as down,
        ):
            client = TestClient(app)
            self.assertEqual(client.post("/api/mouse/down", json={}).status_code, 409)
            token = client.post("/api/control/start").json()["session"]
            headers = {"X-DDK-Control-Session": token, "X-DDK-Control-Sequence": "1"}
            self.assertEqual(client.post("/api/mouse/down", json={}, headers=headers).status_code, 200)
            self.assertEqual(client.post("/api/control/stop", headers=headers).status_code, 200)
            headers["X-DDK-Control-Sequence"] = "2"
            self.assertEqual(client.post("/api/mouse/down", json={}, headers=headers).status_code, 409)
            self.assertEqual(down.call_count, 1)
            release.assert_called_once()

    def test_public_mode_cannot_enable_host_control(self):
        calls = []
        with (
            patch.object(config, "DEPLOYMENT_MODE", "public", create=True),
            patch.object(config, "SYSTEM_CONTROL_ENABLED", True),
            patch.dict(os.environ, {"DDK_SYSTEM_CONTROL": "1"}),
            patch("server.main.mouse.move", side_effect=lambda x, y: calls.append((x, y)) or {"success": True}),
        ):
            client = TestClient(app)
            health = client.get("/api/health").json()
            response = client.post("/api/mouse/move", json={"x": 10, "y": 10})

        self.assertEqual(health["deployment_mode"], "public")
        self.assertFalse(health["system_control"])
        self.assertEqual(response.status_code, 403)
        self.assertEqual(calls, [])

    def test_local_control_endpoint_dispatch_is_safe_to_test(self):
        calls = []
        with (
            patch.object(config, "DEPLOYMENT_MODE", "local", create=True),
            patch.object(config, "SYSTEM_CONTROL_ENABLED", True),
            patch.dict(os.environ, {"DDK_SYSTEM_CONTROL": ""}),
            patch("server.main.mouse.move", side_effect=lambda x, y: calls.append((x, y)) or {"success": True}),
            patch("server.main.mouse.position", return_value=(100, 100)),
            patch("server.main.mouse.release_all"),
        ):
            client = TestClient(app)
            token = client.post("/api/control/start").json()["session"]
            response = client.post("/api/mouse/move", json={"x": 123, "y": 234}, headers={"X-DDK-Control-Session": token, "X-DDK-Control-Sequence": "1"})
            client.post("/api/control/stop", headers={"X-DDK-Control-Session": token})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(calls, [(123, 234)])

    def test_ai_endpoint_limits_requests_per_client(self):
        import server.main as main

        with (
            patch.object(config, "DEPLOYMENT_MODE", "public", create=True),
            patch.object(config, "AI_RATE_LIMIT", 1, create=True),
            patch.object(main.ai_assist, "assist", return_value={"success": True, "elements": []}),
        ):
            if hasattr(main, "_AI_REQUESTS"):
                main._AI_REQUESTS.clear()
            client = TestClient(app)
            payload = {"image": "data:image/png;base64,AA==", "page": "demo"}
            first = client.post("/api/ai_assist", json=payload)
            second = client.post("/api/ai_assist", json=payload)
            if hasattr(main, "_AI_REQUESTS"):
                main._AI_REQUESTS.clear()

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 429)

    def test_system_input_api_does_not_allow_cross_origin_browser_calls(self):
        response = TestClient(app).options(
            "/api/mouse/move",
            headers={
                "Origin": "http://192.168.1.22:8787",
                "Access-Control-Request-Method": "POST",
            },
        )

        self.assertNotIn("access-control-allow-origin", response.headers)

    def test_public_ai_endpoint_rejects_large_request_before_parsing(self):
        with patch.object(config, "DEPLOYMENT_MODE", "public", create=True):
            response = TestClient(app).post(
                "/api/ai_assist",
                content="{}",
                headers={
                    "Content-Type": "application/json",
                    "Content-Length": str(config.AI_MAX_REQUEST_BYTES + 1),
                },
            )

        self.assertEqual(response.status_code, 413)

    def test_ai_endpoint_limits_chunked_body_without_content_length(self):
        with (
            patch.object(config, "DEPLOYMENT_MODE", "public", create=True),
            patch.object(app, "max_bytes", 32, create=True),
            patch("server.main.ai_assist.assist", return_value={"success": True, "elements": []}),
        ):
            response = TestClient(app).post(
                "/api/ai_assist",
                content=iter([b'{"image":"', b"a" * 40, b'","page":"demo"}']),
                headers={"Content-Type": "application/json"},
            )

        self.assertEqual(response.status_code, 413)

    def test_ai_rate_limit_state_is_bounded_across_many_client_addresses(self):
        import server.main as main

        with (
            patch.object(config, "DEPLOYMENT_MODE", "public", create=True),
            patch.object(config, "AI_RATE_LIMIT", 20, create=True),
            patch.object(config, "AI_RATE_MAX_CLIENTS", 2, create=True),
            patch("server.main.ai_assist.assist", return_value={"success": True, "elements": []}),
        ):
            main._AI_REQUESTS.clear()
            payload = {"image": "data:image/png;base64,AA==", "page": "demo"}
            first = TestClient(app, client=("198.51.100.1", 1234)).post("/api/ai_assist", json=payload)
            second = TestClient(app, client=("198.51.100.2", 1234)).post("/api/ai_assist", json=payload)
            third = TestClient(app, client=("198.51.100.3", 1234)).post("/api/ai_assist", json=payload)
            stored_clients = len(main._AI_REQUESTS)
            main._AI_REQUESTS.clear()

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(third.status_code, 429)
        self.assertLessEqual(stored_clients, 2)

    def test_public_health_does_not_expose_host_hardware_details(self):
        with patch.object(config, "DEPLOYMENT_MODE", "public", create=True):
            health = TestClient(app).get("/api/health").json()

        self.assertFalse(health["system_control"])
        self.assertFalse(health["mouse"])
        self.assertFalse(health["keyboard"])
        self.assertIsNone(health["screen"])

    def test_untrusted_host_header_is_rejected(self):
        response = TestClient(app, base_url="http://attacker.invalid").get("/")

        self.assertEqual(response.status_code, 400)

    def test_ai_image_dimensions_are_checked_before_decode(self):
        import base64
        from io import BytesIO

        from PIL import Image

        from server.utils import decode_base64_image

        image = Image.new("RGB", (100, 100), color="white")
        buffer = BytesIO()
        image.save(buffer, format="PNG")
        data = "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")

        with patch.object(config, "AI_MAX_IMAGE_PIXELS", 500, create=True):
            decoded = decode_base64_image(data)

        self.assertIsNone(decoded)

    def test_pages_include_security_headers(self):
        response = TestClient(app).get("/")

        self.assertEqual(response.headers.get("x-content-type-options"), "nosniff")
        self.assertEqual(response.headers.get("x-frame-options"), "DENY")
        self.assertIn("frame-ancestors 'none'", response.headers.get("content-security-policy", ""))

    def test_public_image_upgrades_pip_before_installing_dependencies(self):
        from pathlib import Path

        dockerfile = (Path(__file__).resolve().parents[1] / "Dockerfile").read_text(encoding="utf-8")

        self.assertIn("python -m pip install --no-cache-dir --upgrade pip", dockerfile)

    def test_stylesheets_revalidate_after_a_deployment(self):
        response = TestClient(app).get("/css/console.css")

        self.assertIn("no-cache", response.headers.get("cache-control", ""))


if __name__ == "__main__":
    unittest.main()

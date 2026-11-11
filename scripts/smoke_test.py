"""国一版冒烟测试（精准头控升级后）。"""
from __future__ import annotations

import os
import subprocess
import sys
from unittest.mock import patch
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.chdir(ROOT)

PY = sys.executable


def _node_cmd() -> str | None:
    env = os.environ.get("MIMO_NODE")
    if env and Path(env).exists():
        return env
    from shutil import which

    return which("node")


def test_imports():
    from server import config
    from server.main import app

    assert config.PORT == 8787
    assert hasattr(config, "SYSTEM_CONTROL_ENABLED")
    assert config.SYSTEM_CONTROL_ENABLED is False
    assert app is not None
    print("[ok] imports + system_control default off")


def test_pages():
    from fastapi.testclient import TestClient
    from server.main import app

    c = TestClient(app)
    for path in ["/", "/console.html", "/demo.html", "/architecture.html", "/api/health"]:
        r = c.get(path)
        assert r.status_code == 200, f"{path} -> {r.status_code}"
    h = c.get("/api/health").json()
    assert h["status"] == "ok"
    assert h.get("system_control") is False
    print("[ok] pages + health system_control=false")


def test_static_models():
    m = ROOT / "static" / "models"
    assert (m / "face_landmarker.task").exists()
    assert (m / "wasm" / "vision_wasm_internal.wasm").exists()
    assert (m / "vision_bundle.mjs").exists()
    print("[ok] models present")


def test_static_no_hard_cdn_dependency():
    index = (ROOT / "static" / "index.html").read_text(encoding="utf-8")
    console = (ROOT / "static" / "console.html").read_text(encoding="utf-8")
    assert "cdn.tailwindcss.com" not in index, "index.html still depends on Tailwind CDN"
    assert "cdn.jsdelivr.net" not in console, "console.html still depends on jsdelivr"
    for name, html in [("index", index), ("console", console)]:
        for line in html.splitlines():
            if "<script" in line and "src=" in line and ("http://" in line or "https://" in line):
                raise AssertionError(f"{name}.html has external script: {line.strip()}")
    print("[ok] no external script CDN on index/console")


def test_ai_local():
    import base64

    import cv2
    import numpy as np

    from server.ai_assist import assist

    img = np.zeros((400, 600, 3), dtype=np.uint8)
    cv2.rectangle(img, (80, 80), (280, 160), (255, 255, 255), -1)
    cv2.rectangle(img, (320, 80), (520, 160), (200, 200, 200), -1)
    cv2.rectangle(img, (80, 220), (520, 320), (180, 180, 180), 3)
    ok, buf = cv2.imencode(".png", img)
    assert ok
    b64 = base64.b64encode(buf).decode()
    # The developer's optional MiMo key may be present. Keep this check local
    # so test data never leaves the machine or spends the user's API quota.
    with patch("server.ai_assist._qwen_detect", return_value=None):
        r = assist(b64, "test")
    assert r["success"] is True
    assert isinstance(r["elements"], list)
    print(f"[ok] ai local elements={len(r['elements'])} fallback={r.get('fallback')}")


def test_system_mouse_default_denied():
    from fastapi.testclient import TestClient
    from server import config
    from server.main import app

    assert config.SYSTEM_CONTROL_ENABLED is False
    c = TestClient(app)
    r = c.post("/api/mouse/move", json={"x": 10, "y": 10})
    assert r.status_code == 403, f"expected 403 when system control off, got {r.status_code}"
    body = r.json()
    assert "系统控制" in str(body.get("detail", "")) or "system" in str(body.get("detail", "")).lower()
    r2 = c.post("/api/keyboard/type", json={"text": "hi"})
    assert r2.status_code == 403
    r3 = c.post("/api/mouse/down", json={"button": "left"})
    assert r3.status_code == 403
    r4 = c.post("/api/mouse/up", json={"button": "left"})
    assert r4.status_code == 403
    print("[ok] system mouse/keyboard/down/up denied by default")


def test_system_mouse_enabled_when_flag():
    from fastapi.testclient import TestClient
    from server import config
    from server.main import app

    old_cfg = config.SYSTEM_CONTROL_ENABLED
    old_env = os.environ.pop("DDK_SYSTEM_CONTROL", None)
    try:
        config.SYSTEM_CONTROL_ENABLED = True
        c = TestClient(app)
        h = c.get("/api/health").json()
        assert h.get("system_control") is True
        with (
            patch("server.main.mouse.move", return_value={"success": True}) as fake_move,
            patch("server.main.mouse.position", return_value=(100, 100)),
            patch("server.main.mouse.available", return_value=True),
            patch("server.main.mouse.release_all"),
        ):
            token = c.post("/api/control/start").json()["session"]
            headers = {"X-DDK-Control-Session": token, "X-DDK-Control-Sequence": "1"}
            r = c.post("/api/mouse/move", json={"x": 10, "y": 10}, headers=headers)
            c.post("/api/control/stop", headers={"X-DDK-Control-Session": token})
        assert r.status_code == 200, r.text
        fake_move.assert_called_once_with(10, 10)
        print(f"[ok] system control open when enabled status={r.status_code}")
    finally:
        config.SYSTEM_CONTROL_ENABLED = old_cfg
        if old_env is not None:
            os.environ["DDK_SYSTEM_CONTROL"] = old_env
        elif "DDK_SYSTEM_CONTROL" in os.environ:
            # 确保不会把开启状态泄漏给后续测试
            if os.environ.get("DDK_SYSTEM_CONTROL") not in ("1", "true", "yes", "on"):
                pass


def test_js_geometry():
    node = _node_cmd()
    script = ROOT / "scripts" / "test_geometry.mjs"
    if not node:
        print("[skip] node not found, skip js geometry")
        return
    r = subprocess.run([node, str(script)], capture_output=True, text=True, cwd=str(ROOT))
    assert r.returncode == 0, r.stderr or r.stdout
    print(r.stdout.strip() or "[ok] js geometry")


def test_geometry_file_exists():
    g = ROOT / "static" / "js" / "geometry.js"
    t = ROOT / "static" / "js" / "target-collector.js"
    assert g.exists() and t.exists()
    print("[ok] geometry + target-collector present")


if __name__ == "__main__":
    test_imports()
    test_static_models()
    test_geometry_file_exists()
    test_js_geometry()
    test_ai_local()
    test_pages()
    test_system_mouse_default_denied()
    test_system_mouse_enabled_when_flag()
    test_static_no_hard_cdn_dependency()
    print("\n[ok] all smoke checks passed")

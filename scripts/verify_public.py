"""Read-only deployment checks plus requests that must be denied in public mode."""
import concurrent.futures
import hashlib
import json
from pathlib import Path
import socket
import ssl
import urllib.error
import urllib.request

BASE = "https://dongdongko.fun"
ROOT = Path(__file__).resolve().parents[1]

def request(path, payload=None):
    req = urllib.request.Request(BASE + path, data=None if payload is None else json.dumps(payload).encode(), headers={} if payload is None else {"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return response.status, response.read(), dict(response.headers)
    except urllib.error.HTTPError as response:
        return response.code, response.read(), dict(response.headers)

paths = ["/", "/console.html", "/demo.html", "/architecture.html", "/api/health", "/docs", "/openapi.json"]
assets = ["js/control-runtime.js", "js/cursor-controller.js", "css/global.css", "css/demo.css", "models/face_landmarker.task", "models/wasm/vision_wasm_internal.wasm"]
paths += ["/" + p for p in assets]
report = {"url": BASE, "get": {}, "input_denied": {}}
with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
    for path, result in zip(paths, pool.map(request, paths)):
        status, body, headers = result
        expected = 404 if path in {"/docs", "/openapi.json"} else 200
        assert status == expected, (path, status)
        report["get"][path] = {"status": status, "bytes": len(body)}
        if path.lstrip("/") in assets:
            local = ROOT / "static" / path.lstrip("/")
            assert hashlib.sha256(body).digest() == hashlib.sha256(local.read_bytes()).digest(), path
            report["get"][path]["sha256_matches_local"] = True
        if path == "/api/health":
            health = json.loads(body)
            assert health["deployment_mode"] == "public" and health["system_control"] is False
            assert health["mouse"] is False and health["keyboard"] is False and health["screen"] is None
            report["health"] = health
payloads = {
    "/api/control/start": {}, "/api/control/stop": {},
    "/api/mouse/move": {"x": 10, "y": 10}, "/api/mouse/click": {}, "/api/mouse/scroll": {},
    "/api/mouse/drag": {"x1": 1, "y1": 1, "x2": 2, "y2": 2}, "/api/mouse/down": {}, "/api/mouse/up": {},
    "/api/keyboard/type": {"text": "test"}, "/api/keyboard/hotkey": {"keys": ["escape"]},
}
for path, payload in payloads.items():
    status, _, _ = request(path, payload)
    assert status == 403, (path, status)
    report["input_denied"][path] = status
with socket.create_connection(("dongdongko.fun", 443), timeout=15) as tcp:
    with ssl.create_default_context().wrap_socket(tcp, server_hostname="dongdongko.fun") as tls:
        cert = tls.getpeercert()
        report["tls"] = {"protocol": tls.version(), "notAfter": cert["notAfter"], "subjectAltName": cert["subjectAltName"]}
(ROOT / "artifacts/public-verification-20261021.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print("Verified HTTPS, 4 pages, 6 matching assets, 10 denied input routes, hidden API docs, TLS hostname and expiry")

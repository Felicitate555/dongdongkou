"""Build a contest source package with an explicit allowlist and secret check."""
import hashlib
import json
from pathlib import Path
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from server import config

OUT = ROOT / "artifacts/submission-20261021"
OUT.mkdir(parents=True, exist_ok=True)
names = ["README.md", "requirements.txt", "requirements-public.txt", "requirements-dev.txt", "run.py", "启动.bat", "Dockerfile", ".dockerignore", ".gitignore", ".env.example", "docker-compose.yml"]
paths = [ROOT / name for name in names]
for folder in ("server", "static", "tests", "deploy"):
    paths.extend(p for p in (ROOT / folder).rglob("*") if p.is_file() and "__pycache__" not in p.parts and p.name != "local_secrets.py" and p.suffix != ".pyc")
paths += [ROOT / "scripts" / name for name in ("smoke_test.py", "verify_public.py", "test_control_safety.mjs", "test_cursor_click.mjs", "test_ai_map.mjs", "test_geometry.mjs", "verify_assistant.py", "verify_desktop_camera.py")]
paths += [ROOT / "docs" / name for name in ("submission-2026-10-21.md", "deployment-2026-10-21.md", "deployment-assistant-final-20261021.md", "review-and-recording-20261021.md")]
entries = {p.relative_to(ROOT).as_posix(): p.read_bytes() for p in paths}
entries["作品封面.png"] = (OUT / "cover-1920x1080.png").read_bytes()
entries["开始阅读.md"] = ("# 动动口 · 作品包\n\n在线体验：https://dongdongko.fun/\n\n先读 README.md。Windows 本机模式需要 Python 3.11，使用 .venv 环境。公网演示可直接在浏览器打开，系统控制在云端被禁止。\n\n作品介绍与 AI 实践见 docs/submission-2026-10-21.md；源码为 server/ 和 static/，离线人脸模型与运行时在 static/models/。\n\n包内不含模型 API 密钥、虚拟环境、日志或个人参赛资料。真实摄像头/语音/系统控制需本人授权并人工验收。本机后台模式支持全局 Esc；兼容前台模式的网页 Esc 不是全局热键。购物与预约均为模拟流程。\n").encode()
key = config.QWEN_API_KEY.encode()
for name, data in entries.items():
    assert not any(x in name.lower() for x in ("local_secrets", "venv/", ".runtime.env", ".log", ".encrypted")), name
    assert not key or key not in data, "Secret found; archive rejected"
manifest = [{"path": name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()} for name, data in sorted(entries.items())]
entries["MANIFEST.json"] = json.dumps(manifest, ensure_ascii=False, indent=2).encode()
archive = OUT / "dongdongkou-submission-20261021.zip"
with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as z:
    for name, data in sorted(entries.items()):
        z.writestr(name, data)
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
(OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({"archive": str(archive), "files": len(entries), "bytes": archive.stat().st_size, "sha256": hashlib.sha256(archive.read_bytes()).hexdigest(), "secret_scan": "passed"}, ensure_ascii=False))

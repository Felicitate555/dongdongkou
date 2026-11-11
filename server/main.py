"""动动口 FastAPI 主应用。"""

from __future__ import annotations

import mimetypes
import os
import threading
import time
from contextlib import asynccontextmanager
from typing import Any, Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware
from pydantic import BaseModel, Field

from . import ai_assist, config, keyboard_controller as kb, mouse_controller as mouse
from .utils import get_lan_ip
from .control_safety import ControlSafety, ControlStopped
from . import accounts, assistant
from .desktop_control import DesktopControl

# dynamic import 要求 .mjs 为 JS MIME；.wasm 为 application/wasm
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/javascript", ".mjs")
mimetypes.add_type("application/wasm", ".wasm")
mimetypes.add_type("application/octet-stream", ".task")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("image/svg+xml", ".svg")

def _deployment_mode() -> str:
    value = os.getenv("DDK_DEPLOYMENT_MODE", getattr(config, "DEPLOYMENT_MODE", "local"))
    value = str(value).strip().lower()
    return value if value in {"local", "public"} else "public"


def _system_control_on() -> bool:
    # Public mode is a hard boundary: an environment override must never turn
    # the cloud server's physical mouse or keyboard into a visitor endpoint.
    if _deployment_mode() == "public":
        return False
    env = os.getenv("DDK_SYSTEM_CONTROL", "").strip().lower()
    if env in ("1", "true", "yes", "on"):
        return True
    if env in ("0", "false", "no", "off"):
        return False
    return bool(getattr(config, "SYSTEM_CONTROL_ENABLED", False))


def _require_system_control() -> None:
    if not _system_control_on():
        detail = (
            "公网部署已禁用宿主机鼠标与键盘控制。请在本机服务中体验完整控制。"
            if _deployment_mode() == "public"
            else "本机系统控制默认关闭。请在本机设置 DDK_SYSTEM_CONTROL=1 后重启服务。"
        )
        raise HTTPException(
            403,
            detail,
        )


control_safety = ControlSafety(mouse)
desktop_control = DesktopControl(control_safety, mouse)


@asynccontextmanager
async def lifespan(app):
    stopped = threading.Event()
    def watch():
        while not stopped.wait(0.1):
            try:
                control_safety.check()
            except Exception:
                control_safety.shutdown()
    watcher = threading.Thread(target=watch, name="ddk-control-watchdog", daemon=True)
    watcher.start()
    try:
        yield
    finally:
        desktop_control.stop()
        stopped.set()
        watcher.join(timeout=1)
        control_safety.shutdown()


app = FastAPI(
    lifespan=lifespan,
    title=config.APP_NAME,
    version=config.VERSION,
    docs_url=None if config.DEPLOYMENT_MODE == "public" else "/docs",
    redoc_url=None if config.DEPLOYMENT_MODE == "public" else "/redoc",
    openapi_url=None if config.DEPLOYMENT_MODE == "public" else "/openapi.json",
)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=config.ALLOWED_HOSTS)
app.include_router(accounts.router)
app.include_router(assistant.router)
_AUTH_ATTEMPTS: dict[str, list[float]] = {}
_AI_REQUESTS: dict[str, list[float]] = {}
_AI_REQUESTS_LOCK = threading.Lock()
_AI_REQUESTS_SWEEP_AT = 0.0


def _ai_rate_limited(client_ip: str, now: float) -> bool:
    global _AI_REQUESTS_SWEEP_AT
    window = max(1.0, float(config.AI_RATE_WINDOW_SEC))
    limit = max(1, int(config.AI_RATE_LIMIT))
    max_clients = max(1, int(config.AI_RATE_MAX_CLIENTS))
    window_start = now - window

    with _AI_REQUESTS_LOCK:
        if now - _AI_REQUESTS_SWEEP_AT >= window:
            for ip, stamps in list(_AI_REQUESTS.items()):
                fresh = [stamp for stamp in stamps if stamp > window_start]
                if fresh:
                    _AI_REQUESTS[ip] = fresh
                else:
                    _AI_REQUESTS.pop(ip, None)
            _AI_REQUESTS_SWEEP_AT = now

        recent = [stamp for stamp in _AI_REQUESTS.get(client_ip, []) if stamp > window_start]
        if len(recent) >= limit:
            _AI_REQUESTS[client_ip] = recent
            return True
        if client_ip not in _AI_REQUESTS and len(_AI_REQUESTS) >= max_clients:
            return True

        recent.append(now)
        _AI_REQUESTS[client_ip] = recent
        return False


@app.middleware("http")
async def guard_public_ai_requests(request, call_next):
    path = request.url.path
    if request.method in {"POST", "DELETE"} and path.startswith(("/api/auth/", "/api/chat", "/api/desktop/")):
        origin = request.headers.get("origin")
        expected_origin = ("https://" + request.headers.get("host", "")) if _deployment_mode() == "public" else str(request.base_url).rstrip("/")
        if origin and origin.rstrip("/") != expected_origin:
            return JSONResponse({"detail":"仅允许本站页面发起操作"},status_code=403)
    if request.method == "POST" and path in {"/api/auth/login", "/api/auth/register"}:
        ip = request.client.host if request.client else "unknown"
        now = time.monotonic()
        with _AI_REQUESTS_LOCK:
            for key in list(_AUTH_ATTEMPTS):
                if not _AUTH_ATTEMPTS[key] or _AUTH_ATTEMPTS[key][-1] < now-600: _AUTH_ATTEMPTS.pop(key,None)
            recent=[stamp for stamp in _AUTH_ATTEMPTS.get(ip,[]) if stamp>now-600]
            if len(recent)>=12 or (ip not in _AUTH_ATTEMPTS and len(_AUTH_ATTEMPTS)>=10000):
                return JSONResponse({"detail":"尝试次数较多，请十分钟后再试"},status_code=429)
            _AUTH_ATTEMPTS[ip]=recent+[now]
    if request.method == "POST" and path in {"/api/ai_assist", "/api/chat", "/api/chat/screen"}:
        client_ip = request.client.host if request.client else "unknown"
        if _ai_rate_limited(client_ip, time.monotonic()):
            return JSONResponse({"detail": "请求过于频繁，请稍后再试"}, status_code=429)

    return await call_next(request)


@app.middleware("http")
async def add_security_headers(request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("Permissions-Policy", "camera=(self), microphone=(self), geolocation=()")
    if request.url.path.startswith(("/api/auth/", "/api/chat", "/api/desktop/")):
        response.headers["Cache-Control"] = "no-store"
    if request.url.path == "/" or request.url.path.endswith(".html"):
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
    response.headers.setdefault(
        "Content-Security-Policy",
        "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; "
        "form-action 'self'; img-src 'self' data: blob:; font-src 'self' data:; "
        "style-src 'self' 'unsafe-inline'; script-src 'self' 'wasm-unsafe-eval'; "
        "worker-src 'self' blob:; connect-src 'self'; media-src 'self' blob:",
    )
    return response


STATIC = config.STATIC


class NoCacheStatic(StaticFiles):
    """开发用：脚本禁用强缓存。"""

    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)
        if response.status_code == 200:
            response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
            response.headers["Pragma"] = "no-cache"
        return response


class LongCacheStatic(StaticFiles):
    """模型/WASM 体积大，必须可缓存，否则每次开页都重下十几 MB。"""

    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)
        if response.status_code == 200:
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return response


app.mount("/css", NoCacheStatic(directory=str(STATIC / "css")), name="css")
app.mount("/js", NoCacheStatic(directory=str(STATIC / "js")), name="js")
app.mount("/models", LongCacheStatic(directory=str(STATIC / "models")), name="models")
app.mount("/assets", StaticFiles(directory=str(STATIC / "assets")), name="assets")


class MouseMove(BaseModel):
    x: int
    y: int


class MouseClick(BaseModel):
    button: str = "left"
    clicks: int = Field(default=1, ge=1, le=2)
    x: Optional[int] = None
    y: Optional[int] = None


class MouseScroll(BaseModel):
    dy: int = 0
    dx: int = 0


class MouseDrag(BaseModel):
    x1: int
    y1: int
    x2: int
    y2: int


class MouseDown(BaseModel):
    button: str = "left"
    x: Optional[int] = None
    y: Optional[int] = None


class MouseUp(BaseModel):
    button: str = "left"


class TypeIn(BaseModel):
    text: str = Field(min_length=1, max_length=1000)


class HotkeyIn(BaseModel):
    keys: list[str] = Field(min_length=1, max_length=6)


class AIIn(BaseModel):
    image: str = Field(min_length=1, max_length=config.AI_MAX_IMAGE_CHARS)
    page: str = ""


def _control_action(request: Request, action):
    _require_system_control()
    try:
        sequence = int(request.headers.get("X-DDK-Control-Sequence", "0"))
        return control_safety.execute(request.headers.get("X-DDK-Control-Session"), sequence, action)
    except (ControlStopped, ValueError) as error:
        raise HTTPException(409, str(error)) from error


@app.post("/api/control/start")
def start_control(request: Request):
    _require_system_control()
    # Reject cross-origin starts even if a browser can submit a simple POST.
    origin = request.headers.get("origin")
    if origin and origin.rstrip("/") != str(request.base_url).rstrip("/"):
        raise HTTPException(403, "系统控制仅允许同源本机页面开启")
    if not mouse.available():
        raise HTTPException(409, "系统鼠标不可用")
    try:
        token = control_safety.start()
        return {"success": True, "session": token, "timeout_ms": 750}
    except ControlStopped as error:
        raise HTTPException(409, str(error)) from error


@app.post("/api/control/stop")
def stop_control(request: Request):
    _require_system_control()
    control_safety.stop(request.headers.get("X-DDK-Control-Session"))
    return {"success": True}


@app.get("/api/health")
def health() -> dict[str, Any]:
    public = _deployment_mode() == "public"
    return {
        "status": "ok",
        "app": config.APP_NAME,
        "version": config.VERSION,
        "mouse": False if public else mouse.available(),
        "keyboard": False if public else kb.available(),
        "screen": None if public else list(mouse.screen_size()),
        "model": config.FACE_LANDMARKER.exists(),
        "system_control": _system_control_on(),
        "desktop_control": False if public else desktop_control.available(),
        "ai_chat": bool(config.QWEN_API_KEY),
        "deployment_mode": _deployment_mode(),
        "ts": time.time(),
    }


class DesktopSettings(BaseModel):
    sensitivity: float = Field(default=1.2,ge=.5,le=3)
    smoothing: float = Field(default=.5,ge=0,le=1)
    jaw_threshold: float = Field(default=.5,ge=.25,le=.85)
    mouth_enabled: bool = True

def _require_local_desktop(request):
    if _deployment_mode() != "local" or not request.client or request.client.host not in {"127.0.0.1","::1","testclient"}:
        raise HTTPException(403,"后台系统控制仅限 Windows 本机服务，公网已禁用")

@app.get("/api/desktop/status")
def desktop_status(request: Request):
    _require_local_desktop(request)
    return desktop_control.status()

@app.post("/api/desktop/start")
def desktop_start(body: DesktopSettings, request: Request):
    _require_local_desktop(request)
    try: return desktop_control.start(body.model_dump())
    except ValueError as error: raise HTTPException(409,str(error)) from error

@app.post("/api/desktop/stop")
def desktop_stop(request: Request):
    _require_local_desktop(request)
    desktop_control.stop()
    return desktop_control.status()

@app.post("/api/desktop/recenter")
def desktop_recenter(request: Request):
    _require_local_desktop(request)
    desktop_control.recenter_requested=True
    return {"success":True}

@app.get("/api/desktop/preview")
def desktop_preview(request: Request):
    _require_local_desktop(request)
    image=desktop_control.preview_jpeg if desktop_control.state.get("running") else None
    return Response(image or b"",status_code=200 if image else 204,media_type="image/jpeg",headers={"Cache-Control":"no-store"})

@app.post("/api/desktop/screenshot")
def desktop_screenshot(request: Request):
    _require_local_desktop(request)
    if not mouse.available():raise HTTPException(409,"本机截图不可用")
    import base64,io
    image=mouse.pyautogui.screenshot()
    image.thumbnail((1440,900))
    buffer=io.BytesIO();image.convert("RGB").save(buffer,format="JPEG",quality=78)
    return {"image":"data:image/jpeg;base64,"+base64.b64encode(buffer.getvalue()).decode()}

class GestureState(BaseModel):
    enabled: bool

@app.post("/api/desktop/gesture")
def desktop_gesture(body: GestureState, request: Request):
    _require_local_desktop(request)
    if body.enabled and not desktop_control.mouth_enabled:desktop_control.mouth_rearm=True
    desktop_control.mouth_enabled=body.enabled
    return {"success":True}


@app.post("/api/mouse/move")
def api_move(body: MouseMove, request: Request) -> dict[str, Any]:
    r = _control_action(request, lambda: mouse.move(body.x, body.y))
    if not r.get("success"):
        raise HTTPException(400, r.get("detail") or "move failed")
    return r


@app.post("/api/mouse/click")
def api_click(body: MouseClick, request: Request) -> dict[str, Any]:
    r = _control_action(request, lambda: mouse.click(body.button, body.clicks, body.x, body.y))
    if not r.get("success"):
        raise HTTPException(400, r.get("detail") or "click failed")
    return r


@app.post("/api/mouse/scroll")
def api_scroll(body: MouseScroll, request: Request) -> dict[str, Any]:
    r = _control_action(request, lambda: mouse.scroll(body.dy, body.dx))
    if not r.get("success"):
        raise HTTPException(400, r.get("detail") or "scroll failed")
    return r


@app.post("/api/mouse/drag")
def api_drag(body: MouseDrag, request: Request) -> dict[str, Any]:
    r = _control_action(request, lambda: mouse.drag(body.x1, body.y1, body.x2, body.y2))
    if not r.get("success"):
        raise HTTPException(400, r.get("detail") or "drag failed")
    return r


@app.post("/api/mouse/down")
def api_mouse_down(body: MouseDown, request: Request) -> dict[str, Any]:
    r = _control_action(request, lambda: mouse.mouse_down(body.button, body.x, body.y))
    if not r.get("success"):
        raise HTTPException(400, r.get("detail") or "mouse down failed")
    return r


@app.post("/api/mouse/up")
def api_mouse_up(body: MouseUp, request: Request) -> dict[str, Any]:
    r = _control_action(request, lambda: mouse.mouse_up(body.button))
    if not r.get("success"):
        raise HTTPException(400, r.get("detail") or "mouse up failed")
    return r


@app.post("/api/keyboard/type")
def api_type(body: TypeIn, request: Request) -> dict[str, Any]:
    r = _control_action(request, lambda: kb.type_text(body.text))
    if not r.get("success"):
        raise HTTPException(400, r.get("detail") or "type failed")
    return r


@app.post("/api/keyboard/hotkey")
def api_hotkey(body: HotkeyIn, request: Request) -> dict[str, Any]:
    r = _control_action(request, lambda: kb.hotkey(body.keys))
    if not r.get("success"):
        raise HTTPException(400, r.get("detail") or "hotkey failed")
    return r


@app.post("/api/ai_assist")
def api_ai(body: AIIn) -> dict[str, Any]:
    return ai_assist.assist(body.image, body.page)


def _page(name: str) -> FileResponse:
    path = STATIC / name
    if not path.exists():
        raise HTTPException(404, f"{name} not found")
    return FileResponse(str(path), media_type="text/html; charset=utf-8")


@app.get("/")
def index() -> FileResponse:
    return _page("index.html")


@app.get("/index.html")
def index_html() -> FileResponse:
    return _page("index.html")


@app.get("/console.html")
def console() -> FileResponse:
    return _page("console.html")


@app.get("/demo.html")
def demo() -> FileResponse:
    return _page("demo.html")


@app.get("/architecture.html")
def architecture() -> FileResponse:
    return _page("architecture.html")


@app.get("/favicon.ico")
def favicon() -> FileResponse:
    icon = STATIC / "assets" / "logo.svg"
    if icon.exists():
        return FileResponse(str(icon), media_type="image/svg+xml")
    raise HTTPException(404, "no favicon")


def main() -> None:
    import uvicorn

    ip = get_lan_ip()
    print("\n服务已启动！")
    print(f"本机访问: http://127.0.0.1:{config.PORT}")
    print(f"局域网访问: http://{ip}:{config.PORT}\n")
    if not config.FACE_LANDMARKER.exists():
        print("[警告] 缺少 face_landmarker.task，请放到 static/models/")
    uvicorn.run(app, host=config.HOST, port=config.PORT, log_level="info")


class AIRequestBodyLimitMiddleware:
    """Bound AI request memory before FastAPI parses JSON, including chunked bodies."""

    def __init__(self, app, max_bytes: int):
        self.app = app
        self.max_bytes = max(1, int(max_bytes))

    async def __call__(self, scope, receive, send):
        path=scope.get("path", "")
        if scope["type"] != "http" or scope.get("method") not in {"POST","DELETE"} or not (path == "/api/ai_assist" or path.startswith(("/api/chat", "/api/auth/", "/api/desktop/"))):
            await self.app(scope, receive, send)
            return

        limit = self.max_bytes if path in {"/api/ai_assist","/api/chat/screen"} else 64_000
        raw_length = dict(scope.get("headers", [])).get(b"content-length")
        if raw_length is not None:
            try:
                if int(raw_length) > limit:
                    await JSONResponse({"detail": "截图过大，请缩小画面后重试"}, status_code=413)(scope, receive, send)
                    return
            except ValueError:
                await JSONResponse({"detail": "请求大小无效"}, status_code=400)(scope, receive, send)
                return

        chunks: list[bytes] = []
        body_size = 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            if message["type"] != "http.request":
                continue
            chunk = message.get("body", b"")
            body_size += len(chunk)
            if body_size > limit:
                await JSONResponse({"detail": "截图过大，请缩小画面后重试"}, status_code=413)(scope, receive, send)
                return
            if chunk:
                chunks.append(chunk)
            if not message.get("more_body", False):
                break

        index = 0

        async def replay_body():
            nonlocal index
            if index < len(chunks):
                chunk = chunks[index]
                index += 1
                return {"type": "http.request", "body": chunk, "more_body": index < len(chunks)}
            return {"type": "http.request", "body": b"", "more_body": False}

        await self.app(scope, replay_body, send)


app = AIRequestBodyLimitMiddleware(app, config.AI_MAX_REQUEST_BYTES)


if __name__ == "__main__":
    main()

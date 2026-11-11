# 动动口 · 天猫AI黑客松
from pathlib import Path
import os

APP_NAME = "动动口"
APP_TAGLINE = "免手AI电脑助手"
VERSION = "1.0.0"

ROOT = Path(__file__).resolve().parent.parent
STATIC = ROOT / "static"
MODELS = STATIC / "models"
FACE_LANDMARKER = MODELS / "face_landmarker.task"

DEPLOYMENT_MODE = os.getenv("DDK_DEPLOYMENT_MODE", "local").strip().lower()
if DEPLOYMENT_MODE not in {"local", "public"}:
    raise RuntimeError("DDK_DEPLOYMENT_MODE must be 'local' or 'public'")

# 本机控制服务只监听回环地址；公网部署由反代接入并始终禁用宿主机控制。
HOST = os.getenv("DDK_HOST", "127.0.0.1" if DEPLOYMENT_MODE == "local" else "0.0.0.0")
PORT = 8787
ALLOWED_HOSTS = [
    host.strip()
    for host in os.getenv(
        "DDK_ALLOWED_HOSTS",
        "dongdongko.fun,localhost,127.0.0.1,[::1],testserver",
    ).split(",")
    if host.strip()
]

# 系统鼠标/键盘默认关闭；演示前显式打开（config 或环境变量 DDK_SYSTEM_CONTROL=1）
SYSTEM_CONTROL_ENABLED = False

# AI 截图缓存 TTL（秒）
AI_CACHE_TTL = 5.0
AI_MAX_ELEMENTS = 10
AI_TIMEOUT_SEC = 10.0
AI_MAX_IMAGE_CHARS = 4_500_000
AI_MAX_IMAGE_PIXELS = 2_073_600  # 1920 × 1080
AI_MAX_REQUEST_BYTES = 5_000_000
AI_RATE_LIMIT = 30
AI_RATE_WINDOW_SEC = 60
AI_RATE_MAX_CLIENTS = 10_000

# 可选云端看屏 — 小米 MiMo（OpenAI 兼容）
# 密钥优先：环境变量 QWEN_API_KEY > server/local_secrets.py > 下面留空
QWEN_API_KEY = ""  # 勿把真实 key 写进会提交的文件
QWEN_MODEL = "mimo-v2.6-flash"  # MiMo-V2.6-Flash（平台显示名）
QWEN_BASE = "https://api.xiaomimimo.com/v1"

try:
    from .local_secrets import QWEN_API_KEY as _LOCAL_KEY

    if _LOCAL_KEY:
        QWEN_API_KEY = _LOCAL_KEY
except Exception:
    pass

# Public deployments provide credentials only through the process environment.
QWEN_API_KEY = os.getenv("QWEN_API_KEY", QWEN_API_KEY).strip()

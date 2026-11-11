"""工具函数：本机 IP、图像编解码等。"""

from __future__ import annotations

import base64
import socket
import warnings
from io import BytesIO
from typing import Optional


def get_lan_ip() -> str:
    """获取本机局域网 IPv4（出网卡）。"""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
        finally:
            s.close()
    except OSError:
        try:
            return socket.gethostbyname(socket.gethostname())
        except OSError:
            return "127.0.0.1"


def decode_base64_image(data: str):
    """base64 → BGR ndarray；失败返回 None。"""
    import cv2
    import numpy as np
    from PIL import Image
    from . import config

    if not data:
        return None
    if "," in data:
        data = data.split(",", 1)[1]
    try:
        buf = base64.b64decode(data, validate=True)
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(buf)) as image:
                width, height = image.size
                if width < 1 or height < 1 or width * height > config.AI_MAX_IMAGE_PIXELS:
                    return None
                if image.format not in {"PNG", "JPEG", "WEBP"}:
                    return None
                image.load()
                rgb = np.asarray(image.convert("RGB"))
        return cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    except Exception:
        return None


def bbox_center(bbox: list[int]) -> list[int]:
    x1, y1, x2, y2 = bbox
    return [(x1 + x2) // 2, (y1 + y2) // 2]


def iou(a: list[int], b: list[int]) -> float:
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0, ix2 - ix1), max(0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0:
        return 0.0
    area_a = max(0, ax2 - ax1) * max(0, ay2 - ay1)
    area_b = max(0, bx2 - bx1) * max(0, by2 - by1)
    union = area_a + area_b - inter
    return inter / union if union else 0.0

"""AI 辅助：本地形状检测 + 可选小米 MiMo 控件图分析 + 缓存。"""

from __future__ import annotations

import hashlib
import json
import math
import os
import time
import urllib.error
import urllib.request
from typing import Any

from . import config
from .utils import bbox_center, decode_base64_image, iou

# {hash: (ts, payload)}
_CACHE: dict[str, tuple[float, dict]] = {}


def _hash_image(b64: str) -> str:
    # 整串 + 长度 + 头尾采样，降低仅尾部截断的碰撞面
    raw = b64.encode("utf-8", errors="ignore")
    n = len(raw)
    sample = raw[:2000] + raw[-2000:] if n > 4000 else raw
    h = hashlib.sha1(sample + str(n).encode()).hexdigest()
    return f"{h}:{n}"


def _ocr_text(img) -> str:
    """可选 OCR；未安装则返回空串。"""
    try:
        import pytesseract  # type: ignore

        import cv2

        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        text = pytesseract.image_to_string(gray, lang="chi_sim+eng")
        return (text or "").strip()[:40]
    except Exception:
        return ""


def _local_detect(image) -> list[dict[str, Any]]:
    """灰度 → 模糊 → Canny → 膨胀闭合 → 轮廓 → 过滤合并。"""
    import cv2
    import numpy as np

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blur, 50, 150)
    kernel = np.ones((3, 3), np.uint8)
    dil = cv2.dilate(edges, kernel, iterations=1)
    closed = cv2.morphologyEx(dil, cv2.MORPH_CLOSE, kernel, iterations=2)

    contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    boxes: list[list[int]] = []
    for c in contours:
        x, y, w, h = cv2.boundingRect(c)
        if w * h < 500 or w < 40 or h < 20:
            continue
        # 排除接近全图
        ih, iw = image.shape[:2]
        if w * h > 0.7 * iw * ih:
            continue
        boxes.append([int(x), int(y), int(x + w), int(y + h)])

    # 合并 IoU > 0.5
    merged: list[list[int]] = []
    for b in sorted(boxes, key=lambda z: -(z[2] - z[0]) * (z[3] - z[1])):
        if all(iou(b, m) <= 0.5 for m in merged):
            merged.append(b)

    # 左上到右下
    merged.sort(key=lambda z: (z[1] // 40, z[0]))

    elements = []
    for i, bbox in enumerate(merged[: config.AI_MAX_ELEMENTS]):
        crop = image[bbox[1] : bbox[3], bbox[0] : bbox[2]]
        text = _ocr_text(crop) if crop is not None and crop.size else ""
        elements.append(
            {
                "id": i,
                "text": text,
                "bbox": bbox,
                "center": bbox_center(bbox),
            }
        )
    return elements


def _qwen_detect(image_b64: str, page: str) -> dict[str, Any] | None:
    key = os.getenv("QWEN_API_KEY", config.QWEN_API_KEY or "").strip()
    if not key:
        return None
    import cv2

    # 控件结构图最多 960px 宽；保留原尺寸，使结果坐标可直接回映到视口。
    img = decode_base64_image(image_b64)
    if img is None:
        return None
    h, w = img.shape[:2]
    ok, buf = cv2.imencode(".jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), 75])
    if not ok:
        return None
    b64_small = "data:image/jpeg;base64," + __import__("base64").b64encode(buf).decode()

    prompt = (
        "你是无障碍助手。图像是一张网页控件结构图，方框内带有控件编号、类型、名称与位置，不是真实屏幕截图。"
        "只从可读的控件框中选出最有用的按钮、链接、选择框或输入框；不要补充图中不存在的目标。"
        '只返回 JSON：{"coordinate_space":"normalized_1000","elements":[{"text":"标签","bbox":[x1,y1,x2,y2]}]}。'
        "bbox 使用 0 到 1000 的归一化坐标：左上角为[0,0]，右下角为[1000,1000]，不要使用原图像素。最多8个。"
        + (f"当前页面上下文：{page}" if page else "")
    )
    payload = {
        "model": config.QWEN_MODEL,  # 默认 mimo-v2.6-flash
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image_url",
                        "image_url": {"url": b64_small},
                    },
                ],
            }
        ],
        "temperature": 0.1,
    }
    req = urllib.request.Request(
        config.QWEN_BASE.rstrip("/") + "/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {key}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=config.AI_TIMEOUT_SEC) as resp:
            body = json.loads(resp.read().decode("utf-8"))
        content = body["choices"][0]["message"]["content"]
        if isinstance(content, list):
            # 兼容部分网关返回 content parts
            content = "".join(
                part.get("text", "") if isinstance(part, dict) else str(part) for part in content
            )
        start, end = content.find("{"), content.rfind("}")
        if start < 0 or end < 0:
            return None
        obj = json.loads(content[start : end + 1])
        # Never infer a coordinate space from magnitudes; ambiguity can select
        # the wrong control. The requested protocol is normalized on both axes.
        if obj.get("coordinate_space") != "normalized_1000":
            return None
        els = obj.get("elements") or []
        out = []
        for e in els[: config.AI_MAX_ELEMENTS]:
            try:
                raw = [float(value) for value in e.get("bbox", [])]
                if len(raw) != 4 or not all(math.isfinite(v) and 0 <= v <= 1000 for v in raw):
                    continue
                raw = [raw[0] * w / 1000, raw[1] * h / 1000, raw[2] * w / 1000, raw[3] * h / 1000]
                x1, x2 = sorted((max(0, min(w, raw[0])), max(0, min(w, raw[2]))))
                y1, y2 = sorted((max(0, min(h, raw[1])), max(0, min(h, raw[3]))))
                if x2 <= x1 or y2 <= y1:
                    continue
                bbox = [int(x1), int(y1), int(x2), int(y2)]
                out.append({
                    "id": len(out),
                    "text": str(e.get("text") or "可交互区域")[:80],
                    "bbox": bbox,
                    "center": bbox_center(bbox),
                })
            except (TypeError, ValueError):
                continue
        return {"success": True, "elements": out, "fallback": False, "source": "mimo"}
    except Exception:
        return None


def assist(image_b64: str, page: str = "") -> dict[str, Any]:
    h = _hash_image(image_b64 + "|" + page)
    now = time.time()
    hit = _CACHE.get(h)
    if hit and now - hit[0] < config.AI_CACHE_TTL:
        cached = dict(hit[1])
        cached["cached"] = True
        return cached

    img = decode_base64_image(image_b64)
    if img is None:
        return {"success": False, "detail": "图片解码失败", "elements": [], "fallback": True}

    # 优先云端（配置了 key 时），失败回退本地
    cloud = _qwen_detect(image_b64, page)
    if cloud and cloud.get("elements"):
        _CACHE[h] = (now, cloud)
        cloud["cached"] = False
        return cloud

    try:
        elements = _local_detect(img)
    except Exception as e:
        return {"success": False, "detail": f"本地识别失败: {e}", "elements": [], "fallback": True}

    # 无 OCR 时给占位名
    for i, el in enumerate(elements):
        if not el.get("text"):
            el["text"] = f"区域{i + 1}"

    payload = {
        "success": True,
        "elements": elements,
        "fallback": True,
        "source": "local",
        "cached": False,
    }
    _CACHE[h] = (now, payload)
    return payload

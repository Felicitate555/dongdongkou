"""键盘输入封装：中文走剪贴板粘贴，英文 write。"""

from __future__ import annotations

from typing import Any

try:
    import pyautogui
    import pyperclip

    _OK = True
    _ERR = ""
except Exception as e:  # pragma: no cover
    pyautogui = None
    pyperclip = None
    _OK = False
    _ERR = str(e)


def available() -> bool:
    return _OK


def type_text(text: str) -> dict[str, Any]:
    if not _OK:
        return {"success": False, "detail": f"键盘模块不可用: {_ERR}"}
    if not text:
        return {"success": False, "detail": "文本为空"}
    try:
        # 含非 ASCII 用剪贴板
        if any(ord(ch) > 127 for ch in text):
            pyperclip.copy(text)
            pyautogui.hotkey("ctrl", "v", _pause=False)
        else:
            pyautogui.write(text, interval=0, _pause=False)
        return {"success": True}
    except Exception as e:
        return {"success": False, "detail": str(e)}


def hotkey(keys: list[str]) -> dict[str, Any]:
    if not _OK:
        return {"success": False, "detail": f"键盘模块不可用: {_ERR}"}
    if not keys:
        return {"success": False, "detail": "keys 为空"}
    try:
        cleaned = [str(k).lower() for k in keys if k]
        pyautogui.hotkey(*cleaned, _pause=False)
        return {"success": True}
    except Exception as e:
        return {"success": False, "detail": str(e)}

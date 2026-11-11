"""pyautogui 系统鼠标封装。无显示环境时安全降级。"""

from __future__ import annotations

from typing import Any

try:
    import pyautogui

    pyautogui.FAILSAFE = True
    pyautogui.PAUSE = 0
    _OK = True
    _ERR = ""
except Exception as e:  # pragma: no cover
    pyautogui = None
    _OK = False
    _ERR = str(e)


def available() -> bool:
    return _OK


def last_error() -> str:
    return _ERR


def position() -> tuple[int, int]:
    if not _OK:
        raise RuntimeError("系统鼠标不可用")
    return tuple(map(int, pyautogui.position()))


def release_all() -> None:
    """Release even in a failsafe corner; never move the pointer during cleanup."""
    if not _OK:
        return
    previous = pyautogui.FAILSAFE
    try:
        pyautogui.FAILSAFE = False
        for button in ("left", "right", "middle"):
            pyautogui.mouseUp(button=button, _pause=False)
    finally:
        pyautogui.FAILSAFE = previous


def screen_size() -> tuple[int, int]:
    if not _OK:
        return 1920, 1080
    w, h = pyautogui.size()
    return int(w), int(h)


def move(x: int, y: int) -> dict[str, Any]:
    if not _OK:
        return {"success": False, "detail": f"pyautogui 不可用: {_ERR}"}
    try:
        pyautogui.moveTo(int(x), int(y), _pause=False)
        return {"success": True}
    except Exception as e:
        return {"success": False, "detail": str(e)}


def click(
    button: str = "left",
    clicks: int = 1,
    x: int | None = None,
    y: int | None = None,
) -> dict[str, Any]:
    if not _OK:
        return {"success": False, "detail": f"pyautogui 不可用: {_ERR}"}
    try:
        if x is not None and y is not None:
            pyautogui.moveTo(int(x), int(y), _pause=False)
        btn = button if button in ("left", "right", "middle") else "left"
        pyautogui.click(button=btn, clicks=max(1, int(clicks)), _pause=False)
        return {"success": True}
    except Exception as e:
        return {"success": False, "detail": str(e)}


def scroll(dy: int = 0, dx: int = 0) -> dict[str, Any]:
    if not _OK:
        return {"success": False, "detail": f"pyautogui 不可用: {_ERR}"}
    try:
        if dy:
            pyautogui.scroll(int(dy), _pause=False)
        if dx:
            pyautogui.hscroll(int(dx), _pause=False)
        return {"success": True}
    except Exception as e:
        return {"success": False, "detail": str(e)}


def drag(x1: int, y1: int, x2: int, y2: int, duration: float = 0.15) -> dict[str, Any]:
    if not _OK:
        return {"success": False, "detail": f"pyautogui 不可用: {_ERR}"}
    try:
        pyautogui.moveTo(int(x1), int(y1), _pause=False)
        pyautogui.dragTo(int(x2), int(y2), duration=duration, button="left", _pause=False)
        return {"success": True}
    except Exception as e:
        return {"success": False, "detail": str(e)}


def mouse_down(button: str = "left", x: int | None = None, y: int | None = None) -> dict[str, Any]:
    if not _OK:
        return {"success": False, "detail": f"pyautogui 不可用: {_ERR}"}
    try:
        if x is not None and y is not None:
            pyautogui.moveTo(int(x), int(y), _pause=False)
        btn = button if button in ("left", "right", "middle") else "left"
        pyautogui.mouseDown(button=btn, _pause=False)
        return {"success": True}
    except Exception as e:
        return {"success": False, "detail": str(e)}


def mouse_up(button: str = "left") -> dict[str, Any]:
    if not _OK:
        return {"success": False, "detail": f"pyautogui 不可用: {_ERR}"}
    try:
        btn = button if button in ("left", "right", "middle") else "left"
        pyautogui.mouseUp(button=btn, _pause=False)
        return {"success": True}
    except Exception as e:
        return {"success": False, "detail": str(e)}

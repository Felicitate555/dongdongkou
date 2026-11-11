"""Short-lived, serialized local input sessions; independent of browser cleanup."""
from __future__ import annotations

import secrets
import threading
import time


class ControlStopped(Exception):
    pass


class ControlSafety:
    def __init__(self, mouse, clock=time.monotonic, timeout=0.75):
        self.mouse = mouse
        self.clock = clock
        self.timeout = timeout
        self.lock = threading.RLock()
        self.token = None
        self.deadline = 0.0
        self.sequence = 0
        self.expected = None
        self.reason = "未开启系统控制"

    def _stop(self, reason):
        active = self.token is not None
        self.token = None  # Revoke before attempting any physical release.
        self.expected = None
        self.reason = reason
        if active:
            self.mouse.release_all()

    def start(self):
        with self.lock:
            if self.token and self.clock() <= self.deadline:
                raise ControlStopped("已有控制会话，请先停止后重试")
            self._stop("重新开启")
            self.expected = self.mouse.position()
            self.token = secrets.token_urlsafe(32)
            self.sequence = 0
            self.deadline = self.clock() + self.timeout
            return self.token

    def stop(self, token):
        with self.lock:
            # A late stop from an old tab cannot revoke a newly opened session.
            if token and token == self.token:
                self._stop("系统控制已停止")

    def _check(self):
        if not self.token:
            return
        if self.clock() > self.deadline:
            self._stop("控制连接超时，请重新开启系统控制")
            return
        try:
            current = self.mouse.position()
            # Even a one-pixel external move wins over the next head request.
            # A tolerance here would erase slow physical movement on every move.
            if self.expected is not None and current != self.expected:
                self._stop("检测到实体鼠标接管，已停止头控")
        except Exception:
            self._stop("无法读取系统光标，已停止头控")

    def check(self):
        with self.lock:
            self._check()

    def execute(self, token, sequence, action):
        with self.lock:
            self._check()
            if not token or token != self.token:
                raise ControlStopped(self.reason)
            if sequence <= self.sequence:
                raise ControlStopped("过期或重复的系统输入请求")
            self.sequence = sequence
            try:
                result = action()
                if not result.get("success"):
                    self._stop("系统输入失败，已停止控制")
                else:
                    self.expected = self.mouse.position()
                    self.deadline = self.clock() + self.timeout
                return result
            except Exception:
                self._stop("系统输入异常，已停止控制")
                raise

    def shutdown(self):
        with self.lock:
            self._stop("服务正在关闭")

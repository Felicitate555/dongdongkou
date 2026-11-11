/**
 * 相对头姿控制自由光标；短张嘴点击，长张嘴拖动。
 */

export class OneEuroFilter {
  constructor(minCutoff = 1.0, beta = 0.007, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrev = null;
  }

  static alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(x, t) {
    t = t ?? performance.now() / 1000;
    if (this.xPrev === null) {
      this.xPrev = x;
      this.tPrev = t;
      return x;
    }
    const dt = Math.max(1e-4, t - this.tPrev);
    const dx = (x - this.xPrev) / dt;
    const aD = OneEuroFilter.alpha(this.dCutoff, dt);
    const dxHat = aD * dx + (1 - aD) * this.dxPrev;
    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
    const a = OneEuroFilter.alpha(cutoff, dt);
    const xHat = a * x + (1 - a) * this.xPrev;
    this.xPrev = xHat;
    this.dxPrev = dxHat;
    this.tPrev = t;
    return xHat;
  }

  reset() {
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrev = null;
  }
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

/**
 * 光标控制器：每次开启重新取中，静止死区；移动速度按帧时间缩放。
 * mode: virtual | system
 */
export class CursorController {
  constructor({ padEl, dotEl, onBlink, onLock, onMouth, onFallback } = {}) {
    this.pad = padEl;
    this.dot = dotEl;
    this.onBlink = onBlink;
    this.onLock = onLock;
    this.onMouth = onMouth;
    this.mode = "virtual";
    this.sensitivity = 1.2;
    this.smoothing = 0.5;
    this.x = 0.5;
    this.y = 0.5;
    this.fx = new OneEuroFilter(1.0, 0.01);
    this.fy = new OneEuroFilter(1.0, 0.01);
    this.center = { yaw: 0, pitch: 0 };
    this.blinkEnabled = false;
    this.clickMode = "mouth";
    this.jawThreshold = 0.5;
    this.blinkMs = 300;
    this.earThreshold = 0.2;
    this.blinkCount = 0;
    this.mouthCount = 0;
    this._closedSince = 0;
    this._wasClosed = false;
    this._lastClick = 0;
    this._jawLatched = false;
    this.systemOk = true;
    this._systemTimer = 0;
    this.targets = [];
    this.lockedTarget = null;
    this.systemControlAllowed = false;
    this.onFallback = onFallback;
    // 无有效校准时自动取中，避免 pitch 正偏置导致只往下
    this._needsAutoCenter = true;
    this.enableEdgeScroll = true;
    this._scrollAt = 0;
    this._lastAction = 0;
    this._jawOpenAt = 0;
    this._dragging = false;
    this._dragTarget = null;
    this._dragStart = null;
    this._controlEpoch = 0;
    this._controlSession = null;
    this._controlSequence = 0;
    this._inputQueue = Promise.resolve();
    this._movePending = false;
    this.deadZone = {yaw: 0.08, pitch: 0.08};
    this._centerSamples = [];
    this._lastPoseAt = null;
  }

  /** 长按：按住左键（虚拟 DOM 或系统鼠标） */
  _startDrag() {
    try {
      this.dot?.classList.add("is-dragging");
      const vp = this._viewportPoint();
      const el = document.elementFromPoint(vp.x, vp.y);
      this._dragTarget = el && el.closest ? el.closest("[data-drag], [data-click], button, input, select, [draggable]") : null;
      this._dragStart = { x: this.x, y: this.y, vp };
      if (this.mode === "system") {
        this._systemDown();
      } else if (this._dragTarget) {
        try {
          this._dragTarget.dispatchEvent(
            new MouseEvent("mousedown", { bubbles: true, clientX: vp.x, clientY: vp.y, button: 0 })
          );
        } catch {
          /* ignore */
        }
      }
    } catch (e) {
      console.warn("[动动口] startDrag", e);
    }
  }

  _moveDrag() {
    try {
      const vp = this._viewportPoint();
      if (this.mode === "system") {
        this._pushSystem();
        return;
      }
      // 可拖元素（data-drag）随光标平移；普通控件仅维持按住状态
      if (this._dragTarget && this._dragTarget.hasAttribute("data-drag") && this._dragStart) {
        const host = this._hostRect();
        const dx = (this.x - this._dragStart.x) * host.width;
        const dy = (this.y - this._dragStart.y) * host.height;
        this._dragTarget.style.transform = `translate(${dx}px, ${dy}px)`;
      }
      try {
        document.dispatchEvent(
          new MouseEvent("mousemove", { bubbles: true, clientX: vp.x, clientY: vp.y })
        );
      } catch {
        /* ignore */
      }
    } catch (e) {
      console.warn("[动动口] moveDrag", e);
    }
  }

  _endDrag() {
    try {
      this.dot?.classList.remove("is-dragging");
      const vp = this._viewportPoint();
      if (this.mode === "system") {
        this._systemUp();
      } else {
        try {
          (this._dragTarget || document).dispatchEvent(
            new MouseEvent("mouseup", { bubbles: true, clientX: vp.x, clientY: vp.y, button: 0 })
          );
        } catch {
          /* ignore */
        }
      }
      this._dragTarget = null;
      this._dragStart = null;
    } catch (e) {
      console.warn("[动动口] endDrag", e);
    }
  }

  async _systemDown() {
    const epoch = this._controlEpoch;
    const meta = await this._screen().catch(() => null);
    if (!meta?.system_control || epoch !== this._controlEpoch) return false;
    return this.systemRequest("/api/mouse/down", {button: "left", ...this._screenPoint(meta.screen)});
  }

  async _systemUp() {
    return this.systemRequest("/api/mouse/up", {button: "left"});
  }

  async startSystem() {
    if (this._needsAutoCenter) throw new Error("请先平视片刻，完成自动取中后再开启系统光标");
    const epoch = ++this._controlEpoch;
    const meta = await this._screen(true);
    if (epoch !== this._controlEpoch || !meta.system_control) return false;
    const response = await fetch("/api/control/start", {method: "POST", headers: {"Content-Type": "application/json"}, signal: AbortSignal.timeout(1500)});
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || "无法开启系统控制");
    if (epoch !== this._controlEpoch) {
      await this._revokeSession(result.session);
      return false;
    }
    this._controlSession = result.session;
    this._controlSequence = 0;
    this.systemControlAllowed = true;
    this.mode = "system";
    this._systemTimer = -1000;
    return true;
  }

  _revokeSession(session) {
    if (!session) return Promise.resolve();
    return fetch("/api/control/stop", {method: "POST", keepalive: true, headers: {"X-DDK-Control-Session": session}, signal: AbortSignal.timeout(1000)}).catch(() => null);
  }

  stopSystem() {
    const session = this._controlSession;
    ++this._controlEpoch;
    this.mode = "virtual";
    this.systemControlAllowed = false;
    this._controlSession = null;
    this._screenCache = null;
    this._jawLatched = false;
    if (this._dragging && this._dragTarget) this._endDrag();
    this._dragging = false;
    this._dragTarget = null;
    this._dragStart = null;
    this.dot?.classList.remove("is-dragging");
    return this._revokeSession(session);
  }

  systemRequest(url, body) {
    const epoch = this._controlEpoch;
    const session = this._controlSession;
    if (this.mode !== "system" || !this.systemControlAllowed || !session) return Promise.resolve(false);
    const pending = this._inputQueue.then(async () => {
      if (epoch !== this._controlEpoch || this.mode !== "system") return false;
      try {
        const response = await fetch(url, {method: "POST", headers: {
          "Content-Type": "application/json", "X-DDK-Control-Session": session,
          "X-DDK-Control-Sequence": String(++this._controlSequence),
        }, body: JSON.stringify(body), signal: AbortSignal.timeout(600)});
        if (epoch !== this._controlEpoch) return false;
        if (!response.ok) {
          const result = await response.json().catch(() => ({}));
          throw new Error(result.detail || "系统控制请求失败");
        }
        return true;
      } catch (error) {
        if (epoch === this._controlEpoch) {
          this.stopSystem();
          this.systemOk = false;
          this.onFallback?.(error.message || "系统控制已停止");
        }
        return false;
      }
    });
    this._inputQueue = pending.catch(() => false);
    return pending;
  }

  setCalibration(yaw, pitch) {
    this.center.yaw = Number(yaw) || 0;
    this.center.pitch = Number(pitch) || 0;
    this.fx.reset();
    this.fy.reset();
    this._needsAutoCenter = false;
    this._lastPoseAt = null;
    try {
      localStorage.setItem(
        "ddk_cal",
        JSON.stringify({
          v: "steady21",
          yaw: this.center.yaw,
          pitch: this.center.pitch,
          ts: Date.now(),
        })
      );
    } catch {
      /* ignore */
    }
  }

  loadCalibration() {
    try {
      const raw = localStorage.getItem("ddk_cal");
      if (!raw) return false;
      const j = JSON.parse(raw);
      // 仅接受 legacy10 启发式量级（|yaw|,|pitch| 通常 < 3）；矩阵时代脏数据必须丢弃
      const yaw = Number(j.yaw);
      const pitch = Number(j.pitch);
      const ok =
        j.v === "steady21" &&
        Number.isFinite(yaw) &&
        Number.isFinite(pitch) &&
        Math.abs(yaw) <= 3 &&
        Math.abs(pitch) <= 3;
      if (!ok) {
        localStorage.removeItem("ddk_cal");
        this.center.yaw = 0;
        this.center.pitch = 0;
        this._needsAutoCenter = true;
        console.warn("[动动口] 已清除无效校准，将自动居中", j);
        return false;
      }
      this.center.yaw = yaw;
      this.center.pitch = pitch;
      this._needsAutoCenter = false;
      return true;
    } catch {
      return false;
    }
  }

  resetCalibration() {
    this.center.yaw = 0;
    this.center.pitch = 0;
    this.beginCentering();
    try {
      localStorage.removeItem("ddk_cal");
    } catch {
      /* ignore */
    }
  }

  beginCentering() {
    this._calibrating = false;
    this._needsAutoCenter = true;
    this._centerSamples = [];
    this._lastPoseAt = null;
    this.fx.reset();
    this.fy.reset();
    this._jawLatched = false;
  }

  static median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  /** 用当前姿态当中心（用于自动/手动校准） */
  autoCenterFromPose(yaw, pitch) {
    if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) return false;
    this.setCalibration(yaw, pitch);
    this._needsAutoCenter = false;
    return true;
  }

  setTargets(list) {
    this.targets = list || [];
    this.lockedTarget = null;
  }

  refreshTargets(collectFn) {
    if (typeof collectFn === "function") this.targets = collectFn();
  }

  /** 头姿 → 光标：yaw→x、pitch→y；回到自然姿态时立即停止。 */
  applyPose(yaw, pitch, ear, jawOpen, nowMs) {
    try {
      if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) return;
      const time = Number.isFinite(nowMs) ? nowMs : performance.now();
      const frameScale = this._lastPoseAt === null ? 1 : clamp((time - this._lastPoseAt) / (1000 / 30), 0, 1.5);
      this._lastPoseAt = time;
      if (this._calibrating) return;
      const minCutoff = 0.3 + (1.1 - this.smoothing) * 2.2;
      this.fx.minCutoff = minCutoff;
      this.fy.minCutoff = minCutoff;

      // 等待约一秒的稳定平视，使用中位数，避免启动瞬间或旧坐姿造成偏置。
      if (this._needsAutoCenter) {
        this._centerSamples.push({yaw, pitch, time});
        while (this._centerSamples.length > 1 && time - this._centerSamples[0].time > 1000) this._centerSamples.shift();
        const samples = this._centerSamples;
        if (samples.length >= 20 && time - samples[0].time >= 750) {
          const y = CursorController.median(samples.map(p => p.yaw));
          const p = CursorController.median(samples.map(p => p.pitch));
          const yNoise = CursorController.median(samples.map(s => Math.abs(s.yaw - y)));
          const pNoise = CursorController.median(samples.map(s => Math.abs(s.pitch - p)));
          if (yNoise < 0.045 && pNoise < 0.045 && Math.abs(yaw - y) < 0.12 && Math.abs(pitch - p) < 0.12) {
            this.deadZone = {yaw: clamp(yNoise * 4 + 0.04, 0.08, 0.16), pitch: clamp(pNoise * 4 + 0.04, 0.08, 0.16)};
            this.autoCenterFromPose(y, p);
          }
        }
        this.render();
        return;
      }

      const dy = yaw - this.center.yaw;
      const dp = pitch - this.center.pitch;

      // 防跑飞：单帧偏差过大（丢跟踪/异常值）不积分
      if (Math.abs(dy) > 2.5 || Math.abs(dp) > 2.5) {
        this.render();
        return;
      }
      const outside = (value, dead) => Math.sign(value) * Math.max(0, Math.abs(value) - dead);
      const nx = outside(dy, this.deadZone.yaw);
      const np = outside(dp, this.deadZone.pitch);
      // 滤速度而非累计位置，防止死区内继续滑行；上下使用同一增益。
      if (!nx) this.fx.reset();
      if (!np) this.fy.reset();
      const vx = nx ? this.fx.filter(nx, time / 1000) : 0;
      const vy = np ? this.fy.filter(np, time / 1000) : 0;
      this.x = clamp(this.x + vx * 0.018 * this.sensitivity * frameScale, 0.02, 0.98);
      this.y = clamp(this.y + vy * 0.022 * this.sensitivity * frameScale, 0.02, 0.98);
      this.render();

      // 虚拟光标顶到底仍继续同方向 → 触发翻页（每 700ms 一次）
      try {
        const now = nowMs || performance.now();
        const edge = 0.03;
        if (this.mode !== "system" && this.enableEdgeScroll !== false && !this._dragging) {
          if (this.y <= edge && np < -0.08) {
            if (now - (this._scrollAt || 0) > 700) {
              this._scrollAt = now;
              window.scrollBy({ top: -280, behavior: "smooth" });
            }
          } else if (this.y >= 1 - edge && np > 0.08) {
            if (now - (this._scrollAt || 0) > 700) {
              this._scrollAt = now;
              window.scrollBy({ top: 280, behavior: "smooth" });
            }
          }
        }
      } catch {
        /* ignore scroll errors */
      }

      // 张嘴：短促=点击；按住≥450ms=长按拖动（移动中随头，闭嘴放下）
      const useMouth = this.clickMode === "mouth" || this.clickMode === "both";
      const mouthOpen = Number(jawOpen || 0) >= Number(this.jawThreshold);
      const now = nowMs || performance.now();
      const HOLD_MS = 450;

      if (useMouth && mouthOpen) {
        if (!this._jawLatched) {
          if (now - this._lastAction > 800) {
            this._jawLatched = true;
            this._jawOpenAt = now;
            this._dragging = false;
          }
        } else if (!this._dragging && now - this._jawOpenAt >= HOLD_MS) {
          // 进入长按拖动
          this._dragging = true;
          this._lastAction = now;
          this._startDrag();
        } else if (this._dragging) {
          this._moveDrag();
        }
      } else if (!mouthOpen) {
        if (this._dragging) {
          this._endDrag();
          this._dragging = false;
          this._jawLatched = false;
          this._lastAction = now;
        } else if (this._jawLatched && now - this._jawOpenAt < HOLD_MS) {
          // 短促张嘴 → 点击
          this._lastAction = now;
          this.mouthCount += 1;
          this.ripple();
          this._fireClick("left", 1);
          this.onMouth?.(this.mouthCount, jawOpen);
          this._jawLatched = false;
        } else {
          this._jawLatched = false;
        }
      }

      if (this.mode === "system") {
        this._pushSystem();
      }
    } catch (e) {
      console.warn("[动动口] applyPose", e);
    }
  }

  _hostRect() {
    if (this.pad) {
      const r = this.pad.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return r;
    }
    return { left: 0, top: 0, width: window.innerWidth || 1, height: window.innerHeight || 1 };
  }

  _viewportPoint() {
    const host = this._hostRect();
    return { x: host.left + this.x * host.width, y: host.top + this.y * host.height };
  }

  render() {
    if (!this.dot) return;
    const host = this._hostRect();
    this.dot.style.left = `${this.x * host.width}px`;
    this.dot.style.top = `${this.y * host.height}px`;
    this.dot.hidden = false;
    this.dot.classList.toggle("is-targeted", !!this.lockedTarget && !this._dragging);
    this.dot.classList.toggle("is-dragging", !!this._dragging);
  }

  ripple() {
    if (!this.dot) return;
    const r = document.createElement("span");
    r.className = "ripple";
    this.dot.appendChild(r);
    setTimeout(() => r.remove(), 600);
  }

  clickVirtual() {
    const vp = this._viewportPoint();
    const el = document.elementFromPoint(vp.x, vp.y);
    if (!el) return false;
    const target =
      el.closest("[data-click]") || el.closest("button, a, input, select, [role=button]");
    if (target) {
      target.click();
      return true;
    }
    return false;
  }

  cycleTarget(dir = 1) {
    if (!this.targets.length) return null;
    let idx = this.targets.findIndex((t) => t === this.lockedTarget);
    if (idx < 0) idx = dir > 0 ? -1 : 0;
    idx = (idx + dir + this.targets.length) % this.targets.length;
    const t = this.targets[idx];
    this.lockedTarget = t;
    const host = this._hostRect();
    this.x = clamp((t.x - host.left) / host.width, 0.02, 0.98);
    this.y = clamp((t.y - host.top) / host.height, 0.02, 0.98);
    this.render();
    this.onLock?.(t);
    return t;
  }

  pickByIndex(n) {
    const t = this.targets[n - 1];
    if (!t) return null;
    return this.cycleTarget(0) || t;
  }

  _fireClick(button = "left", clicks = 1) {
    if (this.mode === "system") {
      this.clickSystem(button, clicks);
      return;
    }
    this.clickVirtual();
  }

  async _pushSystem() {
    if (this._movePending || !this.systemControlAllowed || this.mode !== "system" || !this._controlSession) return;
    const now = performance.now();
    if (now - this._systemTimer < 30) return;
    this._systemTimer = now;
    this._movePending = true;
    const epoch = this._controlEpoch;
    try {
      const { screen } = await this._screen();
      if (epoch !== this._controlEpoch || this.mode !== "system") return;
      const { x, y } = this._screenPoint(screen);
      await this.systemRequest("/api/mouse/move", {x, y});
    } catch {
      if (epoch === this._controlEpoch) {
        this.stopSystem();
        this.onFallback?.("系统光标不可用，已停止控制");
      }
    } finally {
      this._movePending = false;
    }
  }

  _screenCache = null;

  _screenPoint(screen) {
    return {
      // 系统模式应覆盖整块桌面；映射到页面区域会让人无法移出浏览器。
      x: clamp(Math.round(this.x * Math.max(0, screen[0] - 1)), 0, Math.max(0, screen[0] - 1)),
      y: clamp(Math.round(this.y * Math.max(0, screen[1] - 1)), 0, Math.max(0, screen[1] - 1)),
    };
  }

  async _screen(force = false) {
    if (this._screenCache && !force) return this._screenCache;
    const epoch = this._controlEpoch;
    const r = await fetch("/api/health", {signal: AbortSignal.timeout(1500)});
    const j = await r.json();
    const meta = {
      screen: j.screen || [1920, 1080],
      system_control: !!j.system_control,
      ts: Date.now(),
    };
    if (epoch === this._controlEpoch) this._screenCache = meta;
    return meta;
  }

  invalidateScreenCache() {
    this._screenCache = null;
  }

  async clickSystem(button = "left", clicks = 1) {
    const epoch = this._controlEpoch;
    try {
      const meta = await this._screen(true);
      if (!meta.system_control || epoch !== this._controlEpoch || this.mode !== "system") return false;
      const { screen } = meta;
      const { x, y } = this._screenPoint(screen);
      return this.systemRequest("/api/mouse/click", {button, clicks, x, y});
    } catch {
      if (epoch === this._controlEpoch) {
        this.stopSystem();
        this.onFallback?.("控制连接异常，已停止头控，请手动重新开启");
      }
      return false;
    }
  }
}

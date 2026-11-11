/* 导航 / 工具 / toast / TTS / 音效 */

export const VIEWS = ["home", "console", "demo", "architecture"];
const FILE = {
  home: "index.html?v=20261021h",
  console: "console.html?v=20261021h",
  demo: "demo.html?v=20261021h",
  architecture: "architecture.html?v=20261021h",
};

let floatingDocument = null;
export function setFloatingDocument(doc) { floatingDocument = doc; }
export function $(sel, el = document) {
  return el.querySelector(sel) || (el === document ? floatingDocument?.querySelector(sel) : null);
}
export function $$(sel, el = document) {
  return [...el.querySelectorAll(sel)];
}

export function toast(msg, ms = 2600) {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.className = "toast";
    el.hidden = true;
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.hidden = false;
  // 双 rAF：确保从 hidden 切换后 transition 能播
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      el.classList.add("is-on");
    });
  });
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    el.classList.remove("is-on");
    setTimeout(() => {
      if (!el.classList.contains("is-on")) el.hidden = true;
    }, 220);
  }, ms);
}

export function speak(text, enabled = true) {
  if (!enabled || !text) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "zh-CN";
    u.rate = 1.0;
    u.pitch = 1.05;
    // 优先选更自然的中文女声/系统神经语音，避免生硬默认音
    const pickVoice = () => {
      const list = speechSynthesis.getVoices() || [];
      if (!list.length) return null;
      const prefer = [
        /xiaoxiao/i,
        /huihui/i,
        /yaoyao/i,
        /tingting/i,
        /google.*chinese|中文.*google|google.*mandarin/i,
        /microsoft.*zh|zh-cn/i,
        /natural/i,
        /neural/i,
      ];
      for (const re of prefer) {
        const hit = list.find((v) => re.test(v.name || "") && /zh|cmn|Chinese/i.test(v.lang || v.name));
        if (hit) return hit;
      }
      return (
        list.find((v) => /zh|cmn/i.test(v.lang || "")) ||
        list.find((v) => /chinese|中文/i.test(v.name || "")) ||
        null
      );
    };
    const v = pickVoice();
    if (v) u.voice = v;
    speechSynthesis.cancel();
    const speechId = (speak._id || 0) + 1;
    speak._id = speechId;
    window.dispatchEvent(new CustomEvent("ddk-speech-start", {detail: speechId}));
    const finish = () => window.dispatchEvent(new CustomEvent("ddk-speech-end", {detail: speechId}));
    u.onend = finish;
    u.onerror = finish;
    speechSynthesis.speak(u);
  } catch {
    /* ignore */
  }
}

// 预加载可用音色列表（部分浏览器需先触发一次 getVoices）
if (typeof speechSynthesis !== "undefined") {
  try {
    speechSynthesis.getVoices();
    speechSynthesis.onvoiceschanged = () => {
      speechSynthesis.getVoices();
    };
  } catch {
    /* ignore */
  }
}

export function ding() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    o.frequency.value = 880;
    g.gain.value = 0.04;
    o.start();
    setTimeout(() => {
      o.frequency.value = 1175;
    }, 80);
    setTimeout(() => {
      o.stop();
      ctx.close();
    }, 160);
  } catch {
    /* ignore */
  }
}

export function setActiveNav(current) {
  document.querySelectorAll(".nav-link, .tabbar button").forEach((b) => {
    b.classList.toggle("is-active", b.dataset.nav === current);
  });
}

export function bindNav() {
  // Version HTML links too: older HTML may still be in the browser cache.
  document.querySelectorAll('a[href]').forEach(link => {
    const url = new URL(link.href, location.href);
    if (url.origin === location.origin && url.pathname.endsWith('.html')) {
      url.searchParams.set('v', '20261021h');
      link.href = url.href;
    }
  });
  document.querySelectorAll("[data-nav]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const v = btn.dataset.nav;
      if (FILE[v]) location.href = FILE[v];
    });
  });
}

export async function api(path, body, method = "POST") {
  const opt =
    method === "GET"
      ? { method }
      : {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body || {}),
        };
  const controller = new AbortController();
  opt.signal = controller.signal;
  const timer = setTimeout(() => controller.abort(), path.startsWith('/api/chat') && method === 'POST' ? 60000 : 12000);
  try {
  const r = await fetch(path, opt);
  if (!r.ok) {
    let detail = r.statusText;
    try {
      const j = await r.json();
      detail = Array.isArray(j.detail) ? "请检查填写内容：用户名 2–24 位，密码至少 8 位。" : j.detail || detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return await r.json();
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('连接超时，请重试');
    throw error;
  } finally { clearTimeout(timer); }
}

// Finite frame requests never hold page loading open, and never overlap.
export function createCameraPreview(image, view = window) {
  let active = false, timer, controller, url, generation = 0;
  const clear = () => { if (url) URL.revokeObjectURL(url); url = null; image.removeAttribute('src'); };
  async function frame(epoch) {
    if (!active || epoch !== generation) return;
    if (!view.document.hidden && image.style.visibility !== 'hidden') {
      const request = new AbortController();
      controller = request;
      const timeout = view.setTimeout(() => request.abort(), 4000);
      try {
        const response = await fetch('/api/desktop/preview', {cache:'no-store', signal:request.signal});
        if (response.status === 200) {
          const blob = await response.blob();
          if (active && epoch === generation) { const old = url; url = URL.createObjectURL(blob); image.src = url; if (old) URL.revokeObjectURL(old); }
        } else if (response.status === 204 && epoch === generation) clear();
      } catch { /* Next frame retries without queueing requests. */ }
      finally { view.clearTimeout(timeout); if (controller === request) controller = null; }
    }
    if (active && epoch === generation) timer = view.setTimeout(() => frame(epoch), 33);
  }
  function stop() { active = false; generation++; view.clearTimeout(timer); controller?.abort(); clear(); }
  view.addEventListener('pagehide', stop, {once:true});
  return {setActive(value) {
    if (!value) { stop(); return; }
    if (active) return;
    active = true;
    const epoch = ++generation;
    if (view.document.readyState === 'complete') frame(epoch);
    else view.addEventListener('load', () => frame(epoch), {once:true});
  }, stop};
}

export function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

export async function health() {
  try {
    return await api("/api/health", null, "GET");
  } catch {
    return { status: "down" };
  }
}

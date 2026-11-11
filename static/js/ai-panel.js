/**
 * AI 辅助面板：截屏 → /api/ai_assist → 标注
 */
import { api, toast, ding, speak } from "./common.js";

export class AIPanel {
  constructor({ root, onSelect, ttsOn }) {
    this.root = root;
    this.onSelect = onSelect;
    this.ttsOn = ttsOn || (() => true);
    this.elements = [];
    this.selected = null;
    this.open = false;
    this.remoteConsent = false;
    this._bind();
  }

  _bind() {
    const btnClose = this.root.querySelector("[data-ai-close]");
    btnClose?.addEventListener("click", () => this.close());
    this.root.querySelectorAll("[data-ai-pick]").forEach((b) => {
      b.addEventListener("click", () => {
        const id = Number(b.dataset.aiPick);
        this.pick(id);
      });
    });
  }

  async capture() {
    // Render an honest control map. Browsers do not expose a silent full-page
    // screenshot API; never label this layout map as a real screenshot.
    const w = Math.min(960, window.innerWidth);
    const h = Math.min(640, window.innerHeight);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#0B0F19";
    ctx.fillRect(0, 0, w, h);
    const sx = w / window.innerWidth;
    const sy = h / window.innerHeight;
    ctx.fillStyle = "#9AA9BC";
    ctx.font = "14px sans-serif";
    ctx.fillText("动动口 · 当前页面可交互控件图（不是屏幕截图）", 14, 22);

    const controls = [...document.querySelectorAll(
      "button, a[href], input:not([type=hidden]):not([type=password]), select, textarea, [role=button], [data-click]"
    )];
    controls.slice(0, 24).forEach((el, index) => {
        if (el.hidden || el.disabled || el.getAttribute("aria-hidden") === "true") return;
        const r = el.getBoundingClientRect();
        if (r.width < 8 || r.height < 8) return;
        if (r.bottom < 0 || r.top > window.innerHeight) return;
        const fieldLabel = el.labels?.[0]?.innerText || el.labels?.[0]?.textContent || "";
        const text = el.getAttribute("aria-label") || fieldLabel || el.innerText || el.textContent || el.placeholder || el.title || "";
        const label = String(text).replace(/\s+/g, " ").trim().slice(0, 64) || "未命名控件";
        const x = r.left * sx;
        const y = r.top * sy;
        const width = r.width * sx;
        const height = r.height * sy;
        ctx.fillStyle = "#101A29";
        ctx.fillRect(x, y, width, height);
        ctx.strokeStyle = "#31C8D7";
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, width, height);
        ctx.fillStyle = "#E6F4F5";
        ctx.font = "13px sans-serif";
        ctx.fillText(`${index + 1}. ${el.tagName.toLowerCase()} · ${label}`, x + 6, y + Math.min(height - 4, 19));
      });
    return c.toDataURL("image/jpeg", 0.7);
  }

  async look(page = "") {
    const overlay = document.getElementById("ai-loading");
    if (overlay) overlay.hidden = false;
    try {
      if (!this.remoteConsent) {
        const allowed = window.confirm(
          "继续后会把当前页面的控件名称和位置发送到动动口服务，辅助你选择页面目标。不会包含摄像头画面或输入框中填写的内容；若服务启用了 MiMo，会把控件图继续发送给 MiMo。是否继续？"
        );
        if (!allowed) {
          toast("已取消分析，页面内容没有发送");
          return { success: false, detail: "用户取消", elements: [], fallback: true };
        }
        this.remoteConsent = true;
      }
      const image = await this.capture();
      const res = await api("/api/ai_assist", { image, page });
      this.elements = res.elements || [];
      this.render(image, res);
      this.open = true;
      ding();
      speak(res.source === "mimo"
        ? `MiMo 识别到 ${this.elements.length} 个可点目标，可以按序选择。`
        : `本地形状检测得到 ${this.elements.length} 个实验性区域，识别名称能力有限。`, this.ttsOn());
      return res;
    } catch (e) {
      toast(e.message || "分析暂时不可用，请稍后重试或手动操作");
      return { success: false, detail: String(e.message || e), elements: [], fallback: true };
    } finally {
      if (overlay) overlay.hidden = true;
    }
  }

  render(image, res) {
    const img = this.root.querySelector("[data-ai-shot]");
    const placeholder = this.root.querySelector("[data-ai-shot-placeholder]");
    const list = this.root.querySelector("[data-ai-list]");
    const meta = this.root.querySelector("[data-ai-meta]");
    if (img) {
      img.src = image;
      img.hidden = false;
    }
    if (placeholder) placeholder.hidden = true;
    if (meta) {
      const count = res.elements?.length || 0;
      const method = res.source === "mimo" ? "MiMo 视觉模型" : "本地形状检测（实验）";
      meta.textContent = `${method}${res.cached ? " · 缓存结果" : ""} · ${count} 个候选区域`;
    }
    if (list) {
      list.innerHTML = "";
      if (!this.elements.length) {
        const empty = document.createElement("p");
        empty.className = "ai-empty";
        empty.textContent = "没有找到可选区域。你可以直接转头移动光标并张嘴点击。";
        list.appendChild(empty);
      }
      this.elements.forEach((el) => {
        const li = document.createElement("button");
        li.type = "button";
        li.className = "ai-item";
        li.dataset.aiPick = String(el.id);
        const number = document.createElement("span");
        number.className = "ai-num";
        number.textContent = String(el.id + 1);
        const text = document.createElement("span");
        text.textContent = el.text || `区域${el.id + 1}`;
        li.append(number, text);
        li.addEventListener("click", () => this.pick(el.id));
        list.appendChild(li);
      });
    }
    const box = this.root.querySelector("[data-ai-overlay]");
    if (box && img) {
      const draw = () => {
        box.innerHTML = "";
        const iw = img.clientWidth;
        const ih = img.clientHeight;
        const capW = Math.min(960, window.innerWidth);
        const capH = Math.min(640, window.innerHeight);
        this.elements.forEach((el) => {
          const [x1, y1, x2, y2] = el.bbox;
          const d = document.createElement("div");
          d.className = "ai-box";
          d.style.left = `${(x1 / capW) * iw}px`;
          d.style.top = `${(y1 / capH) * ih}px`;
          d.style.width = `${((x2 - x1) / capW) * iw}px`;
          d.style.height = `${((y2 - y1) / capH) * ih}px`;
          const number = document.createElement("i");
          number.textContent = String(el.id + 1);
          d.append(number);
          d.addEventListener("click", () => this.pick(el.id));
          box.appendChild(d);
        });
      };
      if (img.complete) draw();
      else img.onload = draw;
    }
    this.root.hidden = false;
    this.root.classList.add("is-open");
  }

  pick(id) {
    const el = this.elements.find((e) => e.id === id);
    if (!el) return;
    this.selected = el;
    this.root.querySelectorAll(".ai-item").forEach((n) => {
      n.classList.toggle("is-active", Number(n.dataset.aiPick) === id);
    });
    this.onSelect?.(el);
    speak(`已选择${el.text || `区域${id + 1}`}`, this.ttsOn());
    setTimeout(() => this.close(), 600);
  }

  confirmFirst() {
    if (this.elements.length) this.pick(this.elements[0].id);
  }

  close() {
    this.open = false;
    this.root.hidden = true;
    this.root.classList.remove("is-open");
  }
}

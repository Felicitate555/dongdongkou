/** collectTargets — 供可选语音目标辅助与运行时共用；单节点异常不得拖垮主循环 */
export function collectTargets(root = document) {
  try {
    if (!root || !root.querySelectorAll) return [];
    const view = root.defaultView || (typeof window !== "undefined" ? window : null);
    const nodes = root.querySelectorAll(
      "button, a[href], input, select, textarea, [data-click], [data-target], [role=button]"
    );
    const out = [];
    const seen = new Set();
    nodes.forEach((el, idx) => {
      try {
        if (!el || !el.getBoundingClientRect) return;
        if (el.disabled || el.getAttribute("aria-disabled") === "true") return;
        const r = el.getBoundingClientRect();
        if (r.width < 8 || r.height < 8) return;
        const vh = (view && view.innerHeight) || 1080;
        const vw = (view && view.innerWidth) || 1920;
        if (r.bottom < 0 || r.top > vh) return;
        if (r.right < 0 || r.left > vw) return;
        if (seen.has(el)) return;
        seen.add(el);
        const text = (
          el.getAttribute("aria-label") ||
          el.getAttribute("data-label") ||
          el.textContent ||
          el.value ||
          ""
        )
          .trim()
          .slice(0, 24);
        out.push({
          id: idx,
          text: text || `区域${out.length + 1}`,
          x: r.left + r.width / 2,
          y: r.top + r.height / 2,
          w: r.width,
          h: r.height,
          el,
        });
      } catch {
        /* skip */
      }
    });
    return out.map((t, i) => ({ ...t, id: i }));
  } catch {
    return [];
  }
}

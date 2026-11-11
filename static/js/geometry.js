/** 目标辅助 / 张嘴状态 / 坐标映射纯函数（可被 Node 检查） */

export function nearestTarget(x, y, targets, radius) {
  if (!targets || !targets.length) return null;
  let best = null;
  let bestD = Infinity;
  for (const t of targets) {
    const dx = (t.x ?? 0) - x;
    const dy = (t.y ?? 0) - y;
    const d = Math.hypot(dx, dy);
    if (d < bestD && d <= radius) {
      best = t;
      bestD = d;
    }
  }
  return best;
}

export function isMouthOpen(jawOpen, threshold) {
  return Number(jawOpen) >= Number(threshold);
}

export function clamp01(v) {
  return Math.max(0.01, Math.min(0.99, v));
}

export function mapNormalizedToScreen(nx, ny, screenW, screenH) {
  return [
    Math.round(clamp01(nx) * screenW),
    Math.round(clamp01(ny) * screenH),
  ];
}

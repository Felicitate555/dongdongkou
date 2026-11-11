import { bindNav, setActiveNav, $, $$ } from "./common.js";

bindNav();
setActiveNav("home");

// 鼠标模拟器
const pad = $("#sim-pad");
const ball = $("#sim-ball");
if (pad && ball) {
  const move = (e) => {
    const r = pad.getBoundingClientRect();
    const p = e.touches ? e.touches[0] : e;
    const x = Math.max(0, Math.min(1, (p.clientX - r.left) / r.width));
    const y = Math.max(0, Math.min(1, (p.clientY - r.top) / r.height));
    ball.style.left = `${x * 100}%`;
    ball.style.top = `${y * 100}%`;
  };
  pad.addEventListener("pointermove", move);
  pad.addEventListener("pointerdown", (e) => {
    pad.setPointerCapture(e.pointerId);
    move(e);
  });
}

// 视频模态
const modal = $("#video-modal");
$("#video-ph")?.addEventListener("click", () => {
  if (modal) modal.hidden = false;
});
$("#video-close")?.addEventListener("click", () => {
  if (modal) modal.hidden = true;
});
modal?.addEventListener("click", (e) => {
  if (e.target === modal) modal.hidden = true;
});

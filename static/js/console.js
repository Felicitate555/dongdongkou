/** 控制台主逻辑：本机系统控制与网页内操作。 */
import { $, $$, toast, speak, ding, bindNav, setActiveNav, api, createCameraPreview } from "./common.js";
import { createControlRuntime } from "./control-runtime.js";
import { AIPanel } from "./ai-panel.js";
import { collectTargets } from "./target-collector.js";
import { Assistant } from "./assistant.js";
import { showDesktopGuide } from "./desktop-guide.js";

let assistant = null;
let desktopRunning = false;
let desktopAvailable = false;

bindNav();
setActiveNav("console");

const video = $("#video");
const overlay = $("#overlay");
const camEmpty = $("#cam-empty");
const modelPill = $("#model-pill");
const stage = $(".stage") || $("#cam-wrap");
const vcursor = $("#vcursor");
const camWrap = $("#cam-wrap");

// 光标宿主：覆盖 stage（整页操作区），而不仅是摄像头画面
if (stage && vcursor && vcursor.parentElement !== stage) {
  stage.style.position = "relative";
  stage.appendChild(vcursor);
}

const runtime = createControlRuntime({
  videoEl: video,
  overlayEl: overlay,
  padEl: null,
  dotEl: vcursor,
  targetsRoot: document,
  pageLabel: "console",
  onStatus: handleStatus,
  onUtterance: (text, cmd) => assistant?.utterance(text, cmd),
});

assistant = new Assistant(runtime, () => aiPanel.look("console"));

const aiPanel = new AIPanel({
  root: $("#ai-panel"),
  ttsOn: () => runtime.ttsOn(),
  onSelect: async (el) => {
    // AI bbox 基于合成截图坐标 → 映射到视口像素，再映射到 host 归一化
    const capW = Math.min(960, window.innerWidth);
    const capH = Math.min(640, window.innerHeight);
    const vx = ((el.center?.[0] || 0) / capW) * window.innerWidth;
    const vy = ((el.center?.[1] || 0) / capH) * window.innerHeight;
    const host = runtime.cursor._hostRect();
    runtime.cursor.x = Math.max(0.01, Math.min(0.99, (vx - host.left) / (host.width || 1)));
    runtime.cursor.y = Math.max(0.01, Math.min(0.99, (vy - host.top) / (host.height || 1)));
    runtime.cursor.lockedTarget = {
      id: el.id,
      text: el.text || `区域${el.id + 1}`,
      x: vx,
      y: vy,
      el: null,
    };
    runtime.cursor.render();
    if (runtime.cursor.mode === "system") {
      await runtime.cursor.clickSystem("left", 1);
    } else {
      runtime.cursor.ripple();
      runtime.cursor.clickVirtual();
    }
  },
});

function handleStatus(s) {
  try {
    switch (s.type) {
    case "cam_error":
      $("#cam-fallback").hidden = false;
      $("#cam-hint").textContent = s.message || "摄像头无法启动。请检查浏览器权限后重试，或打开网页演示。";
      if (modelPill) {
        modelPill.textContent = "摄像头不可用";
        modelPill.classList.remove("ok");
        modelPill.classList.add("err");
      }
      finishLoad(false, s.message || "摄像头没有成功开启。请检查浏览器权限后重试。");
      break;
    case "cam_resume":
      $("#cam-hint").textContent = "正在恢复摄像头…";
      startLoadAnim();
      break;
    case "cam_ok":
      if (camEmpty) {
        camEmpty.hidden = true;
        camEmpty.style.display = "none";
      }
      $("#cam-hint").textContent = "画面留在本机。去其他软件请使用“后台控制电脑”。";
      setOnboard(2);
      if (modelPill && !modelPill.classList.contains("ok")) {
        modelPill.textContent = "正在加载…";
        modelPill.classList.remove("err");
      }
      break;
    case "cam_off":
      clearInterval(loadTimer);
      if ($("#cam-load")) $("#cam-load").hidden = true;
      if (modelPill) {
        modelPill.textContent = "摄像头未开启";
        modelPill.classList.remove("ok", "err");
      }
      if (camEmpty) {
        camEmpty.hidden = false;
        camEmpty.style.display = "";
      }
      setOnboard(1);
      break;
    case "model_ok":
      if (camEmpty) {
        camEmpty.hidden = true;
        camEmpty.style.display = "none";
      }
      finishLoad(true);
      {
        const d = s.delegate === "GPU" ? "流畅" : s.delegate === "CPU" ? "较慢" : "…";
        modelPill.textContent = `已就绪 ${d}`;
        modelPill.classList.remove("err");
        modelPill.classList.add("ok");
        if (s.delegate === "CPU") {
          modelPill.classList.remove("ok");
          modelPill.classList.add("err");
          toast("当前识别较慢，建议使用 Chrome/Edge 并打开硬件加速");
        }
        $("#sb-model").textContent = `识别：已就绪 ${d}`;
        setOnboard(3);
        $("#cal-hint").textContent = "请面对屏幕保持平视一秒，然后转头移动光标。";
      }
      break;
    case "model_error":
      modelPill.textContent = "未就绪";
      modelPill.classList.remove("ok");
      modelPill.classList.add("err");
      finishLoad(false, "识别组件没有加载成功。点「重新开始」再试。");
      break;
    case "fps":
      $("#st-fps").textContent = (s.fps || 0).toFixed(0);
      $("#sb-fps").textContent = `FPS：${(s.fps || 0).toFixed(0)}`;
      $("#st-ms").textContent = `${(s.inferMs || 0).toFixed(1)}ms`;
      $("#sb-lat").textContent = `延迟：${(s.inferMs || 0).toFixed(0)}ms`;
      break;
    case "pose":
      $("#st-pose").textContent = `${s.yaw.toFixed(2)} / ${s.pitch.toFixed(2)}`;
      $("#st-xy").textContent = `${s.x.toFixed(2)}, ${s.y.toFixed(2)}`;
      $("#st-ear").textContent = (s.ear || 0).toFixed(2);
      if ($("#st-jaw")) $("#st-jaw").textContent = (s.jawOpen || 0).toFixed(2);
      $("#sb-cur").textContent = `光标：${Math.round(s.x * 100)}%, ${Math.round(s.y * 100)}%`;
      if ($("#sb-jaw")) $("#sb-jaw").textContent = `张嘴：${(s.jawOpen || 0).toFixed(2)}`;
      if (s.locked) {
        if ($("#sb-lock")) $("#sb-lock").textContent = `语音选中：${s.locked.text || "目标"}`;
        if ($("#st-lock")) $("#st-lock").textContent = s.locked.text || "—";
      } else {
        if ($("#sb-lock")) $("#sb-lock").textContent = "语音选中：—";
        if ($("#st-lock")) $("#st-lock").textContent = "—";
      }
      break;
    case "mouth":
      if ($("#st-mouth")) $("#st-mouth").textContent = String(s.n);
      if ($("#sb-mouth")) $("#sb-mouth").textContent = `张嘴点击：${s.n}`;
      ding();
      break;
    case "blink":
      $("#st-blink").textContent = String(s.n);
      $("#sb-blink").textContent = `眨眼：${s.n}`;
      break;
    case "lock":
      if (s.target && s.target.text !== handleStatus._lastLock) {
        handleStatus._lastLock = s.target.text;
        if ($("#sb-lock")) $("#sb-lock").textContent = `语音选中：${s.target.text || "目标"}`;
        speak(`已选中${s.target.text || "目标"}，可说点击或继续移动光标`, runtime.ttsOn());
      } else if (!s.target) {
        handleStatus._lastLock = null;
      }
      break;
    case "voice_interim":
      $("#voice-bubble").textContent = `识别中：${s.text}…`;
      $("#voice-bubble").classList.add("is-interim");
      break;
    case "voice_final":
      $("#voice-bubble").textContent = `识别：${s.text}`;
      $("#voice-bubble").classList.remove("is-interim");
      break;
    case "voice_cmd":
      $("#voice-bubble").textContent = `识别：${s.raw} · 命令：${s.cmd.label}`;
      $("#voice-bubble").classList.remove("is-interim");
      if (s.cmd.action === "ai_look") assistant.captureScreen(true);
      if (s.cmd.action === "confirm" && assistant.pendingImage) assistant.confirmScreen(true);
      if (s.cmd.action === "cancel" && assistant.pendingImage) {assistant.pendingImage=null;$("#screen-review").hidden=true;}
      if (s.cmd.action === "confirm" && aiPanel.open) aiPanel.confirmFirst();
      if (s.cmd.action === "cancel" && aiPanel.open) aiPanel.close();
      if (s.cmd.action === "pause_control") stopDesktop();
      break;
    case "voice_error":
      $("#voice-bubble").textContent = s.message;
      $("#voice-bubble").classList.remove("is-interim");
      if (s.fatal) $("#btn-mic").textContent = "重新开始聆听";
      break;
    case "voice_state":
      $("#btn-mic").textContent = s.listening ? "停止聆听" : s.reason === "error" || s.reason === "start-error" || s.reason === "restart-error" ? "重新开始聆听" : "开始聆听";
      if (!s.listening && s.reason === "error") {
        $("#voice-bubble").classList.remove("is-interim");
      }
      assistant?.syncMouth();
      break;
    case "cal_tick":
      $("#cal-num").textContent = String(s.n);
      $("#cal-count").textContent = String(s.n);
      break;
    case "cal_start":
      $("#cal-overlay").hidden = false;
      $("#cal-count").hidden = false;
      break;
    case "cal_cancel":
      $("#cal-overlay").hidden = true;
      $("#cal-count").hidden = true;
      $("#cal-hint").textContent = "请面对摄像头，平视片刻后重试";
      break;
    case "cal_done":
      $("#cal-overlay").hidden = true;
      $("#cal-count").hidden = true;
      $("#cal-hint").textContent = "校准完成，可以开始转头移动光标了";
      $("#cal-hint").style.color = "#10B981";
      setOnboard(3);
      break;
    case "mode":
      $("#cursor-mode").value = s.mode;
      $("#mode-pill").textContent = s.mode === "system" ? "系统光标" : "虚拟光标";
      $("#btn-emergency-stop").hidden = s.mode !== "system";
      break;
    case "emergency_stop":
      toast("已停止光标控制，摄像头和语音监听已关闭");
      break;
    default:
      break;
    }
  } catch (e) {
    console.warn("[动动口] handleStatus", e);
  }
}

// ---- UI ----
// 三步上手
const onboard = $("#onboard");
function setOnboard(step) {
  [1, 2, 3].forEach((n) => {
    const li = $(`#ob-${n}`);
    if (!li) return;
    li.classList.toggle("is-done", n < step);
    li.classList.toggle("is-now", n === step);
  });
}
if (localStorage.getItem("ddk_onboard_hide") === "1" && onboard) {
  onboard.hidden = true;
}
$("#onboard-hide")?.addEventListener("click", () => {
  if (onboard) onboard.hidden = true;
  try {
    localStorage.setItem("ddk_onboard_hide", "1");
  } catch {
    /* ignore */
  }
});
setOnboard(1);

// 高级设置默认折叠
$("#btn-adv")?.addEventListener("click", () => {
  const body = $("#adv-body");
  const btn = $("#btn-adv");
  if (!body || !btn) return;
  const open = body.hidden;
  body.hidden = !open;
  btn.setAttribute("aria-expanded", open ? "true" : "false");
});

// 桌面端展开更多控制；窄屏默认收起，优先展示摄像头与操作舞台。
const mobileTools = $(".mobile-tools");
const toolsBreakpoint = window.matchMedia("(max-width: 960px)");
function syncMobileToolsDisclosure() {
  if (mobileTools) mobileTools.open = !toolsBreakpoint.matches;
}
syncMobileToolsDisclosure();
toolsBreakpoint.addEventListener?.("change", syncMobileToolsDisclosure);

// 翻页按钮
function wireScroll(id, dx, dy) {
  $(id)?.addEventListener("click", () => {
    window.scrollBy({ top: dy, left: dx, behavior: "smooth" });
  });
}
wireScroll("#btn-scroll-up", 0, -320);
wireScroll("#btn-scroll-down", 0, 320);
wireScroll("#btn-scroll-left", -320, 0);
wireScroll("#btn-scroll-right", 320, 0);

// 初始化没有真实百分比；用不确定进度状态，避免制造假进度。
let loadTimer = 0;
function showLoad(text) {
  const box = $("#cam-load");
  const ink = $("#cam-load-ink");
  const t = $("#cam-load-text");
  const retry = $("#btn-cam-retry");
  if (!box) return;
  box.hidden = false;
  if (ink) {
    ink.style.background = "";
    ink.style.width = "34%";
    ink.classList.add("is-loading");
  }
  if (retry) retry.hidden = true;
  if (t) t.textContent = text;
}
function finishLoad(ok, errMsg) {
  const box = $("#cam-load");
  const ink = $("#cam-load-ink");
  const t = $("#cam-load-text");
  const retry = $("#btn-cam-retry");
  if (!box) return;
  clearInterval(loadTimer);
  ink?.classList.remove("is-loading");
  if (ok) {
    if (ink) ink.style.width = "100%";
    setTimeout(() => {
      box.hidden = true;
    }, 600);
  } else {
    if (ink) ink.style.width = "100%";
    if (ink) ink.style.background = "#EF4444";
    if (t) t.textContent = errMsg || "没有成功，点下面按钮再试一次";
    if (retry) retry.hidden = false;
  }
}
function startLoadAnim() {
  clearInterval(loadTimer);
  showLoad("正在打开摄像头并初始化本地识别模型…");
}
$("#btn-cam-retry")?.addEventListener("click", async () => {
  if(desktopRunning&&!(await stopDesktop()))return;
  startLoadAnim();
  runtime.startCam();
});

$("#btn-cam-on")?.addEventListener("click", async () => {
  if (desktopRunning && !(await stopDesktop())) return;
  startLoadAnim();
  setOnboard(2);
  runtime.startCam();
});
$("#btn-cam-off")?.addEventListener("click", () => {runtime.stopCam(true);stopDesktop();});
$("#btn-cal")?.addEventListener("click", () => {
  if(desktopRunning){api("/api/desktop/recenter",{}).then(()=>toast("请保持自然平视，正在重新取中")).catch(e=>toast(e.message));return;}
  setOnboard(2);
  runtime.startCalibrate(3);
});
$("#btn-cal-reset")?.addEventListener("click", (e) => {
  e.preventDefault();
  runtime.cursor.resetCalibration();
  $("#cal-hint").textContent = "已恢复默认，请面对屏幕校准";
  toast("已恢复默认，请面对屏幕校准");
});

$("#cursor-mode")?.addEventListener("change", async (e) => {
  const mode = e.target.value;
  runtime.cursor.invalidateScreenCache?.();
  if (mode === "system") {
    try {
      if (!runtime.streaming) {
        e.target.value = "virtual";
        toast("请先开启摄像头，待头控就绪后选择系统光标");
        return;
      }
      const started = await runtime.cursor.startSystem();
      if (!started) {
        e.target.value = "virtual";
        toast("系统控制未开启或已取消。公网只提供页面内光标。");
        return;
      }
      $("#mode-pill").textContent = "系统光标";
      $("#btn-emergency-stop").hidden = false;
      toast("已开启本机系统光标控制；张嘴会点击当前光标位置");
    } catch (error) {
      toast(error.message || "后端不可用，保持虚拟光标");
      runtime.cursor.stopSystem();
      e.target.value = "virtual";
      $("#btn-emergency-stop").hidden = true;
    }
  } else {
    runtime.cursor.stopSystem();
    $("#mode-pill").textContent = "虚拟光标";
    $("#btn-emergency-stop").hidden = true;
  }
});

$("#btn-emergency-stop")?.addEventListener("click", () => { runtime.emergencyStop(); stopDesktop(); });
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    e.preventDefault();
    runtime.emergencyStop();
    stopDesktop();
  }
});
window.addEventListener("blur", () => {
  // Native desktop control is deliberately independent of this window.
  if (!desktopRunning && !assistant?.pip && !assistant?.floatingOpening) runtime.emergencyStop();
});

$("#sens")?.addEventListener("input", (e) => {
  runtime.cursor.sensitivity = Number(e.target.value);
  $("#sens-val").textContent = runtime.cursor.sensitivity.toFixed(1);
});
$("#smooth")?.addEventListener("input", (e) => {
  runtime.cursor.smoothing = Number(e.target.value);
  $("#smooth-val").textContent = runtime.cursor.smoothing.toFixed(2);
});
$("#mouth-on")?.addEventListener("change", (e) => {
  const mouth = e.target.checked;
  const blink = $("#blink-on")?.checked === true;
  runtime.cursor.clickMode = mouth ? (blink ? "both" : "mouth") : blink ? "blink" : "none";
});
$("#jaw-th")?.addEventListener("input", (e) => {
  runtime.cursor.jawThreshold = Number(e.target.value);
  $("#jaw-val").textContent = runtime.cursor.jawThreshold.toFixed(2);
});
$("#blink-on")?.addEventListener("change", (e) => {
  runtime.cursor.blinkEnabled = e.target.checked;
  const mouth = $("#mouth-on")?.checked !== false;
  runtime.cursor.clickMode = e.target.checked ? (mouth ? "both" : "blink") : mouth ? "mouth" : "none";
});
$("#blink-ms")?.addEventListener("input", (e) => {
  runtime.cursor.blinkMs = Number(e.target.value);
  $("#blink-val").textContent = String(runtime.cursor.blinkMs);
});
$("#ear-th")?.addEventListener("input", (e) => {
  runtime.cursor.earThreshold = Number(e.target.value);
  $("#ear-val").textContent = runtime.cursor.earThreshold.toFixed(2);
});
$("#voice-on")?.addEventListener("change", (e) => {
  runtime.voice.enabled = e.target.checked;
  if (!e.target.checked) runtime.voice.stop();
});

$("#btn-mic")?.addEventListener("click", () => {
  if (!runtime.voice.supported) {
    toast("当前浏览器不支持语音识别，请用 Chrome/Edge");
    return;
  }
  if (runtime.voice.listening) {
    runtime.voice.stop();
    $("#btn-mic").textContent = "开始聆听";
    $("#voice-bubble").textContent = "已停止聆听";
  } else {
    const ok = runtime.voice.start();
    if (ok) {
      $("#btn-mic").textContent = "停止聆听";
      $("#voice-bubble").textContent = "正在聆听…";
    } else {
      $("#btn-mic").textContent = "重新开始聆听";
    }
  }
});

$$(".chip").forEach((c) => {
  c.addEventListener("click", () => {
    const cmd = runtime.voice.match(c.dataset.cmd);
    if (cmd) {
      $("#voice-bubble").textContent = `命令：${cmd.label}`;
      ding();
      if (cmd.action === "ai_look") {
        aiPanel.look("console");
        return;
      }
      runtime.runCommand(cmd);
    }
  });
});

$("#btn-ai")?.addEventListener("click", () => assistant.captureScreen());
$("#settings-open")?.addEventListener("click", () => $("#settings-dialog").showModal());
$("#settings-close")?.addEventListener("click", () => $("#settings-dialog").close());

// 初始默认：张嘴开、眨眼关
if ($("#mouth-on")) $("#mouth-on").checked = true;
if ($("#blink-on")) $("#blink-on").checked = false;
runtime.cursor.clickMode = "mouth";
runtime.cursor.blinkEnabled = false;

window.__ddk = { runtime, aiPanel, collectTargets };

// Switching or refreshing pages never starts a second camera/control loop.

api("/api/health", null, "GET").then((health) => {
  const state = $("#local-mode-state");
  const systemOption = $("#cursor-mode option[value='system']");
  if (health.deployment_mode === "public") {
    if (state) state.textContent = "公网服务 · 系统级控制已禁用";
    if (systemOption) systemOption.disabled = true;
  } else if (state) {
    state.textContent = "Windows 本机版 · 视频不上传";
  }
  desktopAvailable=!!health.desktop_control;
  $("#btn-desktop").disabled = false;
  if(!desktopAvailable){$("#btn-desktop").textContent='控制系统鼠标';$("#desktop-status").textContent='点击控制助手，一步步完成本机启动';}
  $("#desktop-note").textContent = health.deployment_mode === "public"
    ? "公网仅体验本网页。控制其他软件请启动 Windows 本机版。"
    : health.desktop_control ? "切换应用后也能用。全局 Esc、闭眼 1.2 秒或移动实体鼠标可停止。" : "后台控制需要 Windows 本机服务与 MediaPipe 依赖。";
}).catch(() => {
  const state = $("#local-mode-state");
  if (state) state.textContent = "服务未连接 · 请先启动本机服务";
});

async function stopDesktop() {
  if (!desktopRunning) return true;
  try { updateDesktop(await api("/api/desktop/stop", {}));return !desktopRunning; }
  catch { toast("停止请求未送达。请按全局 Esc 或闭眼 1.2 秒停止本机控制。");return false; }
}
const desktopPreview=createCameraPreview($("#desktop-preview"));
function updateDesktop(state) {
  const wasDesktop=desktopRunning;
  desktopRunning=!!state.running;
  if(desktopRunning){if(!wasDesktop||runtime.streaming)runtime.stopCam(true);vcursor.hidden=true;}
  assistant.nativeRunning=desktopRunning;
  $("#btn-desktop").textContent=desktopRunning?"停止后台控制":"后台控制电脑";
  $("#desktop-status").textContent=state.message;
  $("#btn-emergency-stop").hidden=!desktopRunning&&runtime.cursor.mode!=="system";
  if(desktopRunning){$("#mode-pill").textContent="后台系统控制";assistant.syncMouth();}
  else if(runtime.cursor.mode!=="system")$("#mode-pill").textContent="页面内光标";
  const preview=$("#desktop-preview");
  desktopPreview.setActive(desktopRunning);
  if(desktopRunning){preview.hidden=false;camEmpty.hidden=true;camEmpty.style.display="none";modelPill.textContent=state.phase==="active"?"后台控制中":"正在取中";}
  else if(wasDesktop){preview.hidden=true;if(!runtime.streaming){camEmpty.hidden=false;camEmpty.style.display="";modelPill.textContent="已暂停";}}
}
$("#btn-desktop")?.addEventListener("click", async()=>{
  if(!desktopAvailable){showDesktopGuide(runtime,assistant);return;}
  if(desktopRunning){await stopDesktop();return;}
  const button=$("#btn-desktop");button.disabled=true;
  try {
    runtime.stopCam(true);runtime.voice.stop();vcursor.hidden=true;
    runtime.controlChannel?.postMessage('desktop');
    updateDesktop(await api("/api/desktop/start",{sensitivity:runtime.cursor.sensitivity,smoothing:runtime.cursor.smoothing,jaw_threshold:runtime.cursor.jawThreshold,mouth_enabled:$("#mouth-on").checked}));
  } catch(e){toast(e.message);$("#desktop-status").textContent=e.message;}
  finally {button.disabled=false;}
});
// Status observation is not a heartbeat: background control lives in Python.
let pollingDesktop=false;
async function pollDesktop(){
  if(pollingDesktop)return;
  pollingDesktop=true;
  try{const state=await api("/api/desktop/status",null,"GET");updateDesktop(state);}
  catch{/* public mode intentionally rejects this endpoint */}
  finally{pollingDesktop=false;}
}
api("/api/health",null,"GET").then(h=>{if(h.desktop_control){pollDesktop();setInterval(pollDesktop,1500);}}).catch(()=>{});

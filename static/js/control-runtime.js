/**
 * 控制台 / 任务页共用运行时：摄像头 + 头控 + 语音目标辅助
 */
import { $, toast, speak, ding } from "./common.js";
import { FaceTracker } from "./face-tracker.js";
import { CursorController } from "./cursor-controller.js";
import { VoiceController } from "./voice-controller.js";
import { collectTargets } from "./target-collector.js";

export function createControlRuntime(options = {}) {
  const {
    videoEl,
    overlayEl,
    padEl,
    dotEl,
    targetsRoot = document,
    onStatus = () => {},
    onCommand = null,
    onUtterance = null,
    pageLabel = "console",
  } = options;

  const tracker = new FaceTracker();
  const lastPose = { yaw: 0, pitch: 0 };
  const cursor = new CursorController({
    padEl,
    dotEl,
    onBlink: (n) => onStatus({ type: "blink", n }),
    onMouth: (n) => onStatus({ type: "mouth", n }),
    onLock: (t) => onStatus({ type: "lock", target: t }),
    onFallback: (msg) => { emergencyStop(); toast(msg); },
  });
  // 无效旧校准会被自动清除（否则光标会被积分钉死在角落）
  const calOk = cursor.loadCalibration();
  if (!calOk) {
    try {
      if (localStorage.getItem("ddk_cal") === null) {
        /* none is fine */
      }
    } catch {
      /* ignore */
    }
  }

  const voice = new VoiceController({
    onInterim: (t) => onStatus({ type: "voice_interim", text: t }),
    onFinal: (t) => {
      onStatus({ type: "voice_final", text: t });
      if (onUtterance) onUtterance(t, voice.match(t));
    },
    onError: (detail) => onStatus({ type: "voice_error", ...detail }),
    onState: (detail) => onStatus({ type: "voice_state", ...detail }),
    onCommand: (cmd, raw) => {
      onStatus({ type: "voice_cmd", cmd, raw });
      ding();
      runCommand(cmd);
    },
  });

  function ttsOn() {
    const el = document.getElementById("tts-on");
    return !el || el.checked !== false;
  }

  function refreshTargets() {
    cursor.setTargets(collectTargets(targetsRoot));
    return cursor.targets.length;
  }

  function ensureHostForDot() {
    if (!dotEl) return;
    if (!dotEl.parentElement || dotEl.parentElement !== padEl) {
      if (padEl) {
        padEl.style.position = padEl.style.position || "relative";
        padEl.appendChild(dotEl);
      } else {
        document.body.appendChild(dotEl);
        dotEl.style.position = "fixed";
      }
    }
  }

  let streaming = false;
  let raf = 0;
  let lastVideoTime = -1;
  let fpsT = performance.now();
  let fpsN = 0;
  let uiN = 0;
  let poseSamples = [];

  let startPromise = null;
  let cameraEpoch = 0;

  function releaseCameraStream() {
    if (!videoEl?.srcObject) return;
    try {
      videoEl.srcObject.getTracks().forEach((track) => track.stop());
    } finally {
      videoEl.srcObject = null;
    }
  }

  async function startCamInternal() {
    if (!videoEl) return false;
    const epoch = ++cameraEpoch;
    try {
      const response=await fetch('/api/desktop/status',{signal:AbortSignal.timeout(1500)});
      if(response.ok&&(await response.json()).running){toast('请先停止后台控制，再开启页面内光标');return false;}
    }catch{
      if(typeof location!=='undefined'&&['127.0.0.1','localhost'].includes(location.hostname)){toast('无法确认后台控制状态，请稍后再试');return false;}
    }
    if(epoch!==cameraEpoch)return false;
    controlChannel?.postMessage('virtual');
    const cancelled = () => epoch !== cameraEpoch;
    ensureHostForDot();
    streaming = false;
    cancelAnimationFrame(raf);
    releaseCameraStream();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // 640x480 对人脸足够；过高分辨率会把推理拖到数百毫秒
        video: {
          width: { ideal: 640, max: 640 },
          height: { ideal: 480, max: 480 },
          frameRate: { ideal: 30, max: 30 },
          facingMode: "user",
        },
        audio: false,
      });
      if (cancelled()) {
        stream.getTracks().forEach(track => track.stop());
        return false;
      }
      videoEl.srcObject = stream;
      await videoEl.play();
      if (cancelled()) return false;
    } catch (error) {
      releaseCameraStream();
      if (cancelled()) return false;
      const reason = error?.name || "unknown";
      const message = reason === "NotAllowedError" || reason === "SecurityError"
        ? "请允许当前网站使用摄像头；公网体验需要 HTTPS。"
        : reason === "NotFoundError"
          ? "没有检测到可用摄像头。连接摄像头后重试。"
          : reason === "NotReadableError"
            ? "摄像头正被另一个应用占用。关闭其他视频应用后重试。"
            : "摄像头启动失败。检查设备与浏览器权限后重试。";
      toast(message);
      onStatus({ type: "cam_error", reason, message });
      return false;
    }
    try {
      sessionStorage.setItem("ddk_cam", "1");
    } catch {
      /* ignore */
    }
    // 画面一出来就立刻撤掉「未开启」遮罩，不等模型
    onStatus({ type: "cam_ok" });
    try {
      await tracker.init();
      if (cancelled()) { tracker.close?.(); return false; }
      onStatus({ type: "model_ok", delegate: tracker.delegate });
    } catch (e) {
      console.error("[动动口] MediaPipe init failed:", e);
      tracker.close?.();
      releaseCameraStream();
      try {
        sessionStorage.removeItem("ddk_cam");
      } catch {
        /* ignore */
      }
      toast("识别组件加载失败，请点重试", 8000);
      onStatus({ type: "model_error", error: String(e && e.message ? e.message : e) });
      return false;
    }
    await cursor._screen().catch(() => null);
    if (cancelled()) { tracker.close?.(); return false; }
    refreshTargets();
    cursor.beginCentering();
    poseSamples = [];
    lastVideoTime = -1;
    streaming = true;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(loop);
    return true;
  }

  function startCam() {
    if (startPromise) return startPromise;
    startPromise = startCamInternal().finally(() => {
      startPromise = null;
    });
    return startPromise;
  }

  function stopCam(clearPref = true) {
    ++cameraEpoch;
    streaming = false;
    cursor._calibrating = false;
    cancelAnimationFrame(raf);
    cursor.stopSystem();
    releaseCameraStream();
    tracker.close?.();
    onStatus({type: "mode", mode: "virtual"});
    if (overlayEl) {
      const octx = overlayEl.getContext("2d");
      octx?.clearRect(0, 0, overlayEl.width, overlayEl.height);
    }
    if (clearPref) {
      try {
        sessionStorage.removeItem("ddk_cam");
      } catch {
        /* ignore */
      }
    }
    onStatus({ type: "cam_off" });
  }

  async function emergencyStop() {
    // Local cleanup must run before any network await.
    const releasing = cursor.stopSystem();
    voice.stop();
    stopCam(true);
    onStatus({ type: "mode", mode: "virtual" });
    onStatus({ type: "emergency_stop" });
    await releasing;
  }

  window.addEventListener?.("pagehide", () => emergencyStop());
  const controlChannel=typeof window.BroadcastChannel==='function'?new window.BroadcastChannel('ddk-control-mode'):null;
  if(controlChannel)controlChannel.onmessage=()=>{stopCam(true);if(dotEl)dotEl.hidden=true;};
  window.addEventListener?.('pagehide',()=>controlChannel?.close(),{once:true});
  window.addEventListener?.("ddk-speech-start", () => voice.stop());
  document.addEventListener?.("visibilitychange", () => {
    if (document.hidden && cursor.mode === "system") emergencyStop();
  });

  function camWanted() {
    try {
      return sessionStorage.getItem("ddk_cam") === "1";
    } catch {
      return false;
    }
  }

  async function resumeCamIfWanted() {
    if (!camWanted()) return false;
    onStatus({ type: "cam_resume" });
    return startCam();
  }

  function loop() {
    try {
      if (!streaming || !videoEl) return;
      if (overlayEl && videoEl.videoWidth && overlayEl.width !== videoEl.videoWidth) {
        overlayEl.width = videoEl.videoWidth;
        overlayEl.height = videoEl.videoHeight;
      }
      if (videoEl.readyState >= 2 && videoEl.currentTime !== lastVideoTime) {
        lastVideoTime = videoEl.currentTime;
        const now = performance.now();
        const r = tracker.detect(videoEl, now);
        fpsN++;
        if (now - fpsT > 500) {
          const fps = (fpsN * 1000) / (now - fpsT);
          onStatus({ type: "fps", fps, inferMs: r.inferMs });
          fpsT = now;
          fpsN = 0;
        }
        const octx = overlayEl?.getContext("2d");
        if (octx && overlayEl) {
          octx.clearRect(0, 0, overlayEl.width, overlayEl.height);
          if (r.ok && r.lms) {
            tracker.drawMesh(octx, r.lms, overlayEl.width, overlayEl.height);
          }
        }
        if (r.ok) {
          poseSamples.push({yaw: r.yaw, pitch: r.pitch, time: now});
          poseSamples = poseSamples.filter(sample => now - sample.time < 1200);
          lastPose.yaw = r.yaw;
          lastPose.pitch = r.pitch;
          try {
            const centering = cursor._needsAutoCenter;
            cursor.applyPose(r.yaw, r.pitch, r.ear, r.jawOpen || 0, now);
            if (centering && !cursor._needsAutoCenter) onStatus({type: "cal_done", automatic: true});
          } catch (e) {
            console.warn("[动动口] applyPose", e);
          }
          uiN += 1;
          if (uiN % 3 === 0) {
            try {
              onStatus({
                type: "pose",
                yaw: r.yaw,
                pitch: r.pitch,
                ear: r.ear,
                jawOpen: r.jawOpen || 0,
                x: cursor.x,
                y: cursor.y,
                locked: cursor.lockedTarget,
                poseSource: r.poseSource,
              });
            } catch (e) {
              console.warn("[动动口] onStatus", e);
            }
          }
        }
      }
    } catch (e) {
      // 任何异常都不得中断 rAF，否则画面会冻在第一帧
      console.error("[动动口] loop error", e);
    } finally {
      if (streaming) {
        raf = requestAnimationFrame(loop);
      }
    }
  }

  async function runCommand(cmd) {
    const custom = onCommand ? onCommand(cmd) : undefined;
    if (custom === "handled") return;
    switch (cmd.action) {
      case "pause_control":
        await emergencyStop();
        break;
      case "goto_demo":
        location.href = "/demo.html";
        break;
      case "goto_console":
        location.href = "/console.html";
        break;
      case "goto_home":
        location.href = "/index.html";
        break;
      case "goto_arch":
        location.href = "/architecture.html";
        break;
      case "scene_browse":
      case "scene_shop":
      case "scene_clinic":
        if (typeof window.__ddkSetScene === "function") {
          window.__ddkSetScene(cmd.action.replace("scene_", ""));
          speak(cmd.label, ttsOn());
        } else {
          location.href = "/demo.html";
        }
        break;
      case "tmall":
        if (typeof window.__ddkOpenTmall === "function") {
          window.__ddkOpenTmall();
        } else {
          location.href = "/demo.html";
        }
        break;
      case "back_close":
        if (typeof window.__ddkCloseTmall === "function" && window.__ddkCloseTmall()) {
          /* 已关天猫壳 */
        } else if (typeof window.__ddkCloseOverlays === "function" && window.__ddkCloseOverlays()) {
          /* 已关其它浮层 */
        } else {
          speak("可点击「返回演示站」，或说「打开天猫」", ttsOn());
        }
        break;
      case "click":
        await doClick("left", 1);
        break;
      case "dblclick":
        await doClick("left", 2);
        break;
      case "right":
        await doClick("right", 1);
        break;
      case "scroll_up":
        await doScroll(-3);
        break;
      case "scroll_down":
        await doScroll(3);
        break;
      case "next_target": {
        refreshTargets();
        const t = cursor.cycleTarget(1);
        if (t) speak(`已对准${t.text || "目标"}`, ttsOn());
        else toast("当前页暂无可选目标");
        break;
      }
      case "prev_target": {
        refreshTargets();
        const t2 = cursor.cycleTarget(-1);
        if (t2) speak(`已对准${t2.text || "目标"}`, ttsOn());
        break;
      }
      case "pick_n": {
        refreshTargets();
        const t3 = cursor.pickByIndex(cmd.value || 1);
        if (t3) speak(`第${cmd.value}个，${t3.text || "目标"}`, ttsOn());
        else toast(`没有第${cmd.value}个目标`);
        break;
      }
      case "confirm":
      case "click_confirm":
        await doClick("left", 1);
        break;
      case "cancel":
        cursor.lockedTarget = null;
        onStatus({ type: "lock", target: null });
        break;
      case "type": {
        const text = cmd.value || "";
        if (cursor.mode === "system") {
          if (await cursor.systemRequest("/api/keyboard/type", {text})) toast(`已输入：${text}`);
        } else {
          const ae = document.activeElement;
          if (ae && "value" in ae) ae.value += text;
          toast(`本地输入：${text}`);
        }
        break;
      }
      case "ai_look":
        onStatus({ type: "ai_look" });
        break;
      default:
        break;
    }
  }

  async function doClick(button, clicks) {
    cursor.ripple();
    if (cursor.mode === "system") {
      const ok = await cursor.clickSystem(button, clicks);
      if (!ok) {
        return; // Never turn a cancelled system click into a DOM click.
      }
    } else {
      refreshTargets();
      cursor.clickVirtual();
    }
    speak(button === "right" ? "右键" : clicks > 1 ? "双击" : "单击", ttsOn());
  }

  async function doScroll(dy) {
    if (cursor.mode === "system") {
      try {
        await cursor.systemRequest("/api/mouse/scroll", { dy, dx: 0 });
      } catch {
        toast("滚动失败或系统控制未开启");
      }
    } else {
      window.scrollBy({ top: dy * 80, behavior: "smooth" });
    }
  }

  async function startCalibrate(seconds = 5) {
    if (!streaming) {
      toast("请先开启摄像头");
      return false;
    }
    const epoch = cameraEpoch;
    cursor.stopSystem();
    onStatus({type: "mode", mode: "virtual"});
    cursor._calibrating = true;
    onStatus({ type: "cal_start", seconds });
    let n = seconds;
    await new Promise((resolve) => {
      const timer = setInterval(() => {
        n -= 1;
        onStatus({ type: "cal_tick", n: Math.max(n, 0) });
        if (n <= 0) {
          clearInterval(timer);
          resolve();
        }
      }, 1000);
    });
    cursor._calibrating = false;
    if (!streaming || epoch !== cameraEpoch) return false;
    const recent = poseSamples.filter(sample => performance.now() - sample.time < 900);
    if (recent.length < 8) {
      cursor.beginCentering();
      onStatus({type: "cal_cancel"});
      toast("没有采集到稳定人脸，请面对摄像头后重试");
      return false;
    }
    const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
    cursor.setCalibration(median(recent.map(p => p.yaw)), median(recent.map(p => p.pitch)));
    onStatus({ type: "cal_done" });
    speak("校准完成", ttsOn());
    toast("校准完成");
    return true;
  }

  return {
    tracker,
    controlChannel,
    cursor,
    voice,
    pageLabel,
    startCam,
    stopCam,
    emergencyStop,
    resumeCamIfWanted,
    camWanted,
    startCalibrate,
    refreshTargets,
    runCommand,
    doClick,
    ttsOn,
    get streaming() {
      return streaming;
    },
  };
}

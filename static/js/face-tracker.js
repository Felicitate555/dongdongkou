/**
 * MediaPipe FaceLandmarker 封装
 * 模型: /models/face_landmarker.task  WASM: /models/wasm
 * 支持 jawOpen（张嘴点击）与可选头姿矩阵增强
 */

const EAR_LEFT = [33, 160, 158, 133, 153, 144];
const EAR_RIGHT = [362, 385, 387, 263, 373, 380];
// 上下唇关键点（FaceMesh）
const LIP_TOP = 13;
const LIP_BOTTOM = 14;

function earOf(lms, ids) {
  const p = ids.map((i) => lms[i]);
  const v1 = Math.hypot(p[1].x - p[5].x, p[1].y - p[5].y);
  const v2 = Math.hypot(p[2].x - p[4].x, p[2].y - p[4].y);
  const h = Math.hypot(p[0].x - p[3].x, p[0].y - p[3].y);
  return h < 1e-6 ? 1 : (v1 + v2) / (2 * h);
}

/** 鼻尖相对双眼中心 → yaw/pitch（9 月 legacy 原版公式） */
function poseFrom(lms) {
  const nose = lms[1];
  const le = lms[33];
  const re = lms[263];
  const cx = (le.x + re.x) / 2;
  const cy = (le.y + re.y) / 2;
  // 翻转摄像头：头向左（画面右）→ yaw 正
  // pitch：鼻相对眼心。平视时因鼻在眼下方会有正偏置，必须靠校准中心消掉
  const yaw = (cx - nose.x) * 10;
  const pitch = (nose.y - cy) * 10;
  return { yaw, pitch, roll: 0, source: "heuristic" };
}

/** 从 facialTransformationMatrixes 提取近似 yaw/pitch（度），失败返回 null */
function poseFromMatrix(matrix) {
  try {
    // MediaPipe 返回 4x4 列主序或 data 数组；兼容 {data:[]} 与数组
    const m = matrix?.data || matrix;
    if (!m || m.length < 16) return null;
    // 取旋转部分（列主序）
    const r00 = m[0], r10 = m[1], r20 = m[2];
    const r01 = m[4], r11 = m[5], r21 = m[6];
    const r02 = m[8], r12 = m[9], r22 = m[10];
    const pitchRad = Math.asin(Math.max(-1, Math.min(1, -r20)));
    const yawRad = Math.atan2(r21, r22);
    const yaw = (yawRad * 180) / Math.PI * 0.15; // 缩放到与启发式相近量级，供自由指针映射使用
    const pitch = (pitchRad * 180) / Math.PI * 0.15;
    if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) return null;
    return { yaw, pitch, roll: 0, source: "matrix" };
  } catch {
    return null;
  }
}

function jawOpenFrom(result, lms) {
  const cats = result?.faceBlendshapes?.[0]?.categories;
  if (cats && cats.length) {
    const jaw = cats.find((c) => c.categoryName === "jawOpen" || c.categoryName === "JawOpen");
    if (jaw && Number.isFinite(jaw.score)) {
      return { jawOpen: Math.max(0, Math.min(1, jaw.score)), jawSource: "blendshape" };
    }
  }
  if (lms && lms[LIP_TOP] && lms[LIP_BOTTOM]) {
    const faceH = Math.hypot(lms[10].x - lms[152].x, lms[10].y - lms[152].y) || 1e-6;
    const open = Math.hypot(lms[LIP_TOP].x - lms[LIP_BOTTOM].x, lms[LIP_TOP].y - lms[LIP_BOTTOM].y) / faceH;
    return { jawOpen: Math.max(0, Math.min(1, open * 4)), jawSource: "landmark" };
  }
  return { jawOpen: 0, jawSource: "none" };
}

/** 面部网格稀疏连线（用于 canvas 绘制） */
const MESH_EDGES = [
  [10, 338], [338, 297], [297, 332], [332, 284], [284, 251], [251, 389],
  [389, 356], [356, 454], [454, 323], [323, 361], [361, 288], [288, 397],
  [397, 365], [365, 379], [379, 378], [378, 400], [400, 377], [377, 152],
  [152, 148], [148, 176], [176, 149], [149, 150], [150, 136], [136, 172],
  [172, 58], [58, 132], [132, 93], [93, 234], [234, 127], [127, 162],
  [162, 21], [21, 54], [54, 103], [103, 67], [67, 109], [109, 10],
  [33, 7], [7, 163], [163, 144], [144, 145], [145, 153], [153, 154],
  [154, 155], [155, 133],
  [362, 382], [382, 381], [381, 380], [380, 374], [374, 373], [373, 390],
  [390, 249], [249, 263],
  [1, 2], [2, 98], [98, 327], [1, 4], [4, 5], [5, 195], [195, 197],
];

export class FaceTracker {
  constructor() {
    this.landmarker = null;
    this.ready = false;
    this.error = "";
    this.lastInferMs = 0;
    this.delegate = "unknown";
    this._frameTs = 0;
  }

  async init() {
    if (this.landmarker) return this;

    // 优先稳定 URL 以便浏览器缓存；仅失败时再 cache-bust 重试
    const loadMod = async (bust) => {
      const candidates = bust
        ? [`/models/vision_bundle.mjs?v=${bust}`, `/models/vision_bundle.js?v=${bust}`]
        : ["/models/vision_bundle.mjs", "/models/vision_bundle.js"];
      const errors = [];
      for (const url of candidates) {
        try {
          return await import(/* @vite-ignore */ url);
        } catch (e) {
          errors.push(`${url}: ${e && e.message ? e.message : e}`);
        }
      }
      throw new Error(errors.join(" | ") || "import failed");
    };

    let mod = null;
    try {
      mod = await loadMod(0);
    } catch (e1) {
      mod = await loadMod(Date.now());
    }

    const { FaceLandmarker, FilesetResolver } = mod;
    if (!FaceLandmarker || !FilesetResolver) {
      throw new Error("MediaPipe 模块缺少 FaceLandmarker/FilesetResolver 导出");
    }

    const fileset = await FilesetResolver.forVisionTasks("/models/wasm");
    const tryCreate = async (delegate, bust) => {
      return FaceLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: bust
            ? `/models/face_landmarker.task?v=${bust}`
            : "/models/face_landmarker.task",
          delegate,
        },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
      });
    };
    try {
      this.landmarker = await tryCreate("GPU", 0);
      this.delegate = "GPU";
    } catch (e1) {
      try {
        this.landmarker = await tryCreate("CPU", 0);
        this.delegate = "CPU";
      } catch (e2) {
        const b = Date.now();
        try {
          this.landmarker = await tryCreate("GPU", b);
          this.delegate = "GPU";
        } catch {
          try {
            this.landmarker = await tryCreate("CPU", b);
            this.delegate = "CPU";
          } catch (e3) {
            throw new Error(
              `GPU: ${e1 && e1.message ? e1.message : e1} / CPU: ${e2 && e2.message ? e2.message : e2}`
            );
          }
        }
      }
    }
    this.ready = true;
    return this;
  }

  close() {
    try {
      this.landmarker?.close?.();
    } catch {
      /* best-effort release when a browser GPU context is already gone */
    }
    this.landmarker = null;
    this.ready = false;
    this._frameTs = 0;
  }

  /**
   * @returns {{
   *   ok:boolean, lms?:any[], yaw:number, pitch:number, roll:number,
   *   ear:number, jawOpen:number, inferMs:number, landmarks?:any, poseSource?:string
   * }}
   */
  detect(video, now) {
    const empty = {
      ok: false,
      yaw: 0,
      pitch: 0,
      roll: 0,
      ear: 1,
      jawOpen: 0,
      inferMs: 0,
      poseSource: "none",
    };
    if (!this.landmarker || video.readyState < 2) {
      return empty;
    }
    const t0 = performance.now();
    // 与 legacy 相同：每帧用单调递增毫秒时间戳
    const ts = Math.max((this._frameTs || 0) + 1, Math.floor(t0));
    this._frameTs = ts;
    let result;
    try {
      result = this.landmarker.detectForVideo(video, ts);
    } catch (e) {
      console.warn("[动动口] detectForVideo failed", e);
      return { ...empty, inferMs: performance.now() - t0 };
    }
    this.lastInferMs = performance.now() - t0;
    const faces = result.faceLandmarks || [];
    if (!faces.length) {
      return { ...empty, inferMs: this.lastInferMs };
    }
    const lms = faces[0];
    // 固定启发式，不用矩阵（矩阵轴向会导致光标轴对调/乱跑）
    const pose = poseFrom(lms);
    const ear = (earOf(lms, EAR_LEFT) + earOf(lms, EAR_RIGHT)) / 2;
    const { jawOpen, jawSource } = jawOpenFrom(result, lms);
    return {
      ok: true,
      lms,
      landmarks: result.faceLandmarks,
      transformation: result.facialTransformationMatrixes?.[0] || null,
      yaw: pose.yaw,
      pitch: pose.pitch,
      roll: pose.roll,
      ear,
      jawOpen,
      jawSource,
      poseSource: pose.source,
      inferMs: this.lastInferMs,
    };
  }

  /** 全脸网格 + 关键点（与早期流畅版一致） */
  drawMesh(ctx, lms, w, h) {
    ctx.save();
    ctx.strokeStyle = "rgba(0,229,255,0.35)";
    ctx.lineWidth = 1;
    for (const [a, b] of MESH_EDGES) {
      const pa = lms[a];
      const pb = lms[b];
      if (!pa || !pb) continue;
      ctx.beginPath();
      ctx.moveTo(pa.x * w, pa.y * h);
      ctx.lineTo(pb.x * w, pb.y * h);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(0,229,255,0.85)";
    for (let i = 0; i < lms.length; i += 4) {
      const p = lms[i];
      if (!p) continue;
      ctx.fillRect(p.x * w - 1, p.y * h - 1, 2, 2);
    }
    const mark = (i, color, r) => {
      const p = lms[i];
      if (!p) return;
      ctx.beginPath();
      ctx.fillStyle = color;
      ctx.arc(p.x * w, p.y * h, r, 0, Math.PI * 2);
      ctx.fill();
    };
    mark(1, "#F59E0B", 4);
    mark(33, "#10B981", 3);
    mark(263, "#10B981", 3);
    ctx.restore();
  }
}

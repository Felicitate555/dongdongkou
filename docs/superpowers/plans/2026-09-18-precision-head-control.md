# 动动口 · 精准头控与日常场景升级 · 实施计划

> **已被取代（2026-09-29）**：本计划保存早期设计记录，其中关于磁吸、目标锁定和“先对准才允许点击”的要求已不再适用。当前产品以自由指针直接点击为准；目标序号仅可作为可选语音辅助。部署、隐私和双模式要求以 `2026-09-28-dongdongkou-overhaul.md` 及 `PRODUCT.md` 为准。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让上肢受限用户能用「头控 + 张嘴 + 语音」在**日常电脑任务**中精准操作系统鼠标/页面控件；不局限于挂号。

**Architecture:** 浏览器本地 MediaPipe（blendshapes 张嘴 + 改进头姿）→ 磁吸目标收集 → 虚拟/系统光标对准中心 → 张嘴/语音确认点击；后端仅在系统控制与 AI 看屏时介入；系统控制默认关闭。

**Tech Stack:** FastAPI + 原生 HTML/CSS/JS + MediaPipe FaceLandmarker（本地 `static/models`）+ Web Speech + pyautogui（可选）+ OpenCV 本地规则 + 可选 Qwen-VL（DashScope）

**Spec:** 本会话阶段 1 需求结论（用户已确认）+ `docs/superpowers/plans/2026-09-18-precision-head-control.md`

## Global Constraints（执行时必须遵守）

- 端口保持 **8787**；入口 `run.py` / `启动.bat`；目录 `server/`、`static/` 不推倒重来
- MediaPipe 模型必须继续从 **`static/models/`** 本地加载，不得改为强依赖外网 CDN
- 中文 UI；演示站可点控件热区尽量 **≥44px**
- 控制台主路径：虚拟光标可用；**系统光标为显式开启的增强**，失败必须降级并提示
- AI 看屏：本地规则必须可用；云端 Qwen **可选**，无 key 不得阻塞
- 默认交互：**张嘴点击**；眨眼可保留为设置项
- 不引入需要 build 的前端工程
- API Key **由用户自行填入**，执行者不得提交密钥；见 Task 0
- 每完成一个逻辑任务：跑 `python scripts/smoke_test.py`（或 venv 内等价命令）并更新 `验收清单.md`
- 禁止无计划大爆炸重写

---

## 需求结论（已确认，执行时对照）

| 项 | 结论 |
|----|------|
| 北极星 | 评委问「到底能不能精准控鼠标」；张嘴点击 + 小按钮可对准 |
| 场景 | **残疾人日常使用**，不限于挂号；挂号仅场景之一 |
| 策略 | **A 磁吸对准为主** + B 头姿/校准增强 + C 序号/语音托底 |
| 光标域 | 当前产品页可点控件（含演示/日常任务页） |
| 安全 | 默认虚拟光标；系统控制需显式开启 |
| 网络 | 用户可能部署外网域名；实现仍保证模型与核心逻辑可离线 |
| 资源 | 初赛约 2–4 周，3 人以上 |

### 演示场景重构（产品层）

从「仅医院挂号」改为 **日常任务台**（可多 tab / 多卡片）：

1. **看资讯 / 浏览** — 大标题列表 + 打开文章 + 返回  
2. **电商下单（贴合天猫黑客松）** — 商品卡 → 加入购物车 → 确认订单（模拟）  
3. **办事预约** — 保留社区医院挂号五步，作为「医疗办事」场景  

演示站文件仍可叫 `demo.html`，文案改为「生活办事演示」；若改路径必须在 Task 中单独迁移并改导航。

---

## 模型 API（用户自行填写，执行者只读说明）

**推荐模型：阿里云百炼 / DashScope · 通义千问视觉**

| 项 | 推荐值 | 原因 |
|----|--------|------|
| 服务 | DashScope 兼容模式（代码已对接） | 与 `server/ai_assist.py` 现有 `urllib` 调用一致，国内可用 |
| 模型 ID | **`qwen2.5-vl-72b-instruct`**（精度优先）或 `qwen-vl-plus`（成本优先） | UI 控件/中文界面定位更稳 |
| Base URL | `https://dashscope.aliyuncs.com/compatible-mode/v1`（`config.QWEN_BASE` 默认） | 勿随意改 |

**填写位置（二选一，推荐方式 1）：**

1. **`server/config.py` 第 22–23 行**（用户本地填写，**不要提交 git**）：

```python
QWEN_API_KEY = "sk-你的密钥"
QWEN_MODEL = "qwen2.5-vl-72b-instruct"  # 或 qwen-vl-plus
```

2. **环境变量**（优先级更高，`ai_assist.py` 会 `os.getenv("QWEN_API_KEY")`）：

```bat
set QWEN_API_KEY=sk-你的密钥
python run.py
```

**执行者注意：** Task 0 只改 `.gitignore` 与文档说明，**绝不写入真实 Key**。无 Key 时本地 CV 路径必须继续工作。

---

## 目标架构（实现后）

```text
摄像头帧 (本地)
    │
    ▼
FaceTracker
  ├─ blendshapes.jawOpen + 唇距 → 张嘴点击（默认）
  ├─ （可选）眨眼 EAR → 设置项
  └─ 头姿角（matrix/启发式）→ 相对位移
    │
    ▼
CursorController（作用域：当前页面）
  ├─ 收集 TargetCollector（DOM data-target / button / AI 元素）
  ├─ 磁吸：距离 < radius → 对准 center + 高亮 + TTS
  ├─ virtual: elementFromPoint / magnet DOM click
  └─ system（显式开启）:
        magnet → 元素中心映射屏幕坐标 → POST /api/mouse/move → /click
        失败 → 降级 virtual + 提示
    │
托底：语音「下一项/第N个/确认」序号循环
```

---

## 推荐重构边界（模块职责）

| 模块 | 职责 | 不负责 |
|------|------|--------|
| `face-tracker.js` | 检测、jawOpen/EAR、头姿 | 不直接点 DOM |
| `target-collector.js` **新建** | 枚举可点目标与中心坐标 | 不移动光标 |
| `cursor-controller.js` | 积分/磁吸/点击/系统推送 | 不解析 MediaPipe |
| `control-runtime.js` **新建** | 控制台+任务页共用的开麦/开摄像头/命令分发 | 不含页面业务数据 |
| `voice-controller.js` | 识别与命令表 | 不直接 DOM |
| `server/mouse_controller.py` | 系统鼠标 | 无鉴权时默认拒绝见 Task 2 |
| `server/ai_assist.py` | 截图识别目标 | 不驱动光标 |

---

## 阶段 2：产品与体验评审（问题清单）

### P0（阻塞「精准可控」叙事）

| ID | 问题 | 位置 | 改进方向 |
|----|------|------|----------|
| P0-1 | 虚拟光标仅在 `#cam-wrap` 内命中 | `cursor-controller.js` `clickVirtual`；`console.html` vcursor | 光标作用域改为**当前页面**；演示/任务页可点 |
| P0-2 | 任务页无免手链路 | `demo.js` / `demo.html` | 引入 `control-runtime` 或同等共享逻辑 |
| P0-3 | 张嘴点击未实现；blendshapes 关闭 | `face-tracker.js:94` `outputFaceBlendshapes: false` | 打开 blendshapes，jawOpen 主点击 |
| P0-4 | 系统鼠标小按钮难命中（用户实测） | `applyPose` 相对积分 + 整屏映射 | 磁吸到元素中心再 click；序号托底 |
| P0-5 | AI 反馈与点击目标脱节 | `ai-panel.js` 选中后仅虚拟点击 cam 内 | AI 元素进入 TargetCollector，与磁吸共用 |

### P1（体验与可信度）

| ID | 问题 | 位置 | 改进 |
|----|------|------|------|
| P1-1 | 文案仍写「长眨→单击」 | `console.html:154` 等 | 改为「张嘴→点击」，设置可切换 |
| P1-2 | TTS 开关无效 | `console.js:128`；`ai-panel.js` 写死 `true` | `speak(..., ttsOn())` 全站统一 |
| P1-3 | 控制台信息过载、主操作不够突出 | `console.css` 侧栏 6+ 面板 | 主路径按钮放大；系统鼠标/嘴控状态一眼可见 |
| P1-4 | 按钮热区偏小（chip 32px、btn-sm） | `console.css:87-96` 等 | 交互主路径 ≥44px |
| P1-5 | 首页叙事偏「挂号」 | `index.html` hero/亮点 | 改为日常三件事 + 精准可控 |
| P1-6 | 对准状态不可感知 | 无磁吸高亮/TTS | 吸附时描边 + 短 TTS + 日志 |
| P1-7 | 内网 CDN：Tailwind / html2canvas | `index.html:11`；`console.html:10` | 本地化或移除；截图用几何降级为主 |
| P1-8 | 健康状态与文档版本不一致 | `home.js` vs `config.VERSION` vs `docs/验收清单.md` | 统一文案与 API 名 |

### P2（打磨）

| ID | 问题 |
|----|------|
| P2-1 | 首页 GitHub `#` 占位 |
| P2-2 | 架构页需补磁吸/张嘴/安全开关时序 |
| P2-3 | 深色主题对比度与焦点环（键盘/放大镜用户） |
| P2-4 | 演示站浅色与产品深色切换时导航状态一致性 |

### 设计方向（评审结论，实现时遵守）

- 风格锚点：**无障碍工具 + 深色控制台仪表**，不是营销站花活  
- 调色：底 `#0B0F19`，主强调青 `#00E5FF`，状态绿/琥珀/红沿用 `global.css`  
- 字体：沿用系统栈 + 中文 YaHei/PingFang；正文 ≥16px，关键状态 ≥14px  
- 签名时刻：**磁吸环亮起 + 张嘴确认涟漪 + 短 TTS「已对准」**  
- 演示站大热区、编号角标，与磁吸序号一致  

---

## 阶段 3：工程与架构审查（技术债）

| ID | 债务 | 位置 | 风险 | 建议边界 |
|----|------|------|------|----------|
| E1 | 相对积分光标，帧率敏感 | `cursor-controller.js:125-128` | 漂移、点不准 | 保留积分但**磁吸修正**；后续可加死区/增益 |
| E2 | 头姿启发式过粗 | `face-tracker.js:poseFrom` | 侧脸失效 | 读 transformation matrix 作增强，失败回退启发式 |
| E3 | blendshapes 未开 | `face-tracker.js:94` | 无法张嘴点击 | 必须打开；解析 `jawOpen` |
| E4 | 系统 API 无鉴权 + CORS `*` | `main.py:27-32` 等 | LAN 控鼠标 | 默认 `system_control_enabled=false`；开启才路由生效 |
| E5 | 文档 `/api/command` 不存在 | `docs/验收清单.md` | 验收失败 | 改为 `/api/ai_assist` 等真实契约 |
| E6 | 双 venv 文档不一 | `启动.bat` vs `docs/部署手册.md` | 部署乱 | 统一 `venv\` |
| E7 | AI 缓存 hash 截断 | `ai_assist.py:20-22` | 误缓存 | 用整串 hash 或前 N+长度+简单抽样 |
| E8 | smoke 过松 | `smoke_test.py` | 假绿 | 补：jaw 逻辑单测、磁吸纯函数、系统控制默认关、ai_assist 无 key |
| E9 | voice 命令未进任务页 | `demo.js` | 闭环断 | runtime 共享 |
| E10 | CDN 依赖 | index/console html | 内网样式崩 | 去 Tailwind 或 vendor；html2canvas 可选本地 |
| E11 | 日志曾 `/index.html` 404 | `server_out.log` | 路由疑云 | 实现时 TestClient 固定断言 200 |
| E12 | TTS 硬编码 true | `ai-panel.js` | 设置无效 | 统一开关 |
| E13 | 坐标映射假设 960x640 | `ai-panel.js` / `console.js` | 标注偏移 | TargetCollector 用 **DOM 视口坐标** 为主，AI bbox 仅辅助 |

### 推荐测试图

```text
scripts/smoke_test.py
  ├─ test_imports / PORT 8787
  ├─ test_pages 四页 200
  ├─ test_static_models
  ├─ test_ai_local（无 key）
  ├─ test_health_contract（含 system_control 字段）
  ├─ test_system_mouse_default_denied（未开启时 403/400）
  └─ test_magnet_pure / test_jaw_threshold_pure（新增纯函数）

tests/（可选 pytest 后续）
  └─ 不强制本轮上 pytest，优先 smoke 可跑
```

---

## 阶段 4：任务分解（无上下文执行者可照做）

排序原则：**安全与契约 → 张嘴与检测 → 磁吸与光标域 → 系统鼠标精准路径 → 日常场景页 → 文档与验收**。

### Task 0：密钥与忽略规则（不写真实 Key）

**Files:**
- Modify: `.gitignore`
- Modify: `README.md`（API Key 一节，指向 config.py:22）
- Modify: `docs/部署手册.md`（可选 Qwen 说明）

- [ ] `.gitignore` 增加：`server/local_secrets.py`、`.env`、`*.pem`
- [ ] README 写明：填 `server/config.py` 的 `QWEN_API_KEY` / `QWEN_MODEL`，或环境变量；**勿提交密钥**
- [ ] 建议（可选）：增加 `server/local_secrets.py` 读取覆盖且被 gitignore——若做，在 `config.py` 末尾 try-import，失败忽略

**验收:** 无密钥文件被 git 跟踪；文档写清填写位置。

---

### Task 1：系统控制安全默认

**Files:**
- Modify: `server/config.py` — 增 `SYSTEM_CONTROL_ENABLED = False`
- Modify: `server/main.py` — `/api/mouse/*`、`/api/keyboard/*` 在未开启时返回 403 detail「系统控制未开启」
- Modify: `scripts/smoke_test.py`
- Modify: `static/js/console.js` — health 带 `system_control` 时 UI 提示
- Modify: `static/js/cursor-controller.js` — 不依赖 CORS 行为变化的部分仅提示

**Interfaces:**
- Produces: `health` JSON 增加 `"system_control": bool`
- Produces: 未开启时 POST `/api/mouse/move` → status 403（或 400，全项目统一用 **403**）

- [ ] 写 smoke：未开启时 move 返回 403；health.system_control is False
- [ ] 跑 smoke 确认失败
- [ ] 实现 config + 路由守卫 + health 字段
- [ ] 跑 smoke 通过
- [ ] 更新 `验收清单.md`
- [ ] Commit

**风险:** 演示系统鼠标前必须在 config 或环境打开开关。部署手册写清。

---

### Task 2：FaceTracker 张嘴 + 头姿增强

**Files:**
- Modify: `static/js/face-tracker.js`
- Test: `scripts/smoke_test.py` 增加纯函数测试（可把 jaw 阈值逻辑抽到可测片段或文档化手动步骤）

**Interfaces:**
- Produces: `detect()` 返回增加 `jawOpen: number`（0~1，无脸时为 0）
- Produces: `outputFaceBlendshapes: true`
- Produces: 可选 `poseSource: "matrix"|"heuristic"`

- [ ] 打开 blendshapes；从 `result.faceBlendshapes` 取 `jawOpen`
- [ ] 无 blendshapes 时用关键点唇距归一化回退
- [ ] `poseFrom` 优先读 `facialTransformationMatrixes` 的 yaw/pitch（实现时注意矩阵轴），失败用现启发式
- [ ] 手动：开摄像头，张嘴时 `window.__ddk.tracker` 或状态栏显示 jawOpen 变化
- [ ] 更新验收清单「张嘴检测」
- [ ] Commit

---

### Task 3：TargetCollector + 磁吸 CursorController

**Files:**
- Create: `static/js/target-collector.js`
- Modify: `static/js/cursor-controller.js`
- Modify: `static/css/global.css` 或 `console.css` — `.magnet-ring`、`.target-active`
- Test: smoke 纯函数（距离/最近目标选择）

**Interfaces:**
- `collectTargets(root=document): Array<{id,text,x,y,w,h,el}>` — x,y 为视口中心
- `CursorController.setTargets(list)` / `magnetRadius`（默认 72，可调）
- `applyPose` 后若最近目标距离 < radius → `this.x/y` 吸到目标中心相对 pad，或直接记录 `this.lockedTarget`
- 点击时：`clickVirtual` 优先 `lockedTarget.el.click()`；system 模式用 lockedTarget 中心屏幕坐标

- [ ] 实现 collectTargets（`button, a, [data-click], input, select, [role=button]`）
- [ ] 实现最近邻与吸附；吸附时 DOM 加 class + 可选 speak
- [ ] 控制台 `pad` 不再是唯一命中域：虚拟光标位置改为相对 **viewport 或 stage**，吸附后点 DOM
- [ ] smoke：纯函数 `nearestTarget(cursor, targets, radius)` 断言
- [ ] Commit

**光标域说明:** 实现阶段将 `vcursor` 移到 `body` 或全屏 fixed 容器，坐标用视口归一化，避免仅 cam-wrap。

---

### Task 4：张嘴点击接线 + 设置项

**Files:**
- Modify: `static/js/console.js`
- Modify: `static/js/cursor-controller.js`
- Modify: `static/console.html` — 文案与开关：`mouth-on` 默认开，`blink-on` 默认关
- Modify: `static/js/ai-panel.js` — `speak` 尊重 TTS 开关

**Interfaces:**
- `cursor.clickMode: "mouth"|"blink"|"both"`
- `cursor.jawThreshold`（默认 0.5，可滑条 0.3–0.8）
- 冷却：≥800ms 防抖（与现 `_lastClick` 一致）

- [ ] `applyPose(yaw,pitch,ear,jawOpen,now)` 扩展参数（全调用点更新）
- [ ] mouth 模式：`jawOpen >= threshold` 且冷却内 → click
- [ ] 状态栏显示 jawOpen；提示文案改为张嘴
- [ ] TTS 统一 `ttsOn()`
- [ ] Commit

---

### Task 5：系统鼠标精准路径

**Files:**
- Modify: `static/js/cursor-controller.js` — `_pushSystem` / `clickSystem`
- Modify: `server/mouse_controller.py` — 可选：坐标 clamp 到屏幕
- Modify: `server/main.py` — 已在 Task1 守卫

- [ ] system 模式：有 `lockedTarget` 时 `move` 到该元素视口中心映射屏幕坐标，再 `click`
- [ ] 无 lockedTarget：保持现有归一化整屏映射，并在 UI 提示「未对准目标，建议靠近按钮或使用序号」
- [ ] fetch 失败/403：降级 virtual + toast + mode 下拉回 virtual
- [ ] 真机：小按钮（~48px）磁吸后点击成功率手测记录到验收清单
- [ ] Commit

---

### Task 6：共享 control-runtime + 日常任务页

**Files:**
- Create: `static/js/control-runtime.js`
- Modify: `static/js/console.js` — 复用 runtime（可渐进：先抽命令处理）
- Modify: `static/demo.html` + `static/demo.js` + `static/demo.css`
- Modify: 首页 `index.html` / `home.css` 叙事

**演示内容结构（数据驱动）:**

```js
// demo.js 顶部
const SCENES = [
  { id: "browse", title: "看资讯", ... },
  { id: "shop", title: "模拟购物", ... },  // 商品→加购→确认
  { id: "clinic", title: "社区预约", ... } // 现挂号五步迁入
];
```

- [ ] 页头增加场景切换 tab（大按钮 ≥44px）
- [ ] 每个场景内控件带 `data-click`
- [ ] demo 页加载 `control-runtime`：摄像头可选小窗 + 语音命令 + 磁吸可用
- [ ] 语音命令增加：`下一项目标` / `上一项目标` / `点击` / `打开购物` 等
- [ ] 序号托底：目标列表角标 1..n，语音「第2个」
- [ ] 首页文案：日常三件事 + 精准头控/张嘴
- [ ] Commit

**迁移注意:** 若删除纯挂号叙事，保留 clinic 场景数据，避免验收脚本/队友习惯全失效。

---

### Task 7：CDN 降级与静态资源

**Files:**
- Modify: `static/index.html` — 去掉 `cdn.tailwindcss.com` 或改为本地 `static/vendor/tailwind.js`（若体积过大则**删除依赖**，确保 `home.css` 自足）
- Modify: `static/console.html` — html2canvas 改为可选本地文件或移除 script，依赖几何截图降级
- Modify: `server/main.py` — 确认 `.mjs/.wasm/.task` MIME 保持

- [ ] 无外网 hosts 屏蔽测试：首页样式完整、控制台可开、模型 URL 200
- [ ] Commit

---

### Task 8：文档、验收与冒烟收口

**Files:**
- Modify: `README.md`、`验收清单.md`、`docs/验收清单.md`、`docs/部署手册.md`
- Modify: `scripts/smoke_test.py`
- Modify: `static/architecture.html` — 补磁吸/张嘴/开关

- [ ] 合并验收口径：唯一真相 `验收清单.md`（docs 可改为指针或同步）
- [ ] 修正错误 API 名；health 版本与 UI 文案一致
- [ ] smoke 全绿：页面、模型、ai 本地、系统控制默认关、磁吸/jaw 纯函数
- [ ] 部署手册：venv 统一、`SYSTEM_CONTROL_ENABLED`、Qwen Key 位置、防火墙 8787
- [ ] Commit

---

## 执行顺序与分工建议（3 人）

| 人 | 任务 |
|----|------|
| A 算法/控制 | Task 2–5 |
| B 场景/前端 | Task 6–7 |
| C 安全/文档/测 | Task 0–1、8，并全程更新验收清单 |

集成点：Task 3 磁吸接口冻结后 B 才接 demo；Task 1 health 字段冻结后 A/C 联调。

---

## 验收标准（初赛演示可勾选）

- [ ] 默认虚拟光标；系统控制未开启时 API 拒绝且 UI 有提示
- [ ] 张嘴可触发点击；眨眼非必须
- [ ] 磁吸对准小按钮时有视觉反馈，system 模式可点中
- [ ] 日常场景页（资讯/购物/预约）至少一条免手流程可走完
- [ ] 无 Qwen Key 时 AI 本地路径仍可用
- [ ] 无外网时首页与 MediaPipe 本地模型仍可加载
- [ ] `scripts/smoke_test.py` 全部通过
- [ ] 文档与真实 API/版本一致

---

## 风险与后续路线图

| 风险 | 缓解 |
|------|------|
| MediaPipe jawOpen 在部分浏览器缺失 | 唇距回退；语音「点击」托底 |
| 系统鼠标 DPI/多显示器坐标偏差 | 验收清单记录；clamp + 磁吸为主 |
| 磁吸误吸邻近目标 | radius 可调 + 需短暂停留（dwell 80ms）再锁定 |
| 时间不够 | 可砍：matrix 头姿增强、外网部署叙事、场景 1 资讯页；**不可砍**张嘴+磁吸+安全默认+一条免手场景 |

**后续（决赛）:** 9 点校准、增益曲线、真实无障碍用户试用、更多日常站点适配、账号级设置同步。

---

## 实现状态（2026-09-18 会话）

- [x] Task 0 gitignore + README API Key 说明
- [x] Task 1 系统控制默认关 + health.system_control + smoke 403
- [x] Task 2 FaceTracker jawOpen + blendshapes
- [x] Task 3 TargetCollector + 磁吸 + geometry 纯函数
- [x] Task 4 张嘴点击接线 + console 设置
- [x] Task 5 系统鼠标：对准目标中心映射，失败降级
- [x] Task 6 日常任务台（资讯/购物/预约）+ demo 头控
- [x] Task 7 移除 index/console 外链 CDN script
- [x] Task 8 文档/验收清单/smoke 收口

冒烟证据：`venv\\Scripts\\python.exe scripts\\smoke_test.py` → 全部通过 ✓

---

## GSTACK REVIEW REPORT

| 维度 | 结论 |
|------|------|
| CEO/产品 | 主轴已改为「日常可用 + 精准可控」；磁吸+托底优于纯自由瞄准 |
| 设计 | P0 对准可感知、热区、文案张嘴化；避免花哨效果 |
| 工程 | 安全默认、契约测试、模块边界清晰；不推翻目录/端口 |
| 状态 | **DONE_WITH_CONCERNS** — 计划已写，等待用户确认后进入阶段 5 实现；真实 API Key 由用户填入 |

**确认点:** 回复「确认计划，开始实现」或指出要改的任务。

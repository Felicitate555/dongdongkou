# 动动口｜免手 AI 电脑助手

**转转头、动动嘴，也能与电脑交互。**

动动口为上肢行动不便或使用鼠标有困难的人探索更轻松的电脑操作方式：用摄像头追踪头部移动指针，张嘴点击或拖动，并可通过语音和 AI 助手获取帮助。

## 一眼了解

- **头部与口部交互**：转头移动指针，短张嘴点击，长张嘴拖动。
- **两种体验**：本机模式可选择控制本机系统；公网演示只操作网页自身。
- **AI 看屏与对话**：支持文字、语音交流和经用户选择的屏幕内容问答。
- **技术栈**：MediaPipe、FastAPI、Python、HTML/CSS/JavaScript。

项目演示：<https://dongdongko.fun/>。部分 AI 功能需要自行配置服务；实际可用性以部署状态为准。

---


动动口用头部动作移动光标，短促张嘴点击当前指针位置，并提供可选语音辅助。它有两种同等重要的体验：在自己的电脑上选择启用系统级控制；或通过公网网页体验只操作本页面的免手交互。

## 本机完整控制

需要 Windows 10/11、Python 3.11 和 Chrome/Edge。首次启动：

```bat
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python run.py
```

浏览器打开 <http://127.0.0.1:8787/console.html>。

- **网页头控**：点“开启摄像头”，自然平视约一秒取中。转头移动，短张嘴点击，长张嘴拖动，闭嘴松开。
- **控制其他软件**：点“后台控制电脑”，取中后可切到其他应用，本机服务独立运行。点助手旁“悬浮”可置顶显示摄像头与助手；全局 Esc、持续闭眼 1.2 秒或移动实体鼠标停止控制。服务关闭、电脑锁屏/休眠后不能继续使用。
- **口动助手**：全站可文字或语音对话，回复可朗读；说话和朗读期间暂停张嘴点击，闭嘴后再恢复。点击“看一下屏幕”，检查截图后发送，也可说“确认”。截图仅用于本次分析，不保存到数据库。
- **账号**：首页右上角可注册/登录，无需手机号。登录后保存文字对话，可清空；游客只在当前页面内存保留对话，不写数据库。本机与公网账号分别保存。

后台控制使用 Windows 本机摄像头线程，不依赖网页前后台计时器。悬浮窗需要支持 Document Picture-in-Picture 的 Chrome/Edge。公网截图通过浏览器选择要分享的窗口，不能读取 ECS 桌面。

兼容的前台系统输入 API 仍默认关闭，开发时可设置 `DDK_SYSTEM_CONTROL=1`；其网页 Esc 不是全局热键，前台系统控制失焦即停止。后台模式由用户在页面单独开启，不需要打开这组兼容接口。

## 公网网页体验

实际部署地址：**https://dongdongko.fun/**。2026-10-21 已完成 DNS、独立 Nginx 入口、TLS、页面资源和公网控制禁用检查，详见 `docs/deployment-2026-10-21.md`。

托管站只在访客浏览器中运行头部识别，并操作动动口网页本身。公网部署会从后端硬性关闭服务器鼠标和键盘 API，即使有人设置 `DDK_SYSTEM_CONTROL=1` 也不会打开。

### Aliyun / Docker 部署

项目已提供 Docker 构建文件、Compose 配置和 Nginx HTTPS 样例。先在 Aliyun ECS 准备 Docker、Docker Compose、Nginx、域名 DNS 记录与 TLS 证书，再在项目目录执行：

```bash
cp .env.example .env
# 编辑 .env，按需填入 QWEN_API_KEY
docker compose up -d --build
```

Compose 只把应用端口绑定到服务器本机 `127.0.0.1:8787`，由 Nginx 通过 HTTPS 转发。`deploy/nginx-dongdongkou.conf` 已按 `dongdongko.fun` 配置；签发证书后再启用 HTTPS 段。摄像头权限要求 HTTPS 或 `localhost`。

镜像使用 `requirements-public.txt`，只复制网页演示需要的依赖和静态模型；构建上下文会排除 `.env`、`server/local_secrets.py`、日志和虚拟环境。公网 MiMo 密钥只从服务器环境变量读取。不要把密钥填入 Dockerfile、Compose 文件或源码。

### 临时公网演示

可以用 Cloudflare Quick Tunnel 暂时分享页面。先用公网模式启动服务，再运行 `外网演示.bat`：

```bat
set DDK_DEPLOYMENT_MODE=public
set DDK_SYSTEM_CONTROL=0
python run.py
```

隧道脚本会检查 `/api/health`，服务不在 `public` 模式时拒绝建立隧道。公网模式无法同时控制运行服务的那台电脑；请使用另一份本机模式服务做系统级控制演示。

## 隐私与 AI 辅助

- 摄像头画面由浏览器里的 MediaPipe 本地处理，不上传视频。
- 首次使用“分析页面控件”时会先征求同意。发送的是当前页面可见控件的名称和位置图，不含摄像头画面或输入框填写值。
- 设置 `QWEN_API_KEY` 后，动动口服务把控件图转发给小米 MiMo 视觉模型；没有密钥或请求失败时退回本地 OpenCV 形状检测。后者只能找形状区域，不能理解控件语义。
- AI 请求在解析前有 5 MB 完整请求体限制和 1920×1080 像素解码上限；Nginx 按客户端地址限流，进程内另有限流与有界状态表。使用多 worker 或多台实例前，应把应用限流改为共享存储。
- 本机个人密钥可继续放在被 `.gitignore` 忽略的 `server/local_secrets.py`；该文件不会进入 Docker 镜像。长期部署请用服务器环境变量。

## 页面与 API

| 路径 | 内容 |
|------|------|
| `/` | 产品首页 |
| `/console.html` | 本机与公网模式入口、头控和设置 |
| `/demo.html` | 资讯、购物和预约的模拟任务流程 |
| `/architecture.html` | 两种运行模式与数据流说明 |

主要 API：

- `GET /api/health` — 运行模式、模型、系统控制状态。
- `POST /api/mouse/*`、`POST /api/keyboard/*` — 只在本机模式且明确开启后可用。
- `POST /api/ai_assist` — 处理经同意发送的控件结构图。

资讯、购物、预约均为模拟数据；页面不会创建真实订单、支付或医疗预约，也不宣称有天猫官方系统接入。

## 检查

```bat
.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.venv\Scripts\python.exe -m unittest discover -s tests
.venv\Scripts\python.exe scripts\smoke_test.py
node --test scripts\test_control_safety.mjs
node scripts\test_cursor_click.mjs
node scripts\test_ai_map.mjs
node scripts\test_geometry.mjs
```

`scripts/verify_public.py` 会检查部署页面、资源哈希和公网输入接口的 403。它不会操作真实鼠标、键盘、摄像头或麦克风。

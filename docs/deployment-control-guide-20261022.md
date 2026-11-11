# 控制助手部署 · 2026-10-22

当前发布 `20261022m`：https://dongdongko.fun/console.html?v=20261022m 。

- ECS 仍为 `i-j6c42vma0uxsr1sexe16`（47.76.71.36）。
- 目录 `/opt/dongdongko/releases/20261022m`，镜像 `dongdongkou:20261022m`，容器 `dongdongkou-public-20261022m`。
- 仅动动口 Nginx 上游由 8797 切到 `127.0.0.1:8798`；其他项目未修改。
- 在线上 l 版基础上添加控制引导、启动器及下载包；已有 HTML、CSS 文件的 SHA256 全部保持一致。新增样式只作用于控制引导弹窗。
- 公网“控制系统鼠标”打开使用引导，可朗读步骤、下载启动器或打开已启动的 localhost 工作台。
- Windows 启动器首次下载助手及安装依赖；需要 Python 3.11，缺少时引导用户安装。之后双击启动器直接打开本机工作台。用户仍需主动开启后台控制。
- 助手安装在 `%LOCALAPPDATA%\DongDongKo`，服务仅监听本机回环地址；下载包不含密钥、数据库、视频或虚拟环境。独立电脑的 AI 功能需要另行配置密钥。
- HTTPS 健康检查 200，公网系统控制为 false，后台启动接口 403；三个新增脚本下载字节与本地一致，助手 ZIP 下载返回 200（6,484,381 字节）。真实浏览器已点击并打开控制引导。
- 启动器通过 PowerShell 语法解析；尚未在全新 Windows 环境完成首次安装和摄像头验收。用户本人负责实际设备体验确认。
- 本次未修改已准备的比赛压缩包，未执行最终比赛提交。

回退：上一版容器 `dongdongkou-public-20261021l` 仍运行于 8797。将本发布目录的 `nginx.before.conf` 恢复到 `/etc/nginx/sites-available/dongdongkou`，运行 `nginx -t` 成功后重载 Nginx。数据库目录仍为 `/opt/dongdongko/data`。

本机根目录 `.venv` 已按用户要求移入回收站，旧文档中依赖该目录的运行命令不再适用。

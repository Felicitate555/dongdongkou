# 动动口部署记录 · 2026-10-21

> 以下是早先版本的历史记录。当前发布为 20261021g / 8792，后台控制及验收状态以 [最终交接记录](deployment-assistant-final-20261021.md) 为准。

- 站点：https://dongdongko.fun/；控制台 `/console.html`；任务演示 `/demo.html`。
- ECS：i-j6c42vma0uxsr1sexe16，中国香港，47.76.71.36，Ubuntu 22.04。
- 当前版本：`/opt/dongdongko/releases/20261021c`，镜像 `dongdongkou:20261021c`，容器 `dongdongkou-public-20261021c`。
- 应用端口：`127.0.0.1:8790` → 容器 8787；仅 Nginx 暴露 80/443。
- 环境：public，DDK_SYSTEM_CONTROL=0；后端即使误设为 1 也禁止公网系统输入。
- 模型密钥：仅在服务器受限的运行环境文件中；未进入源码、前端、发布包或日志。已用合成控件图验证公网返回 source=mimo、fallback=false，结果映射回原图像素。

## DNS 与证书

根域名 @ 的 A 记录为 47.76.71.36，TTL 600。此前该域名没有解析记录，本次只新增此记录；未配置 www。

Nginx：`/etc/nginx/sites-available/dongdongkou`，由同名 sites-enabled 链接启用。HTTP 跳转 HTTPS，ACME 路径保留用于续期。

Let's Encrypt 证书位于 `/etc/letsencrypt/live/dongdongko.fun/`，本次签发到期日 2027-01-19。certbot 使用现有账户和 webroot 工作流，部署重载钩子只匹配该域名。未修改其他域名证书或站点配置。

## 保留与回退

原容器 `dongdongkou-public` 仍运行于 127.0.0.1:8787；原发布目录 `/opt/dongdongko/releases/20260930` 保留。新增的中间验证容器停止并禁用自动重启，不删除镜像、卷或其他项目。

从当前站点回退到原版本：

```sh
curl -fsS http://127.0.0.1:8787/api/health
cp /etc/nginx/sites-available/dongdongkou /opt/dongdongko/releases/20261021c/nginx.before-rollback.conf
sed -i 's/127.0.0.1:8790/127.0.0.1:8787/g' /etc/nginx/sites-available/dongdongkou
nginx -t && systemctl reload nginx
```

其他既有站点：fanqie-cabin.xyz → 8000，shouhoutong.icu → 8820，jianwenjiuzhou.cloud → 8810。本次不更改其配置或容器。

## 验收与边界

本地 33 个 Python 测试、6 个 Node 安全行为测试及 smoke 检查通过。外网页面、关键资源哈希、TLS 主机名和证书有效性、公网输入接口 403 已核对。购物、预约模拟流程已通过浏览器操作验收。

未自动开启真实摄像头、麦克风或本机系统控制。实体鼠标接管、拖动释放、失焦与 Esc 的真实设备组合仍需人工验收；不声称实现了全局 Esc 急停。浏览器语音识别取决于浏览器、网络和权限，可回退按钮操作。

比赛截止时间由用户确认是 2026-10-21 23:59（Asia/Shanghai）。代理可读官方提交表单和活动须知，但初赛规则页被浏览器安全策略拦截，未独立核实截止时间。已填写已知作品文案；未勾选协议、未保存提交或最终提交。


## 控制台调整待体验

本地控制台已精简为左侧控制、右侧摄像头，移除顶部两块模式卡片。每次开启重新采样中心，保留速度式移动、短张嘴点击和长张嘴拖动。位置映射与眼距归一化方案因用户反馈速度过快、需要抬头定位而撤回；当前本地版本待用户重新体验，不声称漂移已解决。真实摄像头已在本地打开，模型加载正常，系统控制保持关闭。

ECS 已创建 20261021d 暂存目录，尚未上传补丁、构建或切换入口；线上仍为 20261021c。比赛作品包尚未包含这轮待确认修改。

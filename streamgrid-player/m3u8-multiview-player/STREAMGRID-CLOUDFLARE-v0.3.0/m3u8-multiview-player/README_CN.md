# STREAMGRID · Cloudflare 在线版（v0.3.0）

本版本用于部署到 Cloudflare Workers。手机、电脑和安卓电视浏览器访问同一个 HTTPS 网址；电视接收端为 `/receiver`。

## 功能

- 单画面 / 4画面 / 6画面 M3U8 播放。
- HLS.js 自适应码率；Safari/iOS 使用系统原生 HLS。
- 手机创建 6 位投屏码，电视浏览器打开同一网址的 `/receiver` 页面并输入配对码。
- 投屏会话使用 Cloudflare Durable Objects SQLite 保存，8 小时过期。
- 频道列表保存在当前设备浏览器 localStorage；如需在其他设备使用，请导入相同的 M3U 播放列表。

## Cloudflare 部署

1. 将本文件夹内容上传到 GitHub 仓库目录。
2. 在 Cloudflare Workers & Pages 中选择 Connect to Git，连接仓库。
3. Root Directory 设置为本文件夹所在路径。
4. Build command：`npm install`。
5. Deploy command：`npm run deploy`。
6. Wrangler 会读取 `wrangler.jsonc`，上传 `public/` 静态资源并创建 `SessionRoom` SQLite Durable Object。
7. 部署成功后打开 Cloudflare 分配的 `workers.dev` HTTPS 地址。

## 重要说明

- 本版本的投屏信令通过 Cloudflare 云端中转，不是传统的局域网屏幕镜像；手机和电视都需要能访问互联网。两台设备可以连接同一个 WiFi。电视直接请求 M3U8 源站视频，不经过播放器服务器转码。
- Workers Free 当前有每日请求与 Durable Objects 免费额度限制；接收端每 2 秒轮询一次会话，单台电视日常使用通常远低于每日 100,000 次请求，但实际用量以 Cloudflare 仪表盘为准。
- 4K 取决于源站是否提供 2160p、设备解码能力、浏览器及网络带宽。4 路/6 路同时播放 4K 会明显增加带宽、内存和硬件解码负担，不能保证所有设备不卡顿。
- M3U8 源需要允许浏览器跨域访问（CORS）；DRM、Referer/Cookie 限制、地区限制、过期签名等源可能无法播放。
- 免费实例/免费额度不是无限量服务；超过免费额度或 Cloudflare 政策变化时，服务可能受限。
- 频道链接保存在本机浏览器，不会自动同步到其他设备；请使用导入/导出 M3U 在设备间迁移。
- 只添加你有权访问和播放的内容。

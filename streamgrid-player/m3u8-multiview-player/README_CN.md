# STREAMGRID · M3U8 多画面播放器（可运行版本）

这是一个免数据库、免构建工具的跨平台网页播放器。电脑运行本地服务，手机、电脑和电视浏览器通过同一个局域网地址访问。

## 已实现

- 单画面 / 4画面 / 6画面布局
- 每路独立 M3U8 播放、暂停、静音、全屏与清晰度选择（清晰度选项取决于 HLS 主播放列表）
- HLS.js 自适应码率；Safari/iOS 使用系统原生 HLS
- 掉帧监测：检测到明显掉帧时临时降低自动码率上限，稳定后逐步恢复
- 手动添加频道、批量粘贴、导入/导出 M3U、频道收藏、搜索、删除
- 频道列表保存到运行播放器的电脑，并在同一局域网内的手机/电脑浏览器之间自动同步（本地浏览器同时保留备份）
- 局域网投屏：手机创建6位配对码，电视浏览器打开接收页并输入配对码；电视直接播放源站视频，手机负责控制频道与布局
- PWA 基础安装能力与静态资源缓存

## Windows 启动

1. 安装 Node.js 18 或更高版本：<https://nodejs.org/>
2. 解压项目文件夹。
3. 双击 `启动播放器.bat`。
4. 在电脑浏览器打开 `http://localhost:8787`。
5. 在手机浏览器打开命令窗口中显示的局域网地址，例如 `http://192.168.1.20:8787`。
6. 手机与电视连接同一个 WiFi。电视浏览器打开同一个地址后，在地址后加 `/receiver`，例如 `http://192.168.1.20:8787/receiver`。
7. 手机点击「局域网投屏」，电视输入手机显示的6位配对码。

首次启动时，Windows 防火墙可能询问是否允许 Node.js 通过专用网络通信，请允许专用网络访问。不要在公共 WiFi 中开放此服务。

## macOS / Linux 启动

在项目根目录执行：

```bash
node server.js
```

## 运行环境与限制

- 本项目服务端只用于托管页面和在局域网内同步投屏状态；视频流由每台播放设备直接向视频源请求，不会经过本机转码或中继。
- 4K 取决于源站是否提供 2160p、网络带宽、浏览器和硬件解码能力。4路/6路同时播放4K会明显增加带宽、内存、GPU/解码器负担，不能保证所有设备都无卡顿。
- HLS.js 需要视频源允许 CORS。部分链接有 Referer / Cookie / Token / IP 白名单、DRM、地区限制或短时签名时，可能无法在浏览器或电视端播放。
- iPhone Safari 使用原生 HLS；部分 iOS 浏览器策略会限制自动播放和后台播放。首次播放可能需要点按播放。
- 电视接收端是局域网网页接收模式，要求电视或电视盒子有可用浏览器并支持 HLS 或 Media Source Extensions。没有浏览器的电视需要另做 Android TV 原生接收应用。
- 当前投屏不是 Chromecast / AirPlay 原生协议，也不是手机屏幕镜像；它是同 WiFi 下的网页接收端直连视频源。Google Cast 原生支持需要注册 Cast Receiver App ID 并部署接收应用；iOS 浏览器不支持 Google Cast Web Sender。
- 投屏会话在服务进程内存中保存，服务关闭后会话失效；6位配对码有效期8小时。频道列表保存在运行服务的电脑 `data/channels.json`，同一局域网内共享；每个浏览器另有 localStorage 备份。
- HLS.js 播放核心通过 jsDelivr CDN 加载，首次使用需要设备能访问该 CDN；Safari/iOS 可在系统原生 HLS 支持范围内播放。
- 播放列表请只添加你有权访问和播放的内容。

## 项目结构

```text
m3u8-multiview-player/
├─ server.js                 # 局域网 HTTP 服务与投屏会话 API
├─ package.json
├─ 启动播放器.bat
├─ README_CN.md
├─ data/                    # 首次保存频道后自动生成 channels.json
└─ public/
   ├─ index.html             # 手机/电脑控制台
   ├─ receiver.html          # 电视接收端
   ├─ app.js                 # 播放列表、分屏与投屏控制
   ├─ receiver.js            # 电视端会话与播放逻辑
   ├─ player.js              # HLS 播放核心与自适应逻辑
   ├─ styles.css
   ├─ manifest.webmanifest
   └─ sw.js
```

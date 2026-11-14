(function () {
  const HLS_MIME = 'application/vnd.apple.mpegurl';
  function qualityLabel(level) {
    const h = Number(level.height || 0);
    if (h >= 2160) return '4K';
    if (h >= 1440) return '2K';
    if (h >= 1080) return '1080P';
    if (h >= 720) return '720P';
    if (h >= 480) return '480P';
    return h ? `${h}P` : `${Math.round((level.bitrate || 0) / 1000)}K`;
  }
  function createVideoPlayer(video, url, callbacks = {}) {
    let hls = null;
    let destroyed = false;
    let cap = -1;
    let stableTicks = 0;
    let lastDropped = 0;
    let lastTotal = 0;
    let monitor = null;
    const emit = (name, value) => { if (typeof callbacks[name] === 'function') callbacks[name](value); };
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.preload = 'auto';
    video.muted = Boolean(callbacks.muted);
    const status = text => emit('status', text);
    const levels = () => hls ? hls.levels.map((level, index) => ({ index, label: qualityLabel(level), height: level.height || 0, bitrate: level.bitrate || 0 })) : [];
    const onPlayError = error => { if (!destroyed) emit('playError', error && error.message ? error.message : '浏览器阻止自动播放，请点击播放'); };
    const play = () => video.play().catch(onPlayError);
    const onWaiting = () => status('缓冲中');
    const onPlaying = () => status('播放中');
    const onError = () => status('播放异常');
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('stalled', onWaiting);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('error', onError);

    if (window.Hls && Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 24,
        maxBufferLength: 18,
        maxMaxBufferLength: 36,
        capLevelToPlayerSize: false,
        startLevel: -1,
        abrEwmaDefaultEstimate: 3500000,
        abrBandWidthFactor: 0.8,
        abrBandWidthUpFactor: 0.7,
        maxBufferHole: 0.5,
        manifestLoadingTimeOut: 15000,
        fragLoadingTimeOut: 20000,
        manifestLoadingMaxRetry: 3,
        levelLoadingMaxRetry: 3,
        fragLoadingMaxRetry: 4
      });
      hls.attachMedia(video);
      hls.on(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(url));
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        emit('levels', levels());
        status('已就绪');
        play();
      });
      hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
        const level = hls.levels[data.level];
        if (level) emit('quality', { label: qualityLabel(level), height: level.height || 0, bitrate: level.bitrate || 0 });
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            status('网络重连');
            try { hls.startLoad(); } catch {}
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            status('解码恢复');
            try { hls.recoverMediaError(); } catch {}
          } else {
            status('播放异常');
            emit('fatal', data.details || data.type || '播放失败');
          }
        } else if (data.details === Hls.ErrorDetails.BUFFER_STALLED_ERROR) status('缓冲中');
      });
      monitor = setInterval(() => {
        if (destroyed || !hls || !hls.levels.length || video.paused || video.readyState < 2) return;
        let quality;
        try { quality = video.getVideoPlaybackQuality ? video.getVideoPlaybackQuality() : null; } catch {}
        if (!quality) return;
        const dropped = quality.droppedVideoFrames || 0;
        const total = quality.totalVideoFrames || 0;
        const d = dropped - lastDropped;
        const t = total - lastTotal;
        lastDropped = dropped; lastTotal = total;
        if (t < 30) return;
        const ratio = d / Math.max(1, d + t);
        if (ratio > 0.12) {
          stableTicks = 0;
          const currentCap = cap < 0 ? hls.levels.length - 1 : cap;
          if (currentCap > 0) {
            cap = currentCap - 1;
            hls.autoLevelCapping = cap;
            emit('adaptive', `检测到掉帧，临时限制至 ${qualityLabel(hls.levels[cap])}`);
          }
        } else if (ratio < 0.025) {
          stableTicks++;
          if (stableTicks >= 3 && cap >= 0 && cap < hls.levels.length - 1) {
            cap++;
            hls.autoLevelCapping = cap;
            stableTicks = 0;
            emit('adaptive', `设备状态稳定，恢复至 ${qualityLabel(hls.levels[cap])} 上限`);
          }
        } else stableTicks = 0;
      }, 9000);
    } else if (video.canPlayType(HLS_MIME) || video.canPlayType('application/x-mpegURL')) {
      video.src = url;
      video.addEventListener('loadedmetadata', () => { status('已就绪'); play(); }, { once: true });
      video.addEventListener('canplay', () => status('播放中'));
      emit('levels', []);
    } else {
      status('不支持HLS');
      emit('fatal', '当前浏览器不支持 HLS 播放，请更换 Chrome / Safari 或升级电视浏览器');
    }

    return {
      video,
      play,
      pause: () => video.pause(),
      setMuted: value => { video.muted = Boolean(value); },
      setQuality: index => { if (hls) { hls.currentLevel = Number(index); hls.autoLevelCapping = -1; cap = -1; } },
      getLevels: levels,
      destroy: () => {
        destroyed = true;
        if (monitor) clearInterval(monitor);
        video.removeEventListener('waiting', onWaiting);
        video.removeEventListener('stalled', onWaiting);
        video.removeEventListener('playing', onPlaying);
        video.removeEventListener('error', onError);
        if (hls) { try { hls.destroy(); } catch {} }
        video.pause();
        video.removeAttribute('src');
        video.load();
      }
    };
  }
  window.StreamGridPlayer = { createVideoPlayer, qualityLabel };
})();

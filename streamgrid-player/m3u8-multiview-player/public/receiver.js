(() => {
  const $ = id => document.getElementById(id);
  let code = null;
  let pollTimer = null;
  let lastUpdated = 0;
  let currentLayout = 0;
  let currentSlots = [];
  let players = new Map();
  function status(text, bad = false) {
    $('receiverStatus').innerHTML = `<i style="background:${bad ? '#ff687b' : '#39d69b'}"></i> ${text}`;
  }
  function esc(value) { return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }
  function destroyPlayers() { for (const player of players.values()) player.destroy(); players.clear(); }
  function renderState(state) {
    const nextLayout = [1, 4, 6].includes(Number(state.layout)) ? Number(state.layout) : 1;
    const nextSlots = Array.isArray(state.slots) ? state.slots.slice(0, nextLayout) : [];
    const layoutChanged = nextLayout !== currentLayout;
    if (layoutChanged) {
      destroyPlayers(); currentLayout = nextLayout;
      $('receiverGrid').className = `video-grid grid-${currentLayout}`;
      $('receiverGrid').innerHTML = Array.from({ length: currentLayout }, (_, index) => `<article class="video-card" data-tv-slot="${index}"><video id="tv-video-${index}" playsinline webkit-playsinline muted></video><div class="video-top"><span class="slot-name" id="tv-name-${index}">等待频道</span><span class="slot-status"><i></i><span id="tv-status-${index}">待机</span></span></div><div class="video-empty" id="tv-empty-${index}"><div class="empty-plus">＋</div><b>等待手机发送视频</b></div></article>`).join('');
    }
    for (let i = 0; i < currentLayout; i++) {
      const item = nextSlots[i] || null;
      const old = currentSlots[i] || null;
      const video = $(`tv-video-${i}`);
      const name = $(`tv-name-${i}`);
      const empty = $(`tv-empty-${i}`);
      const stateLabel = $(`tv-status-${i}`);
      if (!item || !item.url) {
        if (players.has(i)) { players.get(i).destroy(); players.delete(i); }
        if (name) name.textContent = `画面 ${i + 1}`;
        if (empty) empty.hidden = false;
        if (stateLabel) stateLabel.textContent = '待机';
        continue;
      }
      if (name) name.textContent = item.name || `频道 ${i + 1}`;
      if (empty) empty.hidden = true;
      if (old && old.url === item.url && players.has(i)) {
        players.get(i).setMuted(item.muted !== false);
      } else {
        if (players.has(i)) players.get(i).destroy();
        if (stateLabel) stateLabel.textContent = '连接中';
        const player = StreamGridPlayer.createVideoPlayer(video, item.url, {
          muted: item.muted !== false,
          status: text => { if (stateLabel) stateLabel.textContent = text; },
          fatal: message => { if (stateLabel) stateLabel.textContent = '播放异常'; console.warn('Receiver playback error:', message); }
        });
        players.set(i, player);
      }
    }
    currentSlots = nextSlots;
    $('receiverHint').textContent = `${currentLayout}路画面 · 手机端可切换频道与布局`;
  }
  async function fetchSession() {
    if (!code) return;
    try {
      const response = await fetch(`/api/session/${code}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('投屏码无效或已过期');
      const data = await response.json();
      if (data.updatedAt !== lastUpdated) {
        lastUpdated = data.updatedAt;
        renderState(data.state || {});
      }
      status('已连接手机');
    } catch (error) {
      status('连接已断开', true);
      $('receiverHint').textContent = error.message;
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null; destroyPlayers();
      $('receiverView').hidden = true; $('pairPanel').hidden = false;
    }
  }
  async function connect(value) {
    const normalized = String(value || '').replace(/\D/g, '').slice(0, 6);
    if (normalized.length !== 6) { status('请输入6位配对码', true); return; }
    code = normalized; lastUpdated = 0;
    try {
      const response = await fetch(`/api/session/${code}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('投屏码不存在或已过期');
      const data = await response.json();
      $('pairPanel').hidden = true; $('receiverView').hidden = false;
      $('receiverCode').textContent = `配对码 ${code}`;
      status('已连接手机');
      lastUpdated = data.updatedAt;
      renderState(data.state || {});
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = setInterval(fetchSession, 1300);
    } catch (error) {
      code = null; status(error.message, true); alert(error.message);
    }
  }
  function disconnect() {
    code = null; if (pollTimer) clearInterval(pollTimer); pollTimer = null; destroyPlayers();
    currentLayout = 0; currentSlots = []; lastUpdated = 0;
    $('receiverView').hidden = true; $('pairPanel').hidden = false; $('pairInput').value = '';
    status('等待连接');
  }
  $('pairForm').addEventListener('submit', event => { event.preventDefault(); connect($('pairInput').value); });
  $('receiverDisconnect').addEventListener('click', disconnect);
  $('receiverFullscreen').addEventListener('click', () => {
    const target = $('receiverView');
    if (document.fullscreenElement) document.exitFullscreen?.();
    else target.requestFullscreen?.().catch(() => {});
  });
  const params = new URLSearchParams(location.search);
  const initialCode = params.get('code');
  if (initialCode) { $('pairInput').value = initialCode; connect(initialCode); }
})();

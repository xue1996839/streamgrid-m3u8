(() => {
  const $ = id => document.getElementById(id);
  const STORAGE_KEY = 'streamgrid.channels.v1';
  const LAYOUT_KEY = 'streamgrid.layout.v1';
  let channels = loadChannels();
  let layout = Number(localStorage.getItem(LAYOUT_KEY)) || 4;
  if (![1, 4, 6].includes(layout)) layout = 4;
  let slots = Array.from({ length: 6 }, () => ({ channelId: '', muted: true }));
  let players = new Map();
  let castCode = null;
  let castBaseUrl = '';
  let toastTimer = null;
  let installPrompt = null;

  function loadChannels() {
    try { const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); return Array.isArray(data) ? data : []; }
    catch { return []; }
  }
  function saveChannels() {
    // Cloud edition keeps each device's playlist private in its own browser storage.
    localStorage.setItem(STORAGE_KEY, JSON.stringify(channels)); updateCounts();
  }
  function esc(value) { return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }
  function notify(message) {
    const node = $('toast'); node.textContent = message; node.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => node.classList.remove('show'), 2600);
  }
  function updateCounts() {
    $('channelCount').textContent = channels.length;
    $('listCount').textContent = `${channels.length} 个`;
    $('playingCount').textContent = [...players.values()].filter(item => item.video && !item.video.paused && !item.video.ended).length;
    $('layoutLabel').textContent = `${layout}路`;
  }
  function getChannel(id) { return channels.find(item => item.id === id); }
  function slotOptions(selected) {
    return `<option value="">选择频道…</option>${channels.map(item => `<option value="${esc(item.id)}" ${item.id === selected ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}`;
  }
  function statusForCard(index, text) {
    const card = document.querySelector(`[data-slot="${index}"]`);
    if (!card) return;
    card.classList.remove('is-playing', 'is-buffering', 'is-error');
    if (text === '播放中') card.classList.add('is-playing');
    else if (/缓冲|连接|重连|恢复/.test(text)) card.classList.add('is-buffering');
    else if (/异常|失败|不支持/.test(text)) card.classList.add('is-error');
    const label = card.querySelector('.slot-status span'); if (label) label.textContent = text;
    updateCounts();
  }
  function renderGrid() {
    for (const player of players.values()) player.destroy();
    players.clear();
    const grid = $('videoGrid');
    grid.className = `video-grid grid-${layout}`;
    grid.innerHTML = Array.from({ length: layout }, (_, index) => {
      const channel = getChannel(slots[index].channelId);
      const title = channel ? channel.name : `画面 ${String(index + 1).padStart(2, '0')}`;
      return `<article class="video-card" data-slot="${index}">
        <video id="video-${index}" playsinline webkit-playsinline muted></video>
        <div class="video-top"><span class="slot-name">${esc(title)}</span><span class="slot-status"><i></i><span>${channel ? '连接中' : '待添加'}</span></span></div>
        <div class="video-bitrate" id="bitrate-${index}">AUTO</div>
        <div class="video-empty" ${channel ? 'hidden' : ''}><div class="empty-plus">＋</div><b>添加播放源</b><span>从下方频道列表选择</span></div>
        <div class="video-controls"><select class="slot-select" data-select-slot="${index}" aria-label="选择频道">${slotOptions(slots[index].channelId)}</select>
          <button class="mini-btn" data-action="play" data-index="${index}" title="播放/暂停">▶</button>
          <button class="mini-btn" data-action="mute" data-index="${index}" title="静音/取消静音">◖</button>
          <select class="quality-select" data-quality-slot="${index}" aria-label="清晰度"><option value="-1">自动</option></select>
          <button class="mini-btn" data-action="full" data-index="${index}" title="全屏">⛶</button></div>
      </article>`;
    }).join('');
    grid.querySelectorAll('[data-select-slot]').forEach(select => select.addEventListener('change', () => assignSlot(Number(select.dataset.selectSlot), select.value)));
    grid.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => handleSlotAction(button.dataset.action, Number(button.dataset.index))));
    grid.querySelectorAll('[data-quality-slot]').forEach(select => select.addEventListener('change', () => players.get(Number(select.dataset.qualitySlot))?.setQuality(Number(select.value))));
    for (let i = 0; i < layout; i++) if (slots[i].channelId) startSlot(i);
    document.querySelectorAll('.layout-btn').forEach(button => button.classList.toggle('active', Number(button.dataset.layout) === layout));
    updateCounts();
    pushCastState();
  }
  function startSlot(index) {
    const channel = getChannel(slots[index].channelId);
    if (!channel) return;
    const video = $(`video-${index}`);
    const card = document.querySelector(`[data-slot="${index}"]`);
    if (!video || !card) return;
    const empty = card.querySelector('.video-empty'); if (empty) empty.hidden = true;
    const title = card.querySelector('.slot-name'); if (title) title.textContent = channel.name;
    statusForCard(index, '连接中');
    const player = StreamGridPlayer.createVideoPlayer(video, channel.url, {
      muted: slots[index].muted,
      status: text => statusForCard(index, text),
      levels: levels => {
        const select = card.querySelector('[data-quality-slot]');
        if (!select) return;
        select.innerHTML = '<option value="-1">自动</option>' + levels.map(level => `<option value="${level.index}">${level.label}</option>`).join('');
      },
      quality: info => {
        const badge = $(`bitrate-${index}`); if (badge) badge.textContent = info.label;
      },
      adaptive: message => { const badge = $(`bitrate-${index}`); if (badge) badge.title = message; },
      fatal: message => { statusForCard(index, '播放异常'); notify(`${channel.name}：${message}`); },
      playError: message => notify(message)
    });
    players.set(index, player);
    const muteBtn = card.querySelector('[data-action="mute"]'); if (muteBtn) muteBtn.textContent = slots[index].muted ? '◖' : '◗';
  }
  function refreshSlotSelectors() {
    document.querySelectorAll('[data-select-slot]').forEach(select => {
      const index = Number(select.dataset.selectSlot);
      select.innerHTML = slotOptions(slots[index]?.channelId || '');
    });
  }
  function assignSlot(index, channelId) {
    if (index >= 6) return;
    slots[index].channelId = channelId;
    const oldPlayer = players.get(index);
    if (oldPlayer) oldPlayer.destroy();
    players.delete(index);
    const card = document.querySelector(`[data-slot="${index}"]`);
    if (card) {
      const select = card.querySelector('[data-select-slot]');
      if (select) select.innerHTML = slotOptions(channelId);
      const channel = getChannel(channelId);
      const title = card.querySelector('.slot-name');
      const empty = card.querySelector('.video-empty');
      if (channel) {
        if (title) title.textContent = channel.name;
        if (empty) empty.hidden = true;
        startSlot(index);
      } else {
        if (title) title.textContent = `画面 ${String(index + 1).padStart(2, '0')}`;
        if (empty) empty.hidden = false;
        const video = $(`video-${index}`); if (video) { video.pause(); video.removeAttribute('src'); video.load(); }
        const bitrate = $(`bitrate-${index}`); if (bitrate) bitrate.textContent = 'AUTO';
        statusForCard(index, '待添加');
      }
    }
    refreshSlotSelectors();
    updateCounts();
    pushCastState();
  }
  function handleSlotAction(action, index) {
    const player = players.get(index);
    if (action === 'play') {
      if (!player) { const channel = getChannel(slots[index].channelId); if (channel) startSlot(index); else notify('请先为该画面选择频道'); return; }
      if (player.video.paused) player.play(); else player.pause();
      updateCounts();
    } else if (action === 'mute') {
      slots[index].muted = !slots[index].muted;
      player?.setMuted(slots[index].muted);
      const button = document.querySelector(`[data-action="mute"][data-index="${index}"]`); if (button) button.textContent = slots[index].muted ? '◖' : '◗';
      pushCastState();
    } else if (action === 'full') {
      const card = document.querySelector(`[data-slot="${index}"]`);
      if (card?.requestFullscreen) card.requestFullscreen().catch(() => notify('当前浏览器不支持全屏'));
    }
  }
  function renderChannelList() {
    const q = $('searchInput').value.trim().toLowerCase();
    const filtered = channels.filter(item => `${item.name} ${item.url}`.toLowerCase().includes(q));
    const list = $('channelList');
    if (!filtered.length) { list.innerHTML = `<div class="empty-list">${channels.length ? '没有找到匹配的频道' : '还没有频道，先添加一个 M3U8 地址'}</div>`; return; }
    list.innerHTML = filtered.map((item, index) => `<div class="channel-item"><span class="channel-number">${String(index + 1).padStart(2, '0')}</span><div class="channel-meta"><b>${esc(item.name)}</b><small>${esc(item.url)}</small></div><div class="channel-actions"><button data-channel-action="play" data-id="${esc(item.id)}" title="加入播放墙">▶</button><button data-channel-action="fav" data-id="${esc(item.id)}" title="收藏">${item.favorite ? '★' : '☆'}</button><button data-channel-action="delete" data-id="${esc(item.id)}" title="删除">×</button></div></div>`).join('');
    list.querySelectorAll('[data-channel-action]').forEach(button => button.addEventListener('click', () => {
      const id = button.dataset.id; const action = button.dataset.channelAction;
      if (action === 'play') {
        let index = slots.slice(0, layout).findIndex(slot => !slot.channelId);
        if (index < 0) index = 0;
        assignSlot(index, id); notify(`${getChannel(id)?.name || '频道'} 已加入画面 ${index + 1}`);
      } else if (action === 'fav') {
        const item = getChannel(id); if (item) item.favorite = !item.favorite;
        saveChannels(); renderChannelList();
      } else if (action === 'delete') {
        channels = channels.filter(item => item.id !== id);
        saveChannels();
        for (let slotIndex = 0; slotIndex < slots.length; slotIndex++) if (slots[slotIndex].channelId === id) assignSlot(slotIndex, '');
        renderChannelList(); refreshSlotSelectors();
      }
    }));
  }
  function addChannel(name, url) {
    const cleanUrl = url.trim();
    if (!/^https?:\/\//i.test(cleanUrl)) { notify('请输入以 http:// 或 https:// 开头的有效地址'); return false; }
    if (channels.some(item => item.url === cleanUrl)) { notify('该播放地址已经存在'); return false; }
    const item = { id: cryptoId(), name: (name || `频道 ${String(channels.length + 1).padStart(2, '0')}`).trim(), url: cleanUrl, favorite: false };
    channels.push(item); saveChannels(); renderChannelList(); refreshSlotSelectors();
    const empty = slots.slice(0, layout).findIndex(slot => !slot.channelId);
    if (empty >= 0) assignSlot(empty, item.id);
    notify('频道已添加');
    return true;
  }
  function cryptoId() { return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`; }
  function parseM3U(text) {
    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const result = []; let name = '';
    for (const line of lines) {
      if (line.startsWith('#EXTINF')) {
        const comma = line.lastIndexOf(',');
        name = comma >= 0 ? line.slice(comma + 1).trim() : (line.match(/tvg-name="([^"]+)"/) || [])[1] || '';
      } else if (!line.startsWith('#') && /^https?:\/\//i.test(line)) {
        result.push({ name: name || `频道 ${result.length + 1}`, url: line }); name = '';
      }
    }
    return result;
  }
  function parseBulk(text) {
    const parsed = parseM3U(text);
    if (parsed.length) return parsed;
    return text.split(/\r?\n/).map(line => line.trim()).filter(line => /^https?:\/\//i.test(line)).map((url, index) => ({ name: `频道 ${index + 1}`, url }));
  }
  async function pushCastState() {
    if (!castCode) return;
    const state = { layout, slots: slots.slice(0, layout).map(slot => { const channel = getChannel(slot.channelId); return channel ? { name: channel.name, url: channel.url, muted: slot.muted } : null; }) };
    try { await fetch(`/api/session/${castCode}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state }) }); }
    catch { $('castStatus').textContent = '云端连接中断，电视可能暂时无法接收更新'; }
  }
  async function startCast() {
    try {
      castBaseUrl = `${location.origin}/receiver`;
      const state = { layout, slots: slots.slice(0, layout).map(slot => { const channel = getChannel(slot.channelId); return channel ? { name: channel.name, url: channel.url, muted: slot.muted } : null; }) };
      const result = await fetch('/api/session/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state }) }).then(response => response.json());
      if (!result.code) throw new Error(result.error || '无法创建投屏会话');
      castCode = result.code;
      $('castAddress').textContent = castBaseUrl;
      $('pairCode').textContent = castCode;
      $('castStatus').textContent = '等待电视输入配对码…（会话有效8小时）';
      $('castDialog').showModal();
      notify('投屏会话已创建，请在电视端输入配对码');
    } catch (error) { notify(`创建投屏失败：${error.message}`); }
  }
  async function stopCast() {
    if (castCode) { try { await fetch(`/api/session/${castCode}`, { method: 'DELETE' }); } catch {} }
    castCode = null; $('pairCode').textContent = '------'; $('castStatus').textContent = '投屏已断开'; $('castDialog').close(); notify('已断开投屏');
  }
  function downloadText(filename, text, type) {
    const blob = new Blob([text], { type }); const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
  }
  function init() {
    $('addForm').addEventListener('submit', event => { event.preventDefault(); if (addChannel($('channelName').value, $('channelUrl').value)) { $('channelName').value = ''; $('channelUrl').value = ''; } });
    document.querySelectorAll('.layout-btn').forEach(button => button.addEventListener('click', () => {
      layout = Number(button.dataset.layout); localStorage.setItem(LAYOUT_KEY, String(layout)); renderGrid();
    }));
    $('playAllBtn').addEventListener('click', () => { for (const player of players.values()) player.play(); updateCounts(); });
    $('pauseAllBtn').addEventListener('click', () => { for (const player of players.values()) player.pause(); updateCounts(); });
    $('clearSlotsBtn').addEventListener('click', () => { slots = Array.from({ length: 6 }, () => ({ channelId: '', muted: true })); renderGrid(); });
    $('pasteBtn').addEventListener('click', () => $('pasteDialog').showModal());
    $('bulkAddBtn').addEventListener('click', () => {
      const items = parseBulk($('bulkText').value); let added = 0;
      for (const item of items) if (addChannel(item.name, item.url)) added++;
      $('pasteDialog').close(); $('bulkText').value = ''; notify(`批量导入完成：新增 ${added} 个频道`);
    });
    $('m3uFile').addEventListener('change', async event => {
      const file = event.target.files[0]; if (!file) return;
      const items = parseM3U(await file.text()); let added = 0;
      for (const item of items) if (addChannel(item.name, item.url)) added++;
      notify(`M3U 导入完成：新增 ${added} 个频道`); event.target.value = '';
    });
    $('exportBtn').addEventListener('click', () => {
      const content = ['#EXTM3U', ...channels.flatMap(item => [`#EXTINF:-1,${item.name}`, item.url])].join('\n');
      downloadText('streamgrid-playlist.m3u', content, 'audio/x-mpegurl');
    });
    $('searchInput').addEventListener('input', renderChannelList);
    $('clearListBtn').addEventListener('click', () => {
      if (!channels.length || !confirm('确定清空全部频道列表吗？')) return;
      channels = []; slots = Array.from({ length: 6 }, () => ({ channelId: '', muted: true })); saveChannels(); renderChannelList(); renderGrid();
    });
    $('castBtn').addEventListener('click', startCast);
    $('stopCastBtn').addEventListener('click', stopCast);
    $('copyAddressBtn').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText($('castAddress').textContent); notify('电视访问地址已复制'); }
      catch { notify('复制失败，请手动选择地址'); }
    });
    document.querySelectorAll('.close-dialog').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
    window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; $('installBtn').hidden = false; });
    $('installBtn').addEventListener('click', async () => { if (installPrompt) { installPrompt.prompt(); installPrompt = null; $('installBtn').hidden = true; } });
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('/sw.js').catch(() => {});
    renderChannelList(); renderGrid();
    fetch('/api/info').then(response => response.json()).then(() => { $('serverStatus').textContent = '云端服务 · 已连接'; }).catch(() => { $('serverStatus').textContent = '服务连接中'; });
  }
  init();
})();

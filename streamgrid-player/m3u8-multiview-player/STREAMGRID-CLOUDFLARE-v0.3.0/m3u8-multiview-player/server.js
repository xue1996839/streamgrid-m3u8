'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const ROOT = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const CHANNELS_FILE = path.join(DATA_DIR, 'channels.json');
const PORT = Number(process.env.PORT || 8787);
const sessions = new Map();
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon'
};

function lanAddresses() {
  const found = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const item of entries || []) {
      if (item && item.family === 'IPv4' && !item.internal) found.push(item.address);
    }
  }
  return [...new Set(found)];
}
function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; if (raw.length > 2 * 1024 * 1024) { reject(new Error('请求内容过大')); req.destroy(); } });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch { reject(new Error('JSON格式无效')); }
    });
    req.on('error', reject);
  });
}
function makeCode() {
  let code;
  do { code = String(crypto.randomInt(100000, 1000000)); } while (sessions.has(code));
  return code;
}
function readChannels() {
  try {
    const parsed = JSON.parse(fs.readFileSync(CHANNELS_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}
function writeChannels(channels) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temp = CHANNELS_FILE + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(channels, null, 2), 'utf8');
  fs.renameSync(temp, CHANNELS_FILE);
}
function cleanExpired() {
  const now = Date.now();
  for (const [code, session] of sessions) if (session.expiresAt < now) sessions.delete(code);
}
function serveFile(req, res, pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return json(res, 400, { error: '路径无效' }); }
  const relative = decoded === '/' ? 'index.html' : (decoded === '/receiver' || decoded === '/receiver/') ? 'receiver.html' : decoded.replace(/^\/+/, '');
  const file = path.resolve(ROOT, relative);
  if (!file.startsWith(ROOT + path.sep) && file !== path.join(ROOT, 'index.html')) return json(res, 403, { error: '禁止访问' });
  fs.readFile(file, (err, data) => {
    if (err) return json(res, 404, { error: '文件不存在' });
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin'
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  if (req.method === 'GET' && pathname === '/api/channels') {
    return json(res, 200, { channels: readChannels() });
  }
  if (req.method === 'POST' && pathname === '/api/channels') {
    try {
      const body = await readBody(req);
      if (!Array.isArray(body.channels) || body.channels.length > 5000) return json(res, 400, { error: '频道列表格式无效' });
      const channels = body.channels.map((item, index) => ({
        id: String(item.id || `channel-${index + 1}`).slice(0, 100),
        name: String(item.name || `频道 ${index + 1}`).slice(0, 80),
        url: String(item.url || '').slice(0, 4096),
        favorite: Boolean(item.favorite)
      })).filter(item => /^https?:\/\//i.test(item.url));
      writeChannels(channels);
      return json(res, 200, { ok: true, count: channels.length });
    } catch (error) { return json(res, 400, { error: error.message }); }
  }
  if (req.method === 'GET' && pathname === '/api/info') {
    const ips = lanAddresses();
    return json(res, 200, { port: PORT, addresses: ips, urls: ips.map(ip => `http://${ip}:${PORT}`), host: os.hostname() });
  }
  if (req.method === 'POST' && pathname === '/api/session/create') {
    try {
      const body = await readBody(req);
      const code = makeCode();
      const session = { code, state: body.state || { layout: 1, slots: [] }, createdAt: Date.now(), updatedAt: Date.now(), expiresAt: Date.now() + 8 * 60 * 60 * 1000 };
      sessions.set(code, session);
      return json(res, 201, { code, expiresAt: session.expiresAt });
    } catch (error) { return json(res, 400, { error: error.message }); }
  }
  const match = pathname.match(/^\/api\/session\/(\d{6})$/);
  if (match) {
    cleanExpired();
    const session = sessions.get(match[1]);
    if (!session) return json(res, 404, { error: '投屏码不存在或已过期，请重新连接' });
    if (req.method === 'GET') return json(res, 200, { state: session.state, updatedAt: session.updatedAt, expiresAt: session.expiresAt });
    if (req.method === 'POST') {
      try {
        const body = await readBody(req);
        session.state = body.state || body;
        session.updatedAt = Date.now();
        return json(res, 200, { ok: true, updatedAt: session.updatedAt });
      } catch (error) { return json(res, 400, { error: error.message }); }
    }
    if (req.method === 'DELETE') { sessions.delete(match[1]); return json(res, 200, { ok: true }); }
  }
  if (pathname.startsWith('/api/')) return json(res, 404, { error: 'API不存在' });
  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: '方法不支持' });
  return serveFile(req, res, pathname);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('\nM3U8 多画面播放器已启动');
  console.log(`本机访问: http://localhost:${PORT}`);
  for (const ip of lanAddresses()) console.log(`局域网访问: http://${ip}:${PORT}`);
  console.log('按 Ctrl+C 关闭服务\n');
});

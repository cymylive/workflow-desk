'use strict';

/**
 * 工作流工具台 - 后端服务
 * 纯 Node.js 原生实现，零第三方依赖。
 * 启动后监听 0.0.0.0，同一局域网内的手机可直接访问。
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 8317;
const HOST = process.env.HOST || '0.0.0.0';

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'workflows.json');
const BACKUP_DIR = path.join(ROOT, 'backups');
const MAX_BACKUPS = 50;
const MAX_BODY = 32 * 1024 * 1024;

/* ---------------- 基础工具 ---------------- */

function ensureDirs() {
  [DATA_DIR, BACKUP_DIR, PUBLIC_DIR].forEach(function (d) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
}

function uid() {
  return crypto.randomBytes(8).toString('hex');
}

function nowIso() {
  return new Date().toISOString();
}

function lanIPs() {
  const out = [];
  const ifaces = os.networkInterfaces();
  Object.keys(ifaces).forEach(function (name) {
    (ifaces[name] || []).forEach(function (info) {
      if (info.family === 'IPv4' && !info.internal) out.push(info.address);
    });
  });
  return out;
}

/* ---------------- 数据层 ---------------- */

function defaultState() {
  return {
    schema: 'workflow-desk',
    version: 1,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    workflows: []
  };
}

function demoState() {
  const t = nowIso();
  const mk = function (title, desc, note, status) {
    return { id: uid(), title: title, desc: desc, note: note, status: status };
  };
  return {
    schema: 'workflow-desk',
    version: 1,
    createdAt: t,
    updatedAt: t,
    workflows: [
      {
        id: uid(),
        name: '让生活幸福的工作流',
        version: '1.0.0',
        goal: '每天执行固定的小环节，稳定提升身体、情绪、关系三个维度的满意度，让幸福感可被观察、可被迭代。',
        status: 'developing',
        tags: ['生活', '幸福感', '习惯'],
        createdAt: t,
        updatedAt: t,
        steps: [
          mk('晨间启动', '起床后 10 分钟固定动作：喝水、拉伸、写下今天最重要的一件事。', '不要一睁眼就看手机，把最初的注意力留给自己。', 'done'),
          mk('身体充电', '20 分钟运动或快走，心率微升即可。', '下雨天改成室内拉伸，不中断链条。', 'doing'),
          mk('深度工作块', '90 分钟无干扰专注，手机静音放到另一个房间。', '用番茄钟 25+5 循环三轮。', 'pending'),
          mk('关系连接', '主动联系 1 位在意的人，聊 5 分钟以上。', '不要只发微信表情，打电话或见面效果更好。', 'pending'),
          mk('晚间复盘', '记录 3 件今天的好事 + 1 个明天想改进的点。', '写在固定本子上，形成可回看的连续记录。', 'pending')
        ]
      }
    ]
  };
}

function loadState() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      ensureDirs();
      const s = demoState();
      fs.writeFileSync(DATA_FILE, JSON.stringify(s, null, 2), 'utf8');
      return s;
    }
    const obj = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!obj || typeof obj !== 'object' || !Array.isArray(obj.workflows)) return defaultState();
    return obj;
  } catch (e) {
    console.error('[warn] 数据文件解析失败，改用空状态：' + e.message);
    return defaultState();
  }
}

function pruneBackups() {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(function (f) { return f.endsWith('.json'); })
      .sort();
    while (files.length > MAX_BACKUPS) {
      const f = files.shift();
      try { fs.unlinkSync(path.join(BACKUP_DIR, f)); } catch (e) {}
    }
  } catch (e) {}
}

function saveState(state) {
  ensureDirs();
  state.updatedAt = nowIso();
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  if (fs.existsSync(DATA_FILE)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    try {
      fs.copyFileSync(DATA_FILE, path.join(BACKUP_DIR, 'workflows-' + stamp + '.json'));
    } catch (e) {}
    pruneBackups();
  }
  fs.renameSync(tmp, DATA_FILE);
}

/* ---------------- HTTP 辅助 ---------------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json'
};

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function sendText(res, code, text) {
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function readBody(req, limit) {
  return new Promise(function (resolve, reject) {
    let size = 0;
    const chunks = [];
    req.on('data', function (c) {
      size += c.length;
      if (size > limit) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', function () { resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', reject);
  });
}

/* ---------------- API 路由 ---------------- */

async function handleApi(req, res, pathname, query) {
  const method = req.method.toUpperCase();

  if (pathname === '/api/health' && method === 'GET') {
    return sendJson(res, 200, {
      ok: true,
      name: 'workflow-desk',
      time: nowIso(),
      ips: lanIPs(),
      port: PORT
    });
  }

  if (pathname === '/api/state' && method === 'GET') {
    return sendJson(res, 200, loadState());
  }

  if (pathname === '/api/state' && method === 'PUT') {
    const raw = await readBody(req, MAX_BODY);
    let obj;
    try { obj = JSON.parse(raw); } catch (e) { return sendJson(res, 400, { error: 'JSON 解析失败' }); }
    if (!obj || !Array.isArray(obj.workflows)) return sendJson(res, 400, { error: '数据结构不合法：缺少 workflows 数组' });
    saveState(obj);
    return sendJson(res, 200, { ok: true, updatedAt: obj.updatedAt });
  }

  if (pathname === '/api/export' && method === 'GET') {
    const s = loadState();
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const body = JSON.stringify(s, null, 2);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="workflow-backup-' + stamp + '.json"',
      'Content-Length': Buffer.byteLength(body)
    });
    return res.end(body);
  }

  if (pathname === '/api/import' && method === 'POST') {
    const raw = await readBody(req, MAX_BODY);
    let obj;
    try { obj = JSON.parse(raw); } catch (e) { return sendJson(res, 400, { error: 'JSON 解析失败' }); }
    if (!obj || !Array.isArray(obj.workflows)) return sendJson(res, 400, { error: '不是有效的备份文件：缺少 workflows 数组' });
    if (!obj.schema) obj.schema = 'workflow-desk';
    if (!obj.createdAt) obj.createdAt = nowIso();
    saveState(obj);
    return sendJson(res, 200, { ok: true, count: obj.workflows.length });
  }

  if (pathname === '/api/backups' && method === 'GET') {
    ensureDirs();
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(function (f) { return f.endsWith('.json'); })
      .sort()
      .reverse()
      .slice(0, 50)
      .map(function (f) {
        let size = 0;
        try { size = fs.statSync(path.join(BACKUP_DIR, f)).size; } catch (e) {}
        return { file: f, size: size };
      });
    return sendJson(res, 200, { backups: files });
  }

  if (pathname === '/api/backups/restore' && method === 'POST') {
    const raw = await readBody(req, 1024 * 1024);
    let obj;
    try { obj = JSON.parse(raw); } catch (e) { return sendJson(res, 400, { error: 'JSON 解析失败' }); }
    const name = String(obj.file || '');
    if (!/^[A-Za-z0-9._-]+.json$/.test(name)) return sendJson(res, 400, { error: '文件名不合法' });
    const full = path.join(BACKUP_DIR, name);
    if (!fs.existsSync(full)) return sendJson(res, 404, { error: '备份不存在' });
    let data;
    try { data = JSON.parse(fs.readFileSync(full, 'utf8')); } catch (e) { return sendJson(res, 400, { error: '备份内容损坏' }); }
    if (!data || !Array.isArray(data.workflows)) return sendJson(res, 400, { error: '备份结构不合法' });
    saveState(data);
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === '/api/reset' && method === 'POST') {
    const s = defaultState();
    saveState(s);
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 404, { error: '接口不存在: ' + pathname });
}

/* ---------------- 静态文件 ---------------- */

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const full = path.normalize(path.join(PUBLIC_DIR, rel));
  if (full.indexOf(PUBLIC_DIR) !== 0) return sendText(res, 403, 'Forbidden');
  fs.readFile(full, function (err, data) {
    if (err) return sendText(res, 404, 'Not Found: ' + rel);
    const ext = path.extname(full).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
}

/* ---------------- 服务器 ---------------- */

ensureDirs();

const server = http.createServer(function (req, res) {
  const u = new URL(req.url, 'http://localhost');
  const pathname = u.pathname;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  if (pathname.indexOf('/api/') === 0) {
    handleApi(req, res, pathname, u.searchParams).catch(function (e) {
      console.error('[api error]', e);
      if (!res.headersSent) sendJson(res, 500, { error: e.message || '服务器内部错误' });
    });
    return;
  }

  serveStatic(req, res, pathname);
});

server.listen(PORT, HOST, function () {
  const ips = lanIPs();
  console.log('');
  console.log('  ============================================');
  console.log('   工作流工具台 已启动');
  console.log('  ============================================');
  console.log('   本机访问 : http://localhost:' + PORT);
  ips.forEach(function (ip) {
    console.log('   手机访问 : http://' + ip + ':' + PORT);
  });
  if (ips.length === 0) {
    console.log('   （未检测到局域网 IP，请检查网络连接）');
  }
  console.log('   数据文件 : ' + DATA_FILE);
  console.log('   自动备份 : ' + BACKUP_DIR);
  console.log('  ============================================');
  console.log('   关闭此窗口即可停止服务。');
  console.log('');
});

process.on('SIGINT', function () {
  console.log('\n正在关闭...');
  server.close(function () { process.exit(0); });
});

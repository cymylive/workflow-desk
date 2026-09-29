/* =========================================================
   工作流工具台 —— 数据层适配器
   ---------------------------------------------------------
   统一接口，两个实现：
     · LocalAdapter  —— 离线模式，数据存 localStorage
     · RemoteAdapter —— 连电脑模式，HTTP 到电脑后端
   上层 app.js 只调用 Storage.*，不关心数据在哪。
   ========================================================= */
(function (global) {
  'use strict';

  var LS_STATE   = 'workflow-desk:state';
  var LS_BACKUPS = 'workflow-desk:backups';
  var LS_SERVER  = 'workflow-desk:server';
  var LS_EXAMPLE = 'workflow-desk:seeded';

  var MAX_LOCAL_BACKUPS = 10;

  /* ---------------- 工具 ---------------- */

  function uid() {
    var a = new Uint8Array(8);
    (global.crypto || global.msCrypto).getRandomValues(a);
    return Array.prototype.map.call(a, function (b) {
      return ('0' + b.toString(16)).slice(-2);
    }).join('');
  }

  function nowIso() { return new Date().toISOString(); }

  function safeParse(s, fallback) {
    try { return s ? JSON.parse(s) : fallback; } catch (e) { return fallback; }
  }

  function exampleState() {
    var t = nowIso();
    function mk(title, desc, note, status) {
      return { id: uid(), title: title, desc: desc, note: note, status: status };
    }
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
          pinned: false,
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

  /** 是否运行在 Capacitor 原生壳里（APK），而不是普通浏览器 */
  function isNativeApp() {
    try {
      if (global.Capacitor && typeof global.Capacitor.isNativePlatform === 'function') {
        return global.Capacitor.isNativePlatform();
      }
    } catch (e) {}
    return false;
  }

  function emptyState() {
    return {
      schema: 'workflow-desk',
      version: 1,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      workflows: []
    };
  }

  /* =========================================================
     LocalAdapter —— 离线模式
     ========================================================= */

  var LocalAdapter = {
    name: 'local',

    getState: function () {
      var raw = null;
      try { raw = global.localStorage.getItem(LS_STATE); } catch (e) {}
      if (!raw) {
        // 首次启动：塞一份示例，让用户打开就有东西看
        var seeded = false;
        try { seeded = global.localStorage.getItem(LS_EXAMPLE) === '1'; } catch (e) {}
        var s = seeded ? emptyState() : exampleState();
        try {
          global.localStorage.setItem(LS_STATE, JSON.stringify(s));
          global.localStorage.setItem(LS_EXAMPLE, '1');
        } catch (e) {}
        return Promise.resolve(s);
      }
      var obj = safeParse(raw, null);
      if (!obj || !Array.isArray(obj.workflows)) return Promise.resolve(exampleState());
      return Promise.resolve(obj);
    },

    putState: function (state) {
      return new Promise(function (resolve, reject) {
        try {
          var old = global.localStorage.getItem(LS_STATE);
          if (old) pushBackup(old);
          state.updatedAt = nowIso();
          global.localStorage.setItem(LS_STATE, JSON.stringify(state));
          resolve();
        } catch (e) {
          reject(new Error(e.name === 'QuotaExceededError'
            ? '手机存储空间不足，请先导出备份再清理'
            : ('保存失败：' + e.message)));
        }
      });
    },

    listBackups: function () {
      var arr = safeParse(global.localStorage.getItem(LS_BACKUPS), []);
      return Promise.resolve(arr.map(function (b) {
        return { file: b.file, size: b.content ? b.content.length : 0, time: b.time };
      }));
    },

    restoreBackup: function (file) {
      var arr = safeParse(global.localStorage.getItem(LS_BACKUPS), []);
      var hit = null;
      arr.forEach(function (b) { if (b.file === file) hit = b; });
      if (!hit) return Promise.reject(new Error('备份不存在'));
      var data = safeParse(hit.content, null);
      if (!data || !Array.isArray(data.workflows)) return Promise.reject(new Error('备份内容损坏'));
      return this.putState(data);
    },

    exportData: function () {
      return this.getState().then(function (s) {
        var stamp = nowIso().slice(0, 19).replace(/[:T]/g, '-');
        return {
          filename: 'workflow-backup-' + stamp + '.json',
          content: JSON.stringify(s, null, 2),
          mime: 'application/json'
        };
      });
    },

    importData: function (json) {
      var obj = safeParse(json, null);
      if (!obj || !Array.isArray(obj.workflows)) {
        return Promise.reject(new Error('不是有效的备份文件：缺少 workflows 数组'));
      }
      if (!obj.schema) obj.schema = 'workflow-desk';
      if (!obj.createdAt) obj.createdAt = nowIso();
      return this.putState(obj);
    },

    probe: function () {
      return Promise.resolve({ ok: true, mode: 'local' });
    }
  };

  function pushBackup(content) {
    var arr = safeParse(global.localStorage.getItem(LS_BACKUPS), []);
    var stamp = nowIso().replace(/[:.]/g, '-');
    arr.unshift({ file: 'local-' + stamp + '.json', time: nowIso(), content: content });
    while (arr.length > MAX_LOCAL_BACKUPS) arr.pop();
    try {
      global.localStorage.setItem(LS_BACKUPS, JSON.stringify(arr));
    } catch (e) {
      // 备份写不下就少留几份，不影响主流程
      try {
        global.localStorage.setItem(LS_BACKUPS, JSON.stringify(arr.slice(0, 3)));
      } catch (e2) {}
    }
  }

  /* =========================================================
     RemoteAdapter —— 连电脑模式
     ========================================================= */

  function RemoteAdapter(baseUrl) {
    this.name = 'remote';
    this.base = String(baseUrl || '').replace(/\/+$/, '');
  }

  RemoteAdapter.prototype._fetch = function (path, opts) {
    opts = opts || {};
    var init = { method: opts.method || 'GET', headers: {} };
    if (opts.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
    }
    var url = this.base + path;
    return global.fetch(url, init).then(function (r) {
      return r.text().then(function (txt) {
        var data = null;
        try { data = txt ? JSON.parse(txt) : null; } catch (e) {}
        if (!r.ok) throw new Error((data && data.error) || ('HTTP ' + r.status));
        return data;
      });
    });
  };

  RemoteAdapter.prototype.getState = function () {
    return this._fetch('/api/state');
  };

  RemoteAdapter.prototype.putState = function (state) {
    return this._fetch('/api/state', { method: 'PUT', body: state });
  };

  RemoteAdapter.prototype.listBackups = function () {
    return this._fetch('/api/backups').then(function (d) {
      return (d && d.backups) || [];
    });
  };

  RemoteAdapter.prototype.restoreBackup = function (file) {
    return this._fetch('/api/backups/restore', { method: 'POST', body: { file: file } });
  };

  RemoteAdapter.prototype.exportData = function () {
    return this.getState().then(function (s) {
      var stamp = nowIso().slice(0, 19).replace(/[:T]/g, '-');
      return {
        filename: 'workflow-backup-' + stamp + '.json',
        content: JSON.stringify(s, null, 2),
        mime: 'application/json'
      };
    });
  };

  RemoteAdapter.prototype.importData = function (json) {
    var obj = safeParse(json, null);
    if (!obj || !Array.isArray(obj.workflows)) {
      return Promise.reject(new Error('不是有效的备份文件：缺少 workflows 数组'));
    }
    return this._fetch('/api/import', { method: 'POST', body: obj });
  };

  RemoteAdapter.prototype.probe = function () {
    var self = this;
    return this._fetch('/api/health').then(function (d) {
      return { ok: !!(d && d.ok), ips: (d && d.ips) || [], port: d && d.port, mode: 'remote' };
    });
  };

  /* =========================================================
     Storage —— 门面
     ========================================================= */

  var Storage = {
    adapter: LocalAdapter,
    serverUrl: '',
    lastProbe: null,

    get mode() { return this.adapter.name; },

    readServerUrl: function () {
      try { return global.localStorage.getItem(LS_SERVER) || ''; } catch (e) { return ''; }
    },

    writeServerUrl: function (url) {
      try {
        if (url) global.localStorage.setItem(LS_SERVER, url);
        else global.localStorage.removeItem(LS_SERVER);
      } catch (e) {}
    },

    /**
     * 初始化：读配置 → 探测 → 选适配器
     * @returns Promise<{mode, serverUrl, probe, fellBack}>
     */
    init: function () {
      var self = this;
      var saved = this.readServerUrl();

      // 普通浏览器打开时，默认连"当前网页所在的服务器"（就是本机 server.js），
      // 这样电脑端行为和以前完全一致。只有 APK 里才需要用户手动配置地址。
      if (!saved && !isNativeApp()) {
        var here = (global.location && global.location.origin) || '';
        if (here && /^https?:/.test(here)) {
          var auto = new RemoteAdapter(here);
          return auto.probe().then(function (p) {
            self.adapter = auto;
            self.serverUrl = here;
            self.lastProbe = p;
            return { mode: 'remote', serverUrl: here, probe: p, fellBack: false, auto: true };
          }).catch(function () {
            // 本地服务器探测失败，退回离线
            self.adapter = LocalAdapter;
            self.serverUrl = '';
            return { mode: 'local', serverUrl: '', fellBack: true, error: '本机服务不可用' };
          });
        }
      }

      if (!saved) {
        this.adapter = LocalAdapter;
        this.serverUrl = '';
        return Promise.resolve({ mode: 'local', serverUrl: '', fellBack: false });
      }

      var remote = new RemoteAdapter(saved);
      return remote.probe().then(function (p) {
        self.adapter = remote;
        self.serverUrl = saved;
        self.lastProbe = p;
        return { mode: 'remote', serverUrl: saved, probe: p, fellBack: false };
      }).catch(function (err) {
        // 连不上：降级到离线，但不擦掉配置，方便用户下次重试
        self.adapter = LocalAdapter;
        self.serverUrl = '';
        return { mode: 'local', serverUrl: saved, fellBack: true, error: err.message };
      });
    },

    /** 手动切到连电脑模式 */
    useRemote: function (url) {
      var self = this;
      var remote = new RemoteAdapter(url);
      return remote.probe().then(function (p) {
        self.adapter = remote;
        self.serverUrl = url;
        self.lastProbe = p;
        self.writeServerUrl(url);
        return p;
      });
    },

    /** 手动切到离线模式 */
    useLocal: function (keepConfig) {
      this.adapter = LocalAdapter;
      this.serverUrl = '';
      if (!keepConfig) this.writeServerUrl('');
      return Promise.resolve({ mode: 'local' });
    },

    /* --- 转发到当前适配器 --- */

    getState:      function () { return Storage.adapter.getState(); },
    putState:      function (s) { return Storage.adapter.putState(s); },
    listBackups:   function () { return Storage.adapter.listBackups(); },
    restoreBackup: function (f) { return Storage.adapter.restoreBackup(f); },
    exportData:    function () { return Storage.adapter.exportData(); },
    importData:    function (j) { return Storage.adapter.importData(j); },

    /** 探测任意地址（不改状态），用于「测试连接」按钮 */
    probeUrl: function (url) {
      return new RemoteAdapter(url).probe();
    },

    MAX_LOCAL_BACKUPS: MAX_LOCAL_BACKUPS,
    isNativeApp: isNativeApp
  };

  global.Storage = Storage;
})(typeof window !== 'undefined' ? window : this);

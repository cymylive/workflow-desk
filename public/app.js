/* =========================================================
   工作流工具台 —— 前端应用
   ========================================================= */
(function () {
  'use strict';

  /* ---------------- 常量 ---------------- */

  var WF_STATUS = {
    developing: { label: '开发中', cls: 'badge-doing',   order: 0 },
    online:     { label: '已完成', cls: 'badge-done',    order: 1 },
    archived:   { label: '已归档', cls: 'badge-archived', order: 2 }
  };

  var STEP_STATUS = {
    pending: { label: '待开始', cls: 'badge-pending', order: 0 },
    doing:   { label: '进行中', cls: 'badge-doing',   order: 1 },
    done:    { label: '已完成', cls: 'badge-done',    order: 2 }
  };

  var STEP_CYCLE = ['pending', 'doing', 'done'];

  var LS_KEY = 'workflow-desk-ui';

  /* ---------------- 运行状态 ---------------- */

  var state = null;          // { schema, version, createdAt, updatedAt, workflows: [] }
  var ui = {
    selectedId: null,
    query: '',
    theme: 'light',
    sidebarOpen: false
  };
  var saveTimer = null;
  var saveSeq = 0;

  /* ---------------- DOM 简写 ---------------- */

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function uid() {
    var a = new Uint8Array(8);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return Array.prototype.map.call(a, function (b) {
      return ('0' + b.toString(16)).slice(-2);
    }).join('');
  }

  function nowIso() { return new Date().toISOString(); }

  function fmtTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
           ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function fmtSize(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  }

  /* ---------------- Toast ---------------- */

  function toast(msg, type) {
    var wrap = $('#toastWrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'toastWrap';
      document.body.appendChild(wrap);
    }
    var el = document.createElement('div');
    el.className = 'toast' + (type ? ' ' + type : '');
    el.textContent = msg;
    wrap.appendChild(el);
    setTimeout(function () {
      el.style.transition = 'opacity .25s, transform .25s';
      el.style.opacity = '0';
      el.style.transform = 'translateY(8px)';
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 260);
    }, 2200);
  }

  /* ---------------- 保存状态提示 ---------------- */

  function setSaveState(kind, text) {
    var el = $('#saveState');
    if (!el) return;
    el.className = 'save-state' + (kind ? ' ' + kind : '');
    el.textContent = text;
  }

  /* ---------------- 数据操作 ---------------- */

  function findWorkflow(id) {
    if (!state) return null;
    for (var i = 0; i < state.workflows.length; i++) {
      if (state.workflows[i].id === id) return state.workflows[i];
    }
    return null;
  }

  function currentWorkflow() {
    return findWorkflow(ui.selectedId);
  }

  function newWorkflow() {
    return {
      id: uid(),
      name: '',
      version: '1.0.0',
      goal: '',
      status: 'developing',
      tags: [],
      pinned: false,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      steps: []
    };
  }

  function newStep() {
    return {
      id: uid(),
      title: '',
      desc: '',
      note: '',
      status: 'pending'
    };
  }

  function normalizeState(obj) {
    if (!obj || typeof obj !== 'object') return null;
    if (!Array.isArray(obj.workflows)) return null;
    obj.workflows.forEach(function (w) {
      if (!w.id) w.id = uid();
      if (!w.name) w.name = '未命名工作流';
      if (!w.version) w.version = '1.0.0';
      if (typeof w.goal !== 'string') w.goal = '';
      if (!WF_STATUS[w.status]) w.status = 'developing';
      if (!Array.isArray(w.tags)) w.tags = [];
      if (typeof w.pinned !== 'boolean') w.pinned = false;
      if (!w.createdAt) w.createdAt = nowIso();
      if (!w.updatedAt) w.updatedAt = w.createdAt;
      if (!Array.isArray(w.steps)) w.steps = [];
      w.steps.forEach(function (s) {
        if (!s.id) s.id = uid();
        if (typeof s.title !== 'string') s.title = '';
        if (typeof s.desc !== 'string') s.desc = '';
        if (typeof s.note !== 'string') s.note = '';
        if (!STEP_STATUS[s.status]) s.status = 'pending';
      });
    });
    if (!obj.schema) obj.schema = 'workflow-desk';
    if (!obj.version) obj.version = 1;
    if (!obj.createdAt) obj.createdAt = nowIso();
    if (!obj.updatedAt) obj.updatedAt = nowIso();
    return obj;
  }

  function touch() {
    if (state) state.updatedAt = nowIso();
  }

  /* ---------------- 与后端通信 ---------------- */

  /* 所有数据读写都走 Storage 适配器（离线 / 连电脑自动切换） */
  function api(path, opts) {
    opts = opts || {};
    var method = (opts.method || 'GET').toUpperCase();

    if (path === '/api/state' && method === 'GET') {
      return window.Storage.getState();
    }
    if (path === '/api/state' && method === 'PUT') {
      var body = opts.body;
      var obj = typeof body === 'string' ? JSON.parse(body) : body;
      return window.Storage.putState(obj).then(function () { return { ok: true }; });
    }
    if (path === '/api/backups' && method === 'GET') {
      return window.Storage.listBackups().then(function (arr) { return { backups: arr }; });
    }
    if (path === '/api/backups/restore' && method === 'POST') {
      var f = opts.body && opts.body.file;
      return window.Storage.restoreBackup(f).then(function () { return { ok: true }; });
    }
    if (path === '/api/import' && method === 'POST') {
      var raw = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
      return window.Storage.importData(raw).then(function () { return { ok: true }; });
    }
    return Promise.reject(new Error('未知接口: ' + method + ' ' + path));
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    setSaveState('saving', '保存中…');
    var mySeq = ++saveSeq;
    saveTimer = setTimeout(function () {
      var snapshot = JSON.stringify(state);
      api('/api/state', { method: 'PUT', body: snapshot })
        .then(function () {
          if (mySeq !== saveSeq) return;
          setSaveState('saved', '已保存 · ' + fmtTime(nowIso()).slice(11));
          setTimeout(function () {
            if (mySeq === saveSeq) setSaveState('', '已就绪');
          }, 2200);
        })
        .catch(function (e) {
          if (mySeq !== saveSeq) return;
          setSaveState('error', '保存失败');
          toast('保存失败：' + e.message, 'err');
        });
    }, 400);
  }

  /* ---------------- UI 持久化 ---------------- */

  function loadUi() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      var o = JSON.parse(raw);
      if (o && typeof o === 'object') {
        if (typeof o.selectedId === 'string') ui.selectedId = o.selectedId;
        if (o.theme === 'dark' || o.theme === 'light') ui.theme = o.theme;
      }
    } catch (e) {}
  }

  function saveUi() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        selectedId: ui.selectedId,
        theme: ui.theme
      }));
    } catch (e) {}
  }

  function applyTheme() {
    document.documentElement.setAttribute('data-theme', ui.theme);
    var btn = $('#btnTheme');
    if (btn) btn.textContent = ui.theme === 'dark' ? '☀' : '◐';

    // 同步系统状态栏/导航栏图标颜色（仅 APK 内有效）
    // Capacitor 8 用 SystemBars 插件（StatusBar 插件在 Android 15+ 已失效）
    try {
      var P = window.Capacitor && window.Capacitor.Plugins;
      if (P) {
        var style = ui.theme === 'dark' ? 'DARK' : 'LIGHT';
        if (P.SystemBars && P.SystemBars.setStyle) {
          P.SystemBars.setStyle({ style: style });
        } else if (P.StatusBar && P.StatusBar.setStyle) {
          // 老版本 Capacitor 的兜底
          P.StatusBar.setStyle({ style: style });
        }
      }
    } catch (e) {}

    // 让浏览器原生 UI 也跟随（PWA / 支持 theme-color 的浏览器）
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute('content', ui.theme === 'dark' ? '#172032' : '#ffffff');
    }
  }

  /* =========================================================
     渲染：侧栏
     ========================================================= */

  function matchQuery(w) {
    if (!ui.query) return true;
    var q = ui.query.toLowerCase();
    if ((w.name || '').toLowerCase().indexOf(q) >= 0) return true;
    if ((w.goal || '').toLowerCase().indexOf(q) >= 0) return true;
    if ((w.version || '').toLowerCase().indexOf(q) >= 0) return true;
    if ((w.tags || []).join(' ').toLowerCase().indexOf(q) >= 0) return true;
    for (var i = 0; i < (w.steps || []).length; i++) {
      var s = w.steps[i];
      if ((s.title || '').toLowerCase().indexOf(q) >= 0) return true;
      if ((s.desc || '').toLowerCase().indexOf(q) >= 0) return true;
      if ((s.note || '').toLowerCase().indexOf(q) >= 0) return true;
    }
    return false;
  }

  function progressOf(w) {
    var total = (w.steps || []).length;
    if (!total) return 0;
    var done = 0;
    w.steps.forEach(function (s) { if (s.status === 'done') done++; });
    return Math.round(done / total * 100);
  }

  function renderSidebar() {
    var list = $('#wfList');
    var count = $('#wfCount');
    if (!list) return;

    var all = state ? state.workflows.slice() : [];
    all.sort(function (a, b) {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      var sa = (WF_STATUS[a.status] || WF_STATUS.developing).order;
      var sb = (WF_STATUS[b.status] || WF_STATUS.developing).order;
      if (sa !== sb) return sa - sb;
      return String(b.updatedAt).localeCompare(String(a.updatedAt));
    });

    var shown = all.filter(matchQuery);
    if (count) count.textContent = String(all.length);

    if (!shown.length) {
      list.innerHTML = '<div class="wf-empty-hint">' +
        (all.length ? '没有匹配的工作流' : '还没有工作流<br>点右上角「新建工作流」开始') +
        '</div>';
      return;
    }

    var html = '';
    shown.forEach(function (w) {
      var st = WF_STATUS[w.status] || WF_STATUS.developing;
      var pct = progressOf(w);
      var doneCount = (w.steps || []).filter(function (s) { return s.status === 'done'; }).length;
      html += '<div class="wf-item' + (w.id === ui.selectedId ? ' active' : '') +
              (w.pinned ? ' pinned' : '') +
              '" data-id="' + esc(w.id) + '">' +
        '<button class="pin-btn' + (w.pinned ? ' on' : '') + '" data-act="pin" title="' +
          (w.pinned ? '取消置顶' : '置顶') + '">' + (w.pinned ? '📌' : '📍') + '</button>' +
        '<div class="wf-item-top">' +
          (w.pinned ? '<span class="pin-mark">📌</span>' : '') +
          '<span class="wf-item-name">' + esc(w.name || '未命名工作流') + '</span>' +
          '<span class="wf-item-ver">v' + esc(w.version || '1.0.0') + '</span>' +
        '</div>' +
        (w.goal ? '<div class="wf-item-goal">' + esc(w.goal) + '</div>' : '') +
        '<div class="wf-item-meta">' +
          '<span class="badge ' + st.cls + ' badge-static">' + st.label + '</span>' +
          '<span class="mini-progress"><i style="width:' + pct + '%"></i></span>' +
          '<span style="font-size:11px;color:var(--text-faint)">' + doneCount + '/' +
            (w.steps || []).length + '</span>' +
        '</div>' +
      '</div>';
    });
    list.innerHTML = html;
  }

  /* =========================================================
     渲染：内容区
     ========================================================= */

  function renderContent() {
    var box = $('#content');
    if (!box) return;

    var w = currentWorkflow();
    if (!w) {
      box.innerHTML =
        '<div class="empty-state">' +
          '<div class="big">◈</div>' +
          '<h2>' + (state && state.workflows.length ? '从左侧选择一个工作流' : '开始你的第一个工作流') + '</h2>' +
          '<p>工作流 = 一个目标 + 一串按顺序执行的环节。<br>每个环节都能写说明和备注，状态随时可改。</p>' +
          '<button class="btn btn-primary" id="emptyNew">＋ 新建工作流</button>' +
        '</div>';
      var b = $('#emptyNew');
      if (b) b.addEventListener('click', function () { openWorkflowModal(null); });
      return;
    }

    var st = WF_STATUS[w.status] || WF_STATUS.developing;
    var pct = progressOf(w);
    var steps = w.steps || [];
    var counts = { pending: 0, doing: 0, done: 0 };
    steps.forEach(function (s) { counts[s.status] = (counts[s.status] || 0) + 1; });

    var html = '';

    /* --- 头部 --- */
    html += '<div class="detail-head">' +
      '<div class="detail-title-row">' +
        '<h2 class="detail-title">' + esc(w.name || '未命名工作流') + '</h2>' +
        '<span class="detail-ver">v' + esc(w.version || '1.0.0') + '</span>' +
        '<div class="detail-actions">' +
          '<button class="btn btn-ghost btn-sm' + (w.pinned ? ' is-pinned' : '') + '" id="btnPinWf">' +
            (w.pinned ? '📌 已置顶' : '📍 置顶') + '</button>' +
          '<button class="btn btn-ghost btn-sm" id="btnEditWf">编辑</button>' +
          '<button class="btn btn-danger btn-sm" id="btnDelWf">删除</button>' +
        '</div>' +
      '</div>' +
      (w.goal
        ? '<div class="detail-goal"><span class="label">目的与收益</span>' + esc(w.goal) + '</div>'
        : '<div class="detail-goal" style="background:var(--idle-soft);border-left-color:var(--border-strong)">' +
          '<span class="label" style="color:var(--text-faint)">目的与收益</span>' +
          '<span style="color:var(--text-faint)">还没填写，点「编辑」补充这条工作流要达到什么效果</span></div>') +
      '<div class="detail-stats">' +
        '<div class="stat"><b>' + steps.length + '</b><span>环节总数</span></div>' +
        '<div class="stat"><b style="color:var(--ok)">' + counts.done + '</b><span>已完成</span></div>' +
        '<div class="stat"><b style="color:var(--primary)">' + counts.doing + '</b><span>进行中</span></div>' +
        '<div class="stat"><b style="color:var(--idle)">' + counts.pending + '</b><span>待开始</span></div>' +
        '<div class="big-progress" title="完成度 ' + pct + '%"><i style="width:' + pct + '%"></i></div>' +
        '<div class="stat"><b>' + pct + '%</b><span>完成度</span></div>' +
        '<span class="badge ' + st.cls + '" id="wfStatusBadge" title="点击切换状态">' +
          st.label + '</span>' +
      '</div>' +
      ((w.tags && w.tags.length)
        ? '<div class="tag-row">' + w.tags.map(function (t) {
            return '<span class="tag">#' + esc(t) + '</span>';
          }).join('') + '</div>'
        : '') +
      '<div style="margin-top:12px;font-size:11.5px;color:var(--text-faint)">' +
        '创建 ' + esc(fmtTime(w.createdAt)) + ' · 最近更新 ' + esc(fmtTime(w.updatedAt)) +
      '</div>' +
    '</div>';

    /* --- 流程链路图 --- */
    html += renderFlowChain(w, steps);

    /* --- 环节列表 --- */
    html += '<div class="section-head">' +
      '<h3>工作流环节</h3>' +
      '<button class="btn btn-soft btn-sm" id="btnAddStep">＋ 添加环节</button>' +
    '</div>';

    html += '<div class="steps" id="stepsBox">';
    if (!steps.length) {
      html += '<div class="wf-empty-hint" style="padding:26px">' +
              '这个工作流还没有环节。<br>环节就是按顺序要做的事，比如「晨间启动」。' +
              '</div>';
    } else {
      steps.forEach(function (s, idx) {
        html += renderStepCard(s, idx);
      });
    }
    html += '</div>';

    html += '<button class="step-add" id="btnAddStep2" style="margin-top:10px">＋ 添加环节</button>';

    box.innerHTML = html;
    bindContentEvents(w);
  }

  function renderFlowChain(w, steps) {
    if (!steps.length) return '';
    var html = '<div class="flow-wrap">' +
      '<div class="flow-head">' +
        '<span class="flow-title">流程链路</span>' +
        '<div class="seg seg-xs" id="flowMode">' +
          '<button type="button" data-v="detail" class="on">详细</button>' +
          '<button type="button" data-v="compact">紧凑</button>' +
        '</div>' +
      '</div>' +
      '<div class="flow-chain" id="flowChain" data-mode="detail">';

    steps.forEach(function (s, i) {
      html += '<button type="button" class="flow-node" data-status="' + esc(s.status) +
        '" data-id="' + esc(s.id) + '" title="' + esc(s.title || '未命名环节') + '">' +
        '<span class="flow-num">' + (i + 1) + '</span>' +
        '<span class="flow-dot"></span>' +
        '<span class="flow-name">' + esc(s.title || '未命名环节') + '</span>' +
      '</button>';

      if (i < steps.length - 1) {
        var linked = (s.status === 'done' && steps[i + 1].status === 'done');
        html += '<span class="flow-arrow' + (linked ? ' done' : '') + '"></span>';
      }
    });

    html += '</div></div>';
    return html;
  }

  function renderStepCard(s, idx) {
    var st = STEP_STATUS[s.status] || STEP_STATUS.pending;
    return '<div class="step" data-id="' + esc(s.id) + '" data-status="' + esc(s.status) + '" draggable="true">' +
      '<div class="step-index">' +
        '<span class="step-num">' + (idx + 1) + '</span>' +
        '<span class="step-drag" title="拖动排序">⠿</span>' +
      '</div>' +
      '<div class="step-body">' +
        '<div class="step-title-row">' +
          '<h4 class="step-title">' + esc(s.title || '未命名环节') + '</h4>' +
          '<span class="badge ' + st.cls + '" data-act="cycle" title="点击切换状态">' + st.label + '</span>' +
        '</div>' +
        (s.desc ? '<p class="step-desc">' + esc(s.desc) + '</p>' : '') +
        (s.note
          ? '<div class="step-note"><span class="note-icon">📌</span><span>' + esc(s.note) + '</span></div>'
          : '') +
      '</div>' +
      '<div class="step-actions">' +
        '<button class="icon-btn" data-act="up" title="上移"' + (idx === 0 ? ' disabled style="opacity:.3"' : '') + '>↑</button>' +
        '<button class="icon-btn" data-act="down" title="下移">↓</button>' +
        '<button class="icon-btn" data-act="edit" title="编辑环节">✎</button>' +
        '<button class="icon-btn danger" data-act="del" title="删除环节">✕</button>' +
      '</div>' +
    '</div>';
  }

  /* ---------------- 内容区事件 ---------------- */

  function bindContentEvents(w) {
    var btnEdit = $('#btnEditWf');
    if (btnEdit) btnEdit.addEventListener('click', function () { openWorkflowModal(w.id); });

    var btnPin = $('#btnPinWf');
    if (btnPin) btnPin.addEventListener('click', function () { togglePin(w.id); });

    var btnDel = $('#btnDelWf');
    if (btnDel) btnDel.addEventListener('click', function () { confirmDeleteWorkflow(w.id); });

    var badge = $('#wfStatusBadge');
    if (badge) {
      badge.addEventListener('click', function () { cycleWorkflowStatus(w.id); });
    }

    var add1 = $('#btnAddStep');
    if (add1) add1.addEventListener('click', function () { openStepModal(w.id, null); });
    var add2 = $('#btnAddStep2');
    if (add2) add2.addEventListener('click', function () { openStepModal(w.id, null); });

    bindFlowEvents(w);

    $$('#stepsBox .step').forEach(function (el) {
      bindStepEvents(el, w);
    });
  }

  function bindFlowEvents(w) {
    var chain = $('#flowChain');
    if (!chain) return;

    /* 点击节点 → 滚动到对应卡片并高亮 */
    chain.addEventListener('click', function (ev) {
      var node = ev.target.closest ? ev.target.closest('.flow-node') : null;
      if (!node) return;

      var id = node.getAttribute('data-id');
      var card = null;
      Array.prototype.forEach.call(document.querySelectorAll('#stepsBox .step'), function (el) {
        if (el.getAttribute('data-id') === id) card = el;
      });
      if (!card) return;

      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.classList.remove('flash');
      void card.offsetWidth;
      card.classList.add('flash');
      setTimeout(function () { card.classList.remove('flash'); }, 1400);
    });

    /* 详细 / 紧凑 切换 */
    var mode = $('#flowMode');
    if (mode) {
      Array.prototype.forEach.call(mode.querySelectorAll('button'), function (b) {
        b.addEventListener('click', function () {
          var v = b.getAttribute('data-v');
          chain.setAttribute('data-mode', v);
          Array.prototype.forEach.call(mode.querySelectorAll('button'), function (x) {
            x.classList.remove('on');
          });
          b.classList.add('on');
        });
      });
    }
  }

  function bindStepEvents(el, w) {
    var stepId = el.getAttribute('data-id');

    el.addEventListener('click', function (ev) {
      var act = ev.target.getAttribute && ev.target.getAttribute('data-act');
      if (!act) return;
      ev.stopPropagation();

      if (act === 'cycle') return cycleStepStatus(w.id, stepId);
      if (act === 'edit')  return openStepModal(w.id, stepId);
      if (act === 'del')   return confirmDeleteStep(w.id, stepId);
      if (act === 'up')    return moveStep(w.id, stepId, -1);
      if (act === 'down')  return moveStep(w.id, stepId, 1);
    });

    /* 拖拽排序 */
    el.addEventListener('dragstart', function (ev) {
      ev.dataTransfer.effectAllowed = 'move';
      try { ev.dataTransfer.setData('text/plain', stepId); } catch (e) {}
      el.classList.add('dragging');
    });
    el.addEventListener('dragend', function () {
      el.classList.remove('dragging');
      $$('#stepsBox .step').forEach(function (x) { x.classList.remove('drop-target'); });
    });
    el.addEventListener('dragover', function (ev) {
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'move';
      el.classList.add('drop-target');
    });
    el.addEventListener('dragleave', function () { el.classList.remove('drop-target'); });
    el.addEventListener('drop', function (ev) {
      ev.preventDefault();
      el.classList.remove('drop-target');
      var fromId = '';
      try { fromId = ev.dataTransfer.getData('text/plain'); } catch (e) {}
      if (fromId) reorderStep(w.id, fromId, stepId);
    });
  }

  /* =========================================================
     业务动作
     ========================================================= */

  function togglePin(id) {
    var w = findWorkflow(id);
    if (!w) return;
    w.pinned = !w.pinned;
    touch();
    renderAll();
    scheduleSave();
    toast(w.pinned ? '已置顶' : '已取消置顶', 'ok');
  }

  function cycleWorkflowStatus(id) {
    var w = findWorkflow(id);
    if (!w) return;
    var keys = ['developing', 'online', 'archived'];
    var i = keys.indexOf(w.status);
    w.status = keys[(i + 1) % keys.length];
    touch();
    renderAll();
    scheduleSave();
    toast('状态已改为「' + WF_STATUS[w.status].label + '」', 'ok');
  }

  function cycleStepStatus(wfId, stepId) {
    var w = findWorkflow(wfId);
    if (!w) return;
    var s = null;
    w.steps.forEach(function (x) { if (x.id === stepId) s = x; });
    if (!s) return;
    var i = STEP_CYCLE.indexOf(s.status);
    s.status = STEP_CYCLE[(i + 1) % STEP_CYCLE.length];
    touch();
    renderAll();
    scheduleSave();
  }

  function moveStep(wfId, stepId, delta) {
    var w = findWorkflow(wfId);
    if (!w) return;
    var i = -1;
    w.steps.forEach(function (x, k) { if (x.id === stepId) i = k; });
    if (i < 0) return;
    var j = i + delta;
    if (j < 0 || j >= w.steps.length) return;
    var tmp = w.steps[i];
    w.steps[i] = w.steps[j];
    w.steps[j] = tmp;
    touch();
    renderAll();
    scheduleSave();
  }

  function reorderStep(wfId, fromId, toId) {
    if (fromId === toId) return;
    var w = findWorkflow(wfId);
    if (!w) return;
    var from = -1, to = -1;
    w.steps.forEach(function (x, k) {
      if (x.id === fromId) from = k;
      if (x.id === toId) to = k;
    });
    if (from < 0 || to < 0) return;
    var moved = w.steps.splice(from, 1)[0];
    w.steps.splice(to, 0, moved);
    touch();
    renderAll();
    scheduleSave();
  }

  function confirmDeleteWorkflow(id) {
    var w = findWorkflow(id);
    if (!w) return;
    confirmDialog(
      '删除工作流',
      '确定删除「' + (w.name || '未命名工作流') + '」吗？它的 ' + (w.steps || []).length +
      ' 个环节会一起消失。此操作不可撤销（但可以从「备份」里恢复历史版本）。',
      '删除',
      function () {
        state.workflows = state.workflows.filter(function (x) { return x.id !== id; });
        if (ui.selectedId === id) ui.selectedId = state.workflows.length ? state.workflows[0].id : null;
        touch();
        saveUi();
        renderAll();
        scheduleSave();
        toast('已删除', 'ok');
      }
    );
  }

  function confirmDeleteStep(wfId, stepId) {
    var w = findWorkflow(wfId);
    if (!w) return;
    var s = null;
    w.steps.forEach(function (x) { if (x.id === stepId) s = x; });
    if (!s) return;
    confirmDialog(
      '删除环节',
      '确定删除环节「' + (s.title || '未命名环节') + '」吗？',
      '删除',
      function () {
        w.steps = w.steps.filter(function (x) { return x.id !== stepId; });
        touch();
        renderAll();
        scheduleSave();
        toast('环节已删除', 'ok');
      }
    );
  }

  /* =========================================================
     渲染总入口
     ========================================================= */

  function renderAll() {
    renderSidebar();
    renderContent();
  }

  /* =========================================================
     弹窗基础设施
     ========================================================= */

  function openModal(opts) {
    var root = $('#modalRoot');
    var mask = document.createElement('div');
    mask.className = 'modal-mask';

    var modal = document.createElement('div');
    modal.className = 'modal' + (opts.wide ? ' wide' : '');

    modal.innerHTML =
      '<div class="modal-head">' +
        '<h2>' + esc(opts.title || '') + '</h2>' +
        '<button class="modal-close" type="button">×</button>' +
      '</div>' +
      '<div class="modal-body">' + (opts.body || '') + '</div>' +
      (opts.footer === false ? '' : '<div class="modal-foot"></div>');

    mask.appendChild(modal);
    root.appendChild(mask);

    function close() {
      if (mask.parentNode) mask.parentNode.removeChild(mask);
      document.removeEventListener('keydown', onKey);
    }
    function onKey(ev) {
      if (ev.key === 'Escape') close();
    }
    document.addEventListener('keydown', onKey);

    $('.modal-close', modal).addEventListener('click', close);
    mask.addEventListener('mousedown', function (ev) {
      if (ev.target === mask && opts.maskClose !== false) close();
    });

    var ctx = {
      mask: mask,
      modal: modal,
      body: $('.modal-body', modal),
      foot: $('.modal-foot', modal),
      close: close
    };
    if (typeof opts.onReady === 'function') opts.onReady(ctx);
    return ctx;
  }

  function confirmDialog(title, message, okText, onOk) {
    var ctx = openModal({
      title: title,
      body: '<p style="margin:0;font-size:13.5px;line-height:1.75;color:var(--text-dim)">' +
            esc(message) + '</p>',
      onReady: function (c) {
        var cancel = document.createElement('button');
        cancel.className = 'btn btn-ghost';
        cancel.textContent = '取消';
        cancel.addEventListener('click', c.close);

        var ok = document.createElement('button');
        ok.className = 'btn btn-primary';
        ok.textContent = okText || '确定';
        ok.addEventListener('click', function () { c.close(); onOk(); });

        c.foot.appendChild(cancel);
        c.foot.appendChild(ok);
        setTimeout(function () { ok.focus(); }, 40);
      }
    });
    return ctx;
  }

  /* =========================================================
     工作流 新建 / 编辑
     ========================================================= */

  function openWorkflowModal(id) {
    var isEdit = !!id;
    var w = isEdit ? findWorkflow(id) : newWorkflow();
    if (!w) return;

    var body =
      '<div class="field">' +
        '<label>工作流名称<span class="req">*</span></label>' +
        '<input class="input" id="fName" placeholder="例如：让生活幸福的工作流" value="' + esc(w.name) + '">' +
      '</div>' +
      '<div class="field-row">' +
        '<div class="field" style="flex:0 0 150px">' +
          '<label>版本号</label>' +
          '<input class="input input-mono" id="fVer" placeholder="1.0.0" value="' + esc(w.version) + '">' +
          '<div class="hint">每次迭代自己手动升，例如 1.0.0 → 1.1.0</div>' +
        '</div>' +
        '<div class="field">' +
          '<label>状态</label>' +
          '<select class="select" id="fStatus">' +
            Object.keys(WF_STATUS).map(function (k) {
              return '<option value="' + k + '"' + (w.status === k ? ' selected' : '') + '>' +
                     WF_STATUS[k].label + '</option>';
            }).join('') +
          '</select>' +
        '</div>' +
      '</div>' +
      '<div class="field">' +
        '<label>目的与收益<span class="req">*</span></label>' +
        '<textarea class="textarea" id="fGoal" placeholder="这套工作流跑起来之后，我想得到什么？&#10;例如：让身体、情绪、关系三个维度稳定提升，幸福感可观察、可迭代。">' + esc(w.goal) + '</textarea>' +
      '</div>' +
      '<div class="field">' +
        '<label>标签</label>' +
        '<input class="input" id="fTags" placeholder="用逗号或空格分隔，例如：生活, 习惯, 幸福感" value="' + esc((w.tags || []).join(', ')) + '">' +
      '</div>' +
      '<div class="field">' +
        '<label>置顶</label>' +
        '<div class="seg" id="fPin">' +
          '<button type="button" data-v="1"' + (w.pinned ? ' class="on"' : '') + '>📌 置顶</button>' +
          '<button type="button" data-v="0"' + (!w.pinned ? ' class="on"' : '') + '>不置顶</button>' +
        '</div>' +
        '<div class="hint">置顶的工作流会排在列表最上方，不受状态和更新时间影响。</div>' +
      '</div>';

    openModal({
      title: isEdit ? '编辑工作流' : '新建工作流',
      body: body,
      onReady: function (c) {
        var nameEl = $('#fName', c.modal);
        setTimeout(function () { nameEl.focus(); nameEl.select(); }, 50);

        var pinned = !!w.pinned;
        var seg = $('#fPin', c.modal);
        if (seg) {
          $$('button', seg).forEach(function (b) {
            b.addEventListener('click', function () {
              pinned = b.getAttribute('data-v') === '1';
              $$('button', seg).forEach(function (x) { x.classList.remove('on'); });
              b.classList.add('on');
            });
          });
        }

        var cancel = document.createElement('button');
        cancel.className = 'btn btn-ghost';
        cancel.textContent = '取消';
        cancel.addEventListener('click', c.close);

        var save = document.createElement('button');
        save.className = 'btn btn-primary';
        save.textContent = isEdit ? '保存修改' : '创建工作流';
        save.addEventListener('click', function () {
          var name = $('#fName', c.modal).value.trim();
          var ver = $('#fVer', c.modal).value.trim() || '1.0.0';
          var status = $('#fStatus', c.modal).value;
          var goal = $('#fGoal', c.modal).value.trim();
          var tagsRaw = $('#fTags', c.modal).value;

          if (!name) { toast('请填写工作流名称', 'err'); nameEl.focus(); return; }

          var tags = tagsRaw.split(/[,，\s]+/).map(function (t) { return t.trim(); })
                            .filter(function (t) { return t; });

          w.name = name;
          w.version = ver;
          w.status = WF_STATUS[status] ? status : 'developing';
          w.goal = goal;
          w.tags = tags;
          w.pinned = pinned;
          w.updatedAt = nowIso();

          if (!isEdit) {
            w.createdAt = nowIso();
            state.workflows.push(w);
            ui.selectedId = w.id;
            saveUi();
          }
          touch();
          c.close();
          renderAll();
          scheduleSave();
          toast(isEdit ? '已保存' : '工作流已创建', 'ok');
        });

        c.foot.appendChild(cancel);
        c.foot.appendChild(save);
      }
    });
  }

  /* =========================================================
     环节 新建 / 编辑
     ========================================================= */

  function openStepModal(wfId, stepId) {
    var w = findWorkflow(wfId);
    if (!w) return;
    var isEdit = !!stepId;
    var s = null;
    if (isEdit) w.steps.forEach(function (x) { if (x.id === stepId) s = x; });
    if (!s) s = newStep();

    var body =
      '<div class="field">' +
        '<label>环节名称<span class="req">*</span></label>' +
        '<input class="input" id="sTitle" placeholder="例如：晨间启动" value="' + esc(s.title) + '">' +
      '</div>' +
      '<div class="field">' +
        '<label>这一步要做什么</label>' +
        '<textarea class="textarea" id="sDesc" placeholder="具体动作、时长、标准。&#10;例如：起床后 10 分钟固定动作——喝水、拉伸、写下今天最重要的一件事。">' + esc(s.desc) + '</textarea>' +
      '</div>' +
      '<div class="field">' +
        '<label>备注 / 说明</label>' +
        '<textarea class="textarea" id="sNote" placeholder="容易踩的坑、执行要点、之后的改进想法。&#10;例如：不要一睁眼就看手机。">' + esc(s.note) + '</textarea>' +
        '<div class="hint">备注会用黄色便签样式显示在环节卡片里，方便一眼看到重点。</div>' +
      '</div>' +
      '<div class="field">' +
        '<label>当前状态</label>' +
        '<div class="seg" id="sSeg">' +
          Object.keys(STEP_STATUS).map(function (k) {
            return '<button type="button" data-v="' + k + '"' + (s.status === k ? ' class="on"' : '') + '>' +
                   STEP_STATUS[k].label + '</button>';
          }).join('') +
        '</div>' +
      '</div>';

    openModal({
      title: isEdit ? '编辑环节' : '添加环节',
      body: body,
      onReady: function (c) {
        var chosen = s.status;
        $$('#sSeg button', c.modal).forEach(function (b) {
          b.addEventListener('click', function () {
            chosen = b.getAttribute('data-v');
            $$('#sSeg button', c.modal).forEach(function (x) { x.classList.remove('on'); });
            b.classList.add('on');
          });
        });

        var titleEl = $('#sTitle', c.modal);
        setTimeout(function () { titleEl.focus(); titleEl.select(); }, 50);

        var cancel = document.createElement('button');
        cancel.className = 'btn btn-ghost';
        cancel.textContent = '取消';
        cancel.addEventListener('click', c.close);

        var save = document.createElement('button');
        save.className = 'btn btn-primary';
        save.textContent = isEdit ? '保存修改' : '添加';
        save.addEventListener('click', function () {
          var title = $('#sTitle', c.modal).value.trim();
          if (!title) { toast('请填写环节名称', 'err'); titleEl.focus(); return; }

          s.title = title;
          s.desc = $('#sDesc', c.modal).value.trim();
          s.note = $('#sNote', c.modal).value.trim();
          s.status = STEP_STATUS[chosen] ? chosen : 'pending';

          if (!isEdit) w.steps.push(s);
          touch();
          c.close();
          renderAll();
          scheduleSave();
          toast(isEdit ? '环节已保存' : '环节已添加', 'ok');
        });

        c.foot.appendChild(cancel);
        c.foot.appendChild(save);
      }
    });
  }

  /* =========================================================
     备份面板
     ========================================================= */

  function openBackupModal() {
    var body =
      '<div class="field">' +
        '<label>导出备份</label>' +
        '<div class="hint" style="margin:0 0 9px">把当前所有工作流下载成一个 JSON 文件，存到网盘或 U 盘就不会丢。</div>' +
        '<button class="btn btn-primary" id="bExport" style="width:100%">⬇ 下载备份文件</button>' +
      '</div>' +
      '<div class="divider">导入 / 恢复</div>' +
      '<div class="field">' +
        '<div class="drop-zone" id="bDrop">' +
          '<span class="dz-icon">📂</span>' +
          '点击选择备份文件，或把 .json 拖到这里<br>' +
          '<span style="font-size:11.5px;color:var(--text-faint)">' +
          '导入会覆盖当前全部数据，请先导出一次现有数据' +
          '</span>' +
        '</div>' +
        '<input type="file" id="bFile" accept=".json,application/json" style="display:none">' +
      '</div>' +
      '<div class="divider">自动备份（' +
        (window.Storage.mode === 'remote' ? '最近 50 份' : '最近 10 份') +
      '）</div>' +
      '<div class="field">' +
        '<div class="backup-list" id="bList">' +
          '<div class="wf-empty-hint" style="padding:14px">读取中…</div>' +
        '</div>' +
        '<div class="hint">每次保存前会自动留一份快照，改错了可以回滚。</div>' +
      '</div>';

    openModal({
      title: '备份与恢复',
      body: body,
      wide: true,
      onReady: function (c) {
        $('#bExport', c.modal).addEventListener('click', function () {
          window.Storage.exportData().then(function (out) {
            var blob = new Blob([out.content], { type: out.mime || 'application/json' });
            var a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = out.filename;
            document.body.appendChild(a);
            a.click();
            setTimeout(function () {
              URL.revokeObjectURL(a.href);
              if (a.parentNode) a.parentNode.removeChild(a);
            }, 400);
            toast('已导出 ' + out.filename, 'ok');
          }).catch(function (e) {
            toast('导出失败：' + e.message, 'err');
          });
        });

        var fileEl = $('#bFile', c.modal);
        var dropEl = $('#bDrop', c.modal);

        dropEl.addEventListener('click', function () { fileEl.click(); });
        fileEl.addEventListener('change', function () {
          if (fileEl.files && fileEl.files[0]) doImport(fileEl.files[0], c);
        });
        ['dragenter', 'dragover'].forEach(function (ev) {
          dropEl.addEventListener(ev, function (e) {
            e.preventDefault(); e.stopPropagation();
            dropEl.classList.add('over');
          });
        });
        ['dragleave', 'drop'].forEach(function (ev) {
          dropEl.addEventListener(ev, function (e) {
            e.preventDefault(); e.stopPropagation();
            dropEl.classList.remove('over');
          });
        });
        dropEl.addEventListener('drop', function (e) {
          var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
          if (f) doImport(f, c);
        });

        loadBackups(c);

        var close = document.createElement('button');
        close.className = 'btn btn-ghost';
        close.textContent = '关闭';
        close.addEventListener('click', c.close);
        c.foot.appendChild(close);
      }
    });
  }

  function doImport(file, c) {
    if (!/\.json$/i.test(file.name) && file.type !== 'application/json') {
      toast('请选择 .json 备份文件', 'err');
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      var obj;
      try { obj = JSON.parse(String(reader.result)); }
      catch (e) { toast('文件不是有效的 JSON', 'err'); return; }
      var norm = normalizeState(obj);
      if (!norm) { toast('不是本工具的备份文件', 'err'); return; }

      confirmDialog(
        '确认导入',
        '导入会覆盖当前 ' + state.workflows.length + ' 个工作流，替换为文件里的 ' +
        norm.workflows.length + ' 个。确定继续吗？',
        '覆盖导入',
        function () {
          state = norm;
          ui.selectedId = state.workflows.length ? state.workflows[0].id : null;
          saveUi();
          renderAll();
          if (c) c.close();
          window.Storage.importData(JSON.stringify(state))
            .then(function () { toast('导入成功', 'ok'); })
            .catch(function (e) { toast('导入失败：' + e.message, 'err'); });
        }
      );
    };
    reader.onerror = function () { toast('读取文件失败', 'err'); };
    reader.readAsText(file, 'utf-8');
  }

  function loadBackups(c) {
    api('/api/backups').then(function (data) {
      var list = $('#bList', c.modal);
      if (!list) return;
      var arr = (data && data.backups) || [];
      if (!arr.length) {
        list.innerHTML = '<div class="wf-empty-hint" style="padding:14px">还没有自动备份</div>';
        return;
      }
      list.innerHTML = arr.map(function (b) {
        return '<div class="backup-row">' +
          '<span class="fname" title="' + esc(b.file) + '">' + esc(b.file) + '</span>' +
          '<span class="fsize">' + fmtSize(b.size) + '</span>' +
          '<button class="btn btn-soft btn-sm" data-restore="' + esc(b.file) + '">恢复</button>' +
        '</div>';
      }).join('');

      $$('[data-restore]', list).forEach(function (btn) {
        btn.addEventListener('click', function () {
          var f = btn.getAttribute('data-restore');
          confirmDialog('恢复备份',
            '用「' + f + '」覆盖当前数据？当前内容会先被自动备份一份。',
            '恢复', function () {
              api('/api/backups/restore', { method: 'POST', body: { file: f } })
                .then(function () { return api('/api/state'); })
                .then(function (s) {
                  state = normalizeState(s) || state;
                  if (!findWorkflow(ui.selectedId)) {
                    ui.selectedId = state.workflows.length ? state.workflows[0].id : null;
                    saveUi();
                  }
                  renderAll();
                  c.close();
                  toast('已恢复到该备份', 'ok');
                })
                .catch(function (e) { toast('恢复失败：' + e.message, 'err'); });
            });
        });
      });
    }).catch(function (e) {
      var list = $('#bList', c.modal);
      if (list) list.innerHTML = '<div class="wf-empty-hint" style="padding:14px">读取失败：' + esc(e.message) + '</div>';
    });
  }

  /* =========================================================
     连接状态 & 设置
     ========================================================= */

  function updateConnBadge(info) {
    var el = $('#connBadge');
    if (!el) return;
    if (info && info.mode === 'remote') {
      el.className = 'conn-badge remote';
      el.textContent = '🟢 ' + (info.serverUrl || '').replace(/^https?:\/\//, '');
      el.title = '已连接电脑，点开设置可切换';
    } else {
      el.className = 'conn-badge local';
      el.textContent = '⚪ 离线模式';
      el.title = '数据存在手机本地，点开设置可连接电脑';
    }
  }

  function openSettingsModal() {
    var isRemote = window.Storage.mode === 'remote';
    var saved = window.Storage.serverUrl || window.Storage.readServerUrl() || '';

    var body =
      '<div class="field">' +
        '<label>数据存放位置</label>' +
        '<div class="seg" id="setMode">' +
          '<button type="button" data-v="local"' + (!isRemote ? ' class="on"' : '') + '>⚪ 离线模式</button>' +
          '<button type="button" data-v="remote"' + (isRemote ? ' class="on"' : '') + '>🟢 连电脑</button>' +
        '</div>' +
        '<div class="hint">' +
          '<b>离线模式</b>：数据存在手机里，出门也能用，但和电脑不同步。<br>' +
          '<b>连电脑</b>：数据存在电脑上，手机和电脑看到的是同一份。' +
        '</div>' +
      '</div>' +

      '<div class="field" id="srvField" style="' + (isRemote ? '' : 'display:none') + '">' +
        '<label>电脑地址</label>' +
        '<input class="input input-mono" id="setUrl" placeholder="192.168.66.252:8317" value="' + esc(saved) + '">' +
        '<div class="hint">' +
          '在电脑上双击 start.bat，黑色窗口里会打印「手机访问 : http://x.x.x.x:8317」，' +
          '把 x.x.x.x:8317 填到这里。' +
        '</div>' +
        '<div style="margin-top:9px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
          '<button class="btn btn-soft btn-sm" id="setTest">测试连接</button>' +
          '<span id="setResult" style="font-size:12px;color:var(--text-faint)"></span>' +
        '</div>' +
      '</div>' +

      '<div class="divider">当前状态</div>' +
      '<div class="backup-row" style="border:none;background:transparent;padding:4px 0">' +
        '<span style="font-size:12.5px;color:var(--text-dim)">' +
          (isRemote
            ? '已连接 <b>' + esc(saved) + '</b>，保存会自动同步到电脑。'
            : '离线模式，数据存在本机浏览器存储里。') +
        '</span>' +
      '</div>';

    openModal({
      title: '设置',
      body: body,
      onReady: function (c) {
        var mode = isRemote ? 'remote' : 'local';
        var seg = $('#setMode', c.modal);
        var srvField = $('#srvField', c.modal);

        function refreshMode() {
          Array.prototype.forEach.call(seg.querySelectorAll('button'), function (b) {
            b.classList.toggle('on', b.getAttribute('data-v') === mode);
          });
          srvField.style.display = mode === 'remote' ? '' : 'none';
        }

        Array.prototype.forEach.call(seg.querySelectorAll('button'), function (b) {
          b.addEventListener('click', function () {
            mode = b.getAttribute('data-v');
            refreshMode();
          });
        });

        var testBtn = $('#setTest', c.modal);
        var resultEl = $('#setResult', c.modal);
        testBtn.addEventListener('click', function () {
          var raw = $('#setUrl', c.modal).value.trim();
          if (!raw) { resultEl.textContent = '请填写地址'; resultEl.style.color = 'var(--danger)'; return; }
          var url = /^https?:/.test(raw) ? raw : ('http://' + raw);
          resultEl.textContent = '测试中…';
          resultEl.style.color = 'var(--text-faint)';
          window.Storage.probeUrl(url).then(function (p) {
            resultEl.textContent = '✓ 连接成功' + (p.port ? '（端口 ' + p.port + '）' : '');
            resultEl.style.color = 'var(--ok)';
          }).catch(function (e) {
            resultEl.textContent = '✗ ' + (e.message || '连接失败');
            resultEl.style.color = 'var(--danger)';
          });
        });

        var cancel = document.createElement('button');
        cancel.className = 'btn btn-ghost';
        cancel.textContent = '取消';
        cancel.addEventListener('click', c.close);

        var save = document.createElement('button');
        save.className = 'btn btn-primary';
        save.textContent = '保存';
        save.addEventListener('click', function () {
          if (mode === 'local') {
            window.Storage.useLocal().then(function () {
              c.close();
              updateConnBadge({ mode: 'local' });
              return window.Storage.getState();
            }).then(function (s) {
              state = normalizeState(s) || state;
              if (!findWorkflow(ui.selectedId)) {
                ui.selectedId = state.workflows.length ? state.workflows[0].id : null;
                saveUi();
              }
              renderAll();
              toast('已切换到离线模式', 'ok');
            }).catch(function (e) { toast('切换失败：' + e.message, 'err'); });
            return;
          }

          var raw = $('#setUrl', c.modal).value.trim();
          if (!raw) { toast('请填写电脑地址', 'err'); return; }
          var url = /^https?:/.test(raw) ? raw : ('http://' + raw);

          window.Storage.useRemote(url).then(function () {
            c.close();
            updateConnBadge({ mode: 'remote', serverUrl: url });
            return window.Storage.getState();
          }).then(function (s) {
            state = normalizeState(s) || state;
            if (!findWorkflow(ui.selectedId)) {
              ui.selectedId = state.workflows.length ? state.workflows[0].id : null;
              saveUi();
            }
            renderAll();
            toast('已连接电脑', 'ok');
          }).catch(function (e) {
            toast('连接失败：' + (e.message || '未知错误'), 'err');
          });
        });

        c.foot.appendChild(cancel);
        c.foot.appendChild(save);
      }
    });
  }

  /* =========================================================
     移动端侧栏
     ========================================================= */

  function toggleSidebar(force) {
    var side = $('#sidebar');
    if (!side) return;
    var open = typeof force === 'boolean' ? force : !side.classList.contains('open');
    side.classList.toggle('open', open);
    ui.sidebarOpen = open;
    var bd = $('.backdrop');
    if (open && !bd) {
      bd = document.createElement('div');
      bd.className = 'backdrop show';
      bd.addEventListener('click', function () { toggleSidebar(false); });
      document.body.appendChild(bd);
    } else if (bd) {
      bd.classList.toggle('show', open);
      if (!open && bd.parentNode) bd.parentNode.removeChild(bd);
    }
  }

  /* =========================================================
     初始化
     ========================================================= */

  function bindGlobal() {
    $('#btnNew').addEventListener('click', function () { openWorkflowModal(null); });
    $('#btnBackup').addEventListener('click', openBackupModal);
    var btnSet = $('#btnSettings');
    if (btnSet) btnSet.addEventListener('click', openSettingsModal);
    $('#btnTheme').addEventListener('click', function () {
      ui.theme = ui.theme === 'dark' ? 'light' : 'dark';
      applyTheme();
      saveUi();
    });
    $('#btnToggleSide').addEventListener('click', function () { toggleSidebar(); });

    var search = $('#search');
    var timer = null;
    search.addEventListener('input', function () {
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () {
        ui.query = search.value.trim();
        renderSidebar();
      }, 160);
    });

    $('#wfList').addEventListener('click', function (ev) {
      var item = ev.target.closest ? ev.target.closest('.wf-item') : null;
      if (!item) return;

      var act = ev.target.getAttribute && ev.target.getAttribute('data-act');
      if (act === 'pin') {
        ev.stopPropagation();
        togglePin(item.getAttribute('data-id'));
        return;
      }

      ui.selectedId = item.getAttribute('data-id');
      saveUi();
      renderAll();
      if (window.innerWidth <= 820) toggleSidebar(false);
    });

    /* 全局快捷键 */
    document.addEventListener('keydown', function (ev) {
      var tag = (ev.target.tagName || '').toLowerCase();
      var typing = tag === 'input' || tag === 'textarea' || tag === 'select';
      if (ev.ctrlKey && ev.key.toLowerCase() === 's') {
        ev.preventDefault();
        scheduleSave();
        toast('已保存', 'ok');
        return;
      }
      if (typing) return;
      if (ev.key === 'n' && !ev.ctrlKey && !ev.metaKey) {
        ev.preventDefault();
        if (currentWorkflow()) openStepModal(ui.selectedId, null);
        else openWorkflowModal(null);
      }
    });
  }

  function boot() {
    loadUi();
    applyTheme();
    bindGlobal();

    if (!window.Storage) {
      setSaveState('error', '加载失败');
      var box = $('#content');
      if (box) box.innerHTML = '<div class="empty-state"><div class="big">⚠</div><h2>数据层未加载</h2><p>storage.js 没有正确引入。</p></div>';
      return;
    }

    window.Storage.init()
      .then(function (info) {
        updateConnBadge(info);
        if (info.fellBack) {
          toast('连不上电脑（' + (info.error || '') + '），已切到离线模式', 'err');
        }
        return window.Storage.getState();
      })
      .then(function (s) {
        state = normalizeState(s);
        if (!state) throw new Error('数据格式异常');
        if (!findWorkflow(ui.selectedId)) {
          ui.selectedId = state.workflows.length ? state.workflows[0].id : null;
          saveUi();
        }
        renderAll();
      })
      .catch(function (e) {
        setSaveState('error', '加载失败');
        console.error('[boot error]', e);
        var isNetwork = /Failed to fetch|NetworkError|ERR_CONNECTION/i.test(e.message || '');
        $('#content').innerHTML =
          '<div class="empty-state"><div class="big">⚠</div>' +
          '<h2>' + (isNetwork ? '无法连接后端' : '界面加载出错') + '</h2>' +
          '<p>' + esc(e.message || '未知错误') + '</p>' +
          '<p style="font-size:12.5px">' +
            (isNetwork
              ? '请确认 server.js 正在运行。'
              : '请打开浏览器控制台（F12）查看详细堆栈，或反馈给开发者。') +
          '</p></div>';
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

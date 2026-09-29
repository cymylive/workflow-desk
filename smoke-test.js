'use strict';
const http = require('http');
const { spawn } = require('child_process');

const child = spawn(process.execPath, ['server.js'], { cwd: __dirname, stdio: 'ignore' });

function req(method, path, body) {
  return new Promise(function (resolve, reject) {
    const data = body ? Buffer.from(body) : null;
    const r = http.request({
      host: '127.0.0.1', port: 8317, method: method, path: path,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}
    }, function (res) {
      let buf = '';
      res.on('data', function (c) { buf += c; });
      res.on('end', function () { resolve({ code: res.statusCode, body: buf }); });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

(async function () {
  await wait(1200);
  const results = [];
  function check(name, cond, extra) {
    results.push((cond ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  -> ' + extra : ''));
  }

  try {
    const idx = await req('GET', '/');
    check('GET / 返回 HTML', idx.code === 200 && idx.body.indexOf('工作流工具台') >= 0, 'HTTP ' + idx.code);

    const css = await req('GET', '/style.css');
    check('GET /style.css', css.code === 200 && css.body.indexOf('.step') >= 0, 'HTTP ' + css.code);

    const js = await req('GET', '/app.js');
    check('GET /app.js', js.code === 200 && js.body.indexOf('openWorkflowModal') >= 0, 'HTTP ' + js.code);

    const trav = await req('GET', '/../server.js');
    check('路径穿越被拦截', trav.code === 403 || trav.code === 404, 'HTTP ' + trav.code);

    const s1 = await req('GET', '/api/state');
    const st1 = JSON.parse(s1.body);
    check('GET /api/state 有 workflows 数组', Array.isArray(st1.workflows), st1.workflows.length + ' 个');

    st1.workflows.push({
      id: 'test0001', name: '冒烟测试工作流', version: '0.0.1', goal: '验证 CRUD',
      status: 'developing', tags: ['test'], createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      steps: [{ id: 's1', title: 'A', desc: 'aa', note: 'nn', status: 'pending' }]
    });
    const put = await req('PUT', '/api/state', JSON.stringify(st1));
    check('PUT /api/state 成功', put.code === 200, 'HTTP ' + put.code);

    const s2 = await req('GET', '/api/state');
    const st2 = JSON.parse(s2.body);
    check('写入后能读回', st2.workflows.some(function (w) { return w.id === 'test0001'; }), st2.workflows.length + ' 个');

    const exp = await req('GET', '/api/export');
    check('GET /api/export 是合法 JSON', exp.code === 200 && Array.isArray(JSON.parse(exp.body).workflows), 'HTTP ' + exp.code);

    const bad = await req('PUT', '/api/state', JSON.stringify({ nope: 1 }));
    check('非法结构被拒 (400)', bad.code === 400, 'HTTP ' + bad.code);

    const bk = await req('GET', '/api/backups');
    const bko = JSON.parse(bk.body);
    check('GET /api/backups 返回列表', bk.code === 200 && Array.isArray(bko.backups), bko.backups.length + ' 份');

    const s3 = await req('GET', '/api/state');
    const st3 = JSON.parse(s3.body);
    st3.workflows = st3.workflows.filter(function (w) { return w.id !== 'test0001'; });
    await req('PUT', '/api/state', JSON.stringify(st3));
    const s4 = await req('GET', '/api/state');
    check('清理测试数据', !JSON.parse(s4.body).workflows.some(function (w) { return w.id === 'test0001'; }));

  } catch (e) {
    check('测试执行异常', false, e.message);
  }

  console.log(results.join('\n'));
  const failed = results.filter(function (r) { return r.indexOf('FAIL') === 0; }).length;
  console.log('');
  console.log(failed ? (failed + ' 项失败') : '全部通过');

  child.kill();
  setTimeout(function () { process.exit(failed ? 1 : 0); }, 200);
})();

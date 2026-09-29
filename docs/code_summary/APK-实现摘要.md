# 工作流工具台 · APK 实现摘要

> 阶段：工程师（Engineer）+ 测试（QA）
> 上游产物：docs/task/TASKS-APK.md

---

## 交付内容

| 文件 | 状态 | 说明 |
|---|---|---|
| `public/storage.js` | 新增 | 数据层适配器，Local/Remote 双实现 |
| `public/app.js` | 改 | `api()` 改为 Storage 路由；新增设置弹窗；boot 改 Storage.init |
| `public/index.html` | 改 | 引入 storage.js；加连接徽章与设置按钮 |
| `public/style.css` | 改 | 连接徽章样式 |
| `package.json` | 新增 | Capacitor 依赖与脚本 |
| `capacitor.config.json` | 新增 | appId/appName/webDir，开启 cleartext 与 CapacitorHttp |
| `android/` | 新增 | Capacitor 生成的工程 |
| `android/app/src/main/AndroidManifest.xml` | 改 | 加 `usesCleartextTraffic="true"` |
| `.github/workflows/build-apk.yml` | 新增 | CI 编译 APK |
| `.gitignore` | 改 | 排除构建产物与本地数据 |
| `README.md` | 改 | 加 APK 章节 |

---

## 核心技术决策

### 1. 双适配器模式

```js
Storage.adapter = LocalAdapter   // localStorage
             或 RemoteAdapter   // HTTP 到电脑
```

上层 `app.js` 只调 `Storage.getState()` 等接口，不关心数据在哪。

### 2. 环境自适应（关键）

`Storage.init()` 的决策树：

```
浏览器打开（!isNativeApp）
  → 自动连当前 origin（即本机 server.js）→ RemoteAdapter
  → 探测失败 → LocalAdapter 兜底

APK 打开（isNativeApp）
  → 有保存的服务器地址 → 探测 → RemoteAdapter / 失败降级 Local
  → 无地址 → LocalAdapter
```

**好处**：电脑端零配置、行为不变；APK 默认离线可用。

### 3. Android 三重放行

局域网是 http，Android 9+ 默认拦截明文流量。三重保险：

| 层 | 配置 |
|---|---|
| WebView | `allowMixedContent: true` |
| 请求 | `CapacitorHttp.enabled: true`（原生发请求，绕过 CORS） |
| 系统 | `usesCleartextTraffic="true"` |

---

## 测试结果

| 项 | 结果 |
|---|---|
| `node --check` 三个 JS 文件 | 全部通过 |
| 浏览器打开 → 自动连本机 | 🟢 127.0.0.1:8317，数据源 remote ✓ |
| 离线模式 CRUD | 新建/保存/刷新后仍在 ✓ |
| 设置弹窗渲染 | 模式切换、地址输入、测试按钮齐全 ✓ |
| YAML 结构检查 | 78 行，关键字段齐全，`${{ }}` 配对 ✓ |
| android/ 生成 | 结构完整，applicationId 正确 ✓ |
| AndroidManifest cleartext | 已加 ✓ |

---

## 遇到的坑

### `edit` 工具吞 `$$`

工具的替换串里 `$$` 被 JS `String.replace` 转义成 `$`，导致 `$$('...')` 写成 `$('...')` 却报告成功。

**应对**：涉及 `$$` 的改动一律走 Node 脚本 `s.split(needle).join(repl)`（不做转义），改完用 `read` 或 `findstr` 回读验证。

### boot() 替换失败一次

初次 patch 时依赖的文本片段与实际文件不符（缩进/换行差异）。**应对**：改用更短的锚点 + 先 `read` 确认真实内容再改。

---

## 遗留与后续

| 项 | 状态 |
|---|---|
| iOS 支持 | 未做（只需 `npx cap add ios` + Mac 构建） |
| 应用签名（release 版） | 未做（当前是 debug 版，自用够） |
| 离线模式数据迁移到连电脑 | 未做（需手动导出/导入） |
| 局域网自动发现 | 未做（手动填地址） |
| PWA 离线缓存 | 未做 |

---

## 复现步骤

```bash
# 电脑端
双击 start.bat                    # 访问 http://localhost:8317

# 前端语法检查
node --check public/app.js
node --check public/storage.js

# 后端接口测试
node smoke-test.js

# 同步到 Android 工程
npx cap sync android

# 推送触发 CI 编译
git push
```

# 工作流工具台 · APK 版系统设计

> 阶段：架构师（Architect）
> 版本：v1.0
> 状态：已完成
> 上游产物：docs/prd/PRD-APK.md

---

## 一、总体架构

```
┌──────────────────── 电脑端（已存在，保留） ────────────────────┐
│  server.js  ──  读写 data/workflows.json                       │
│  监听 0.0.0.0:8317  ──  同时提供 public/ 静态文件               │
└────────────────────────────────────────────────────────────────┘
                          ▲  HTTP /api/*
                          │  局域网
                          │
┌──────────────────── 手机端 APK（新建） ────────────────────────┐
│  Capacitor 壳（Android WebView）                               │
│    └── 内嵌 public/（与电脑端同一份前端代码）                    │
│                                                                 │
│  数据层（本次核心改造）：                                        │
│    ┌─ RemoteAdapter  → fetch 到电脑 :8317                      │
│    └─ LocalAdapter   → localStorage（离线模式）                 │
└────────────────────────────────────────────────────────────────┘
```

**关键决策：前端代码只有一份。** 电脑端和 APK 共用 `public/`，通过在数据层做适配器切换数据源。

---

## 二、数据层改造（核心）

### 2.1 现状问题

`public/app.js` 里所有请求都是相对路径：

```js
api('/api/state')   // 电脑端 OK：→ http://localhost:8317/api/state
                    // APK 里 ×：→ https://localhost/api/state（WebView 自己，404）
```

### 2.2 改造方案：Adapter 模式

新增 `public/storage.js`，暴露统一接口：

```js
Storage.getState()            → Promise<State>
Storage.putState(state)       → Promise<void>
Storage.listBackups()         → Promise<Backup[]>
Storage.restoreBackup(file)   → Promise<void>
Storage.exportData()          → Promise<{filename, content}>
Storage.importData(json)      → Promise<void>
Storage.probe(serverUrl)      → Promise<{ok, ips, port}>
```

两个实现：

| 实现 | 触发条件 | 数据落点 |
|---|---|---|
| `RemoteAdapter` | 用户配置了电脑地址且探测通过 | 电脑 `data/workflows.json` |
| `LocalAdapter` | 未配置 / 探测失败 / 用户手动选离线 | 手机 `localStorage` |

`app.js` 里原来的 `api(path, opts)` 改为调用 `Storage.*`。

### 2.3 离线模式的数据结构

```js
localStorage['workflow-desk:state']   = JSON.stringify(state)
localStorage['workflow-desk:backups'] = JSON.stringify([{file, time, content}])
localStorage['workflow-desk:server']  = 'http://192.168.66.252:8317'  // 空=离线
```

自动备份在离线模式下：每次保存前把旧 state 压入 backups 数组，**保留最近 10 份**（localStorage 有 5MB 上限，10 份够用且安全）。

### 2.4 模式切换流程

```
启动
 ├─ 读 localStorage 的 server 配置
 ├─ 有配置 → probe(server)
 │    ├─ 成功 → RemoteAdapter（顶栏显示 🟢 已连接 192.168.x.x）
 │    └─ 失败 → 弹提示「连不上电脑，已切到离线模式」，用 LocalAdapter
 └─ 无配置 → LocalAdapter（离线）
```

---

## 三、目录结构

```
工作流开发工具台/
├── server.js                  # 电脑端后端（不动）
├── start.bat                  # 电脑端启动（不动）
├── package.json               # 【新增】Capacitor 依赖与脚本
├── capacitor.config.json      # 【新增】Capacitor 配置
├── .github/
│   └── workflows/
│       └── build-apk.yml      # 【新增】CI
├── public/                    # 前端（两端共用）
│   ├── index.html             # 【改】引入 storage.js
│   ├── style.css              # 【改】加设置页与连接状态样式
│   ├── app.js                 # 【改】api() 改为走 Storage
│   ├── storage.js             # 【新增】数据层适配器
│   └── manifest.webmanifest
├── android/                   # 【新增】Capacitor 生成的 Android 工程
│   └── app/src/main/AndroidManifest.xml   # 【改】加明文 HTTP 权限
├── data/                      # 电脑端数据（.gitignore）
├── backups/                   # 电脑端备份（.gitignore）
├── docs/                      # SOP 产物
│   ├── prd/PRD-APK.md
│   ├── system_design/SYSTEM-DESIGN-APK.md
│   ├── task/TASKS-APK.md
│   └── code_summary/
└── README.md                  # 【改】加 APK 章节
```

---

## 四、关键技术决策

| # | 决策 | 选择 | 理由 |
|---|---|---|---|
| A1 | 打包框架 | Capacitor 8.5.2 | 复用现有 Web 前端，不重写；Node 24 满足要求 |
| A2 | WebView Scheme | `https` + `allowMixedContent: true` | 保持默认安全策略，只对局域网 HTTP 放行 |
| A3 | HTTP 请求方式 | 启用 `CapacitorHttp` 插件 | 绕过 WebView CORS/mixed-content，原生发请求更稳 |
| A4 | 明文流量 | `usesCleartextTraffic="true"` | 局域网是 http，不加这条 Android 9+ 直接拦 |
| A5 | 离线存储 | `localStorage` | 零依赖、够用；后续需要再换 Filesystem |
| A6 | 备份导出 | P0 用 JSON 文本复制 + Blob 下载双通道 | 避免早期引入 Filesystem 插件复杂度 |
| A7 | CI | GitHub Actions + `actions/setup-java@v4` + `gradle` | 公开仓库分钟数无限 |
| A8 | 编译产物 | `assembleDebug`（P0） | 自用无需签名；后续要发布再加 keystore |
| A9 | 触发条件 | push main / tag v* / 手动 | tag 时额外创建 Release |

---

## 五、接口契约

前端与后端之间保持**现有 HTTP 接口不变**（见 README），`RemoteAdapter` 直接复用。

`LocalAdapter` 内部把同样的接口映射到 localStorage：

| 接口 | 离线实现 |
|---|---|
| `GET /api/state` | 读 `workflow-desk:state`，无则返回示例数据 |
| `PUT /api/state` | 写入前把旧值压入 backups（上限 10），再写新值 |
| `GET /api/export` | 生成 Blob 下载 |
| `POST /api/import` | 解析后写入 |
| `GET /api/backups` | 读 backups 数组的元信息 |
| `POST /api/backups/restore` | 从 backups 数组取指定项覆盖 |

---

## 六、Android 工程配置要点

```json
// capacitor.config.json
{
  "appId": "com.cymylive.workflowdesk",
  "appName": "工作流工具台",
  "webDir": "public",
  "server": {
    "androidScheme": "https",
    "allowMixedContent": true,
    "cleartext": true
  },
  "plugins": {
    "CapacitorHttp": { "enabled": true }
  }
}
```

`AndroidManifest.xml` 需确认：
```xml
<uses-permission android:name="android.permission.INTERNET" />
<application android:usesCleartextTraffic="true" ...>
```

---

## 七、构建流程

### 本地（可选，验证用）
```bash
npm install
npx cap add android      # 首次生成 android/
npx cap sync android     # 每次改完前端同步
npx cap open android     # 打开 Android Studio（本机没装，跳过）
```

### CI（主要方式）
```
push / tag
  → checkout
  → setup-node 24
  → setup-java 21
  → npm ci
  → npx cap sync android
  → cd android && ./gradlew assembleDebug
  → upload-artifact: app-debug.apk
  → （tag 时）创建 Release 并上传 APK
```

**本机不需要装 Android SDK** —— 全部在 GitHub 的机器上完成。

---

## 八、风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| 局域网 IP 变化 | 手机连不上 | 设置页可随时改；电脑启动打印当前 IP |
| Mixed content 被拦 | 请求全失败 | 三重保险：allowMixedContent + CapacitorHttp + cleartext |
| localStorage 5MB 上限 | 数据存不下 | 单条工作流纯文本，几十个也只占几百 KB；超限时提示导出 |
| Gradle 首次下载慢 | CI 超时 | 公开仓库不限时；加 Gradle 缓存 |
| Capacitor 生成 android/ 体积大 | 仓库臃肿 | 只提交必要文件，build 产物 .gitignore |
| 手机上导出文件找不到 | 用户困惑 | P0 提供「复制到剪贴板」+「下载」两条路 |

---

## 九、验收标准映射

| PRD 编号 | 设计对应 | 验证方式 |
|---|---|---|
| F1 内嵌界面 | webDir=public | 断网打开 APP，界面正常显示 |
| F2 地址配置 | 设置页 + probe() | 填入地址点测试，显示成功/失败 |
| F3 双模式 | Storage 适配器 | 配置前后行为切换正确 |
| F4 本地持久化 | localStorage | 关 APP 重开，数据还在 |
| F5 备份导出导入 | Blob + JSON 解析 | 导出文件能被导入还原 |
| F6 局域网发现 | probe 返回 ips | 提示可尝试的地址 |
| F7 CI | build-apk.yml | push 后 Actions 产出 APK |

# 工作流工具台 · APK 版任务清单

> 阶段：项目经理（ProjectManager）
> 上游产物：docs/prd/PRD-APK.md、docs/system_design/SYSTEM-DESIGN-APK.md

---

## 任务依赖图

```
T1 前端数据层适配器 ──┬──→ T4 Android 工程配置 ──┐
                     │                          ├──→ T6 CI 工作流 ──→ T7 推送构建
T2 设置页 UI ────────┘                          │
                                                │
T3 npm 依赖与 Capacitor 配置 ───────────────────┘

T8 文档更新（README）── 可与 T6 并行
```

---

## 任务明细

### T1 · 前端数据层适配器 `public/storage.js`
**优先级**：P0 · **依赖**：无 · **预估**：核心

- [ ] T1.1 定义统一接口（getState/putState/listBackups/restoreBackup/exportData/importData/probe）
- [ ] T1.2 实现 `LocalAdapter`：localStorage 读写 + 自动备份（上限 10 份）
- [ ] T1.3 实现 `RemoteAdapter`：fetch 到电脑，复用现有接口
- [ ] T1.4 实现 `Storage.init()`：读配置 → probe → 选适配器 → 降级逻辑
- [ ] T1.5 首次启动无数据时，返回示例工作流

**完成标志**：`node --check` 通过；两个适配器接口行为一致

---

### T2 · 设置页 UI（连电脑 / 离线模式）
**优先级**：P0 · **依赖**：T1

- [ ] T2.1 顶栏加连接状态指示（🟢 已连接 192.168.x.x / ⚪ 离线模式）
- [ ] T2.2 新建设置弹窗：服务器地址输入 + 「测试连接」按钮 + 模式说明
- [ ] T2.3 切换模式时重新初始化 Storage 并重绘
- [ ] T2.4 连不上电脑时的提示与降级确认
- [ ] T2.5 设置页样式（移动端友好）

**完成标志**：能在界面上切换模式，状态指示正确

---

### T3 · 前端接入 Storage
**优先级**：P0 · **依赖**：T1

- [ ] T3.1 `index.html` 引入 `storage.js`（在 app.js 之前）
- [ ] T3.2 `app.js` 的 `api()` 替换为 Storage 调用
- [ ] T3.3 导出/导入改走 Storage（兼容 Blob 与文本两条路）
- [ ] T3.4 备份面板适配离线模式（10 份 vs 50 份）

**完成标志**：前端不再直接 fetch `/api/*`

---

### T4 · Capacitor 工程配置
**优先级**：P0 · **依赖**：T3 完成 + T3 npm install 完成

- [ ] T4.1 `npx cap add android` 生成 android/ 工程
- [ ] T4.2 检查 `AndroidManifest.xml`：INTERNET 权限、usesCleartextTraffic
- [ ] T4.3 `.gitignore` 排除 android 构建产物
- [ ] T4.4 `npx cap sync android` 同步前端

**完成标志**：android/ 目录生成，manifest 配置正确

---

### T5 · GitHub Actions CI
**优先级**：P0 · **依赖**：T4

- [ ] T5.1 写 `.github/workflows/build-apk.yml`
- [ ] T5.2 触发条件：push main / tag v* / workflow_dispatch
- [ ] T5.3 步骤：checkout → setup-node 24 → setup-java 21 → npm ci → cap sync → gradlew assembleDebug
- [ ] T5.4 上传 APK 为 artifact
- [ ] T5.5 tag 时创建 Release 并附加 APK

**完成标志**：YAML 语法正确，本地无法验证需推送后看

---

### T6 · 仓库初始化与推送
**优先级**：P0 · **依赖**：T5

- [ ] T6.1 `git init -b main`
- [ ] T6.2 确认 `.gitignore` 完整（node_modules/data/backups/android/build）
- [ ] T6.3 首次提交
- [ ] T6.4 用 token 推送到 `github.com/cymylive/workflow-desk`
- [ ] T6.5 确认 Actions 被触发

**完成标志**：仓库有代码，Actions 开始跑

---

### T7 · 文档更新
**优先级**：P1 · **依赖**：无

- [ ] T7.1 README 加「安装 APK」章节
- [ ] T7.2 README 加「手机连电脑」配置说明
- [ ] T7.3 写 `docs/code_summary/APK-实现摘要.md`

**完成标志**：新用户能照文档操作

---

## 质量门禁

| 阶段 | 门禁 |
|---|---|
| T1 完成 | `node --check public/storage.js` 通过 |
| T3 完成 | 前端无残留 `fetch('/api` |
| T4 完成 | android/ 存在，manifest 含 cleartext |
| T5 完成 | YAML 能被解析 |
| T6 完成 | Actions 显示 success |
| 整体 | 手机装上 APK 能用（用户验收） |

---

## 执行顺序

1. **T1** → **T2** → **T3**（前端改造，可本地验证）
2. **T4** → **T5**（Capacitor + CI）
3. **T6**（推送）
4. **T7**（文档，随时可做）

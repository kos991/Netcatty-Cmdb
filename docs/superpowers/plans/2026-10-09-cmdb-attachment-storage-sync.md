# Cmdb 附件存储目录与云同步实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为每个 Cmdb 项目提供可选附件目录、带校验的旧附件迁移，并通过 Netcatty 现有 S3 配置实现自动补传和异机按需下载。

**Architecture:** Go 后端负责项目本机目录、附件路径解析、迁移和 SHA-256 校验；渲染进程使用 Netcatty 已解锁派生主密钥包裹每附件随机内容密钥；Electron 主进程使用临时内容密钥流式 AES-256-GCM 加密后上传 S3，并在下载时流式解密。Cmdb 前端不直接访问文件系统或 S3 密钥，附件元数据继续进入 Cmdb 加密快照，绝对目录、明文内容密钥与附件二进制不进入快照。

**Tech Stack:** Go、SQLite、React、Electron IPC、Node.js streams、Netcatty CloudSync S3、Node test、Go test。

---

## 文件职责

- `internal/store/project_schema.go`：项目附件目录字段迁移和项目模型。
- `internal/store/project_scope.go`：项目目录字段读取；普通项目资料更新不能覆盖本机目录。
- `internal/store/attachment_storage.go`：项目目录解析、状态统计、迁移、回滚和哈希校验。
- `internal/store/work_order_attachments.go`：所有附件读写改用项目目录解析器。
- `internal/server_attachment_storage.go`：目录状态、迁移预检、迁移执行、恢复默认接口。
- `internal/server_work_order_attachments.go`：待补传列表和云端文件本地化接口。
- `integrations/netcatty/electron/cmdbBridge.cjs`：原生目录选择、附件补传和按需下载的受控 IPC。
- `integrations/netcatty/electron/cmdbAttachmentCloud.cjs`：复用 Netcatty S3 客户端的附件流式上传、下载与哈希校验。
- `integrations/netcatty/cmdb/core/transport.js`：渲染进程最小桥接封装和同步触发。
- `integrations/netcatty/cmdb/api.js`：附件目录与云同步 API。
- `integrations/netcatty/cmdb/ConfigCenter.jsx`：附件存储状态、目录选择和迁移确认界面。
- `integrations/netcatty/cmdb/WorkOrders.jsx`：附件云状态和按需下载操作。
- `integrations/netcatty/CmdbAttachmentCloudSync.ts`：读取 Netcatty 当前 S3 连接并触发补传，不保存第二份密钥。
- `scripts/prepare-netcatty.mjs`：复制新增集成文件，注册桥接并补充 preload/global 类型。

### Task 1：项目本机附件目录字段

**Files:**
- Modify: `internal/store/project_schema.go`
- Modify: `internal/store/project_scope.go`
- Test: `internal/store/project_schema_test.go`
- Test: `internal/store/project_scope_test.go`
- Test: `internal/store/cmdb_snapshot_test.go`

- [ ] **Step 1: 写失败测试，证明目录按项目保存且不进入快照**

在项目测试中增加：

```go
func TestCmdbProjectAttachmentRootIsLocalPerProject(t *testing.T) {
    st := newTestStore(t)
    project, err := st.CreateCmdbProject(&CmdbProject{Code: "p2", Name: "项目二"})
    if err != nil { t.Fatal(err) }
    if err := st.UpdateProjectAttachmentRoot(project.ID, `D:\\cmdb-files\\p2`); err != nil { t.Fatal(err) }
    got, err := st.GetCmdbProject(project.ID)
    if err != nil { t.Fatal(err) }
    if got.AttachmentRoot != `D:\\cmdb-files\\p2` { t.Fatalf("attachment_root=%q", got.AttachmentRoot) }
}
```

在快照测试中断言 `cmdb_projects` 不属于同步集合，且任一集合 JSON 均不包含 `attachment_root`。

同时为 `cmdb_work_order_attachments` 增加并测试 `cloud_object_id`、`encryption_version`、`wrapped_key`、`wrapped_key_iv` 和 `data_iv`。这些字段可以进入快照；原始内容密钥不得落库。

- [ ] **Step 2: 运行测试并确认失败原因是字段或方法不存在**

Run: `go test ./internal/store -run "TestCmdbProjectAttachmentRootIsLocalPerProject|TestExportCmdbSnapshot" -count=1`

Expected: FAIL，提示 `AttachmentRoot` 或 `UpdateProjectAttachmentRoot` 未定义。

- [ ] **Step 3: 增加本机字段和专用更新方法**

将项目模型扩展为：

```go
type CmdbProject struct {
    ID             int64  `json:"id"`
    SyncID         string `json:"sync_id"`
    Code           string `json:"code"`
    Name           string `json:"name"`
    AttachmentRoot string `json:"attachment_root"`
    Revision       int64  `json:"revision"`
    CreatedAt      string `json:"created_at"`
    UpdatedAt      string `json:"updated_at"`
    DeletedAt      string `json:"deleted_at"`
}
```

迁移使用 `addMissingColumns(tx, "cmdb_projects", map[string]string{"attachment_root": "TEXT NOT NULL DEFAULT ''"})`。所有项目查询补充 `COALESCE(attachment_root, '')`；普通 `UpdateCmdbProject` 只更新编码和名称，目录由独立方法更新：

```go
func (s *Store) UpdateProjectAttachmentRoot(projectID int64, root string) error {
    result, err := s.db.Exec(`UPDATE cmdb_projects
        SET attachment_root=?, updated_at=?
        WHERE id=? AND deleted_at IS NULL`, strings.TrimSpace(root), time.Now().UTC().Format(time.RFC3339Nano), projectID)
    if err != nil { return err }
    return requireAffected(result, "项目不存在或已删除")
}
```

附件表迁移增加：

```go
attachmentCryptoColumns := map[string]string{
    "cloud_object_id": "TEXT NOT NULL DEFAULT ''",
    "encryption_version": "INTEGER NOT NULL DEFAULT 0",
    "wrapped_key": "TEXT NOT NULL DEFAULT ''",
    "wrapped_key_iv": "TEXT NOT NULL DEFAULT ''",
    "data_iv": "TEXT NOT NULL DEFAULT ''",
}
```

- [ ] **Step 4: 运行项目与快照测试**

Run: `go test ./internal/store -run "Project|Snapshot" -count=1`

Expected: PASS。

- [ ] **Step 5: 提交项目字段改动**

```powershell
git add internal/store/project_schema.go internal/store/project_scope.go internal/store/project_schema_test.go internal/store/project_scope_test.go internal/store/cmdb_snapshot_test.go
git commit -m "feat(store): 支持项目独立附件目录"
```

### Task 2：目录解析、迁移与回滚

**Files:**
- Create: `internal/store/attachment_storage.go`
- Create: `internal/store/attachment_storage_test.go`
- Modify: `internal/store/work_order_attachments.go`
- Test: `internal/store/project_scope_cmdb_test.go`

- [ ] **Step 1: 写失败测试覆盖默认目录、项目隔离和迁移回滚**

测试期望接口：

```go
status, err := st.GetAttachmentStorageStatus(scope)
preview, err := st.PreflightAttachmentStorageMigration(scope, target)
result, err := st.MigrateAttachmentStorage(scope, target)
```

测试至少断言：

```go
if status.EffectiveRoot == "" || status.UsesDefault == false { t.Fatalf("unexpected status: %#v", status) }
if preview.FileCount != 1 || preview.SizeBytes != int64(len("evidence")) { t.Fatalf("unexpected preview: %#v", preview) }
if result.MigratedFiles != 1 { t.Fatalf("migrated=%d", result.MigratedFiles) }
if got, _ := os.ReadFile(filepath.Join(target, relativePath)); string(got) != "evidence" { t.Fatalf("migrated content=%q", got) }
```

另建一个损坏源文件或注入复制失败，断言迁移返回错误、`attachment_root` 未变化、原附件仍可读取。

- [ ] **Step 2: 运行测试确认缺少存储服务**

Run: `go test ./internal/store -run "AttachmentStorage|WorkOrderAttachment" -count=1`

Expected: FAIL，提示状态和迁移方法未定义。

- [ ] **Step 3: 实现统一目录解析和迁移服务**

新增结构：

```go
type AttachmentStorageStatus struct {
    ConfiguredRoot string `json:"configured_root"`
    EffectiveRoot  string `json:"effective_root"`
    UsesDefault    bool   `json:"uses_default"`
    Writable       bool   `json:"writable"`
    FileCount      int64  `json:"file_count"`
    SizeBytes      int64  `json:"size_bytes"`
}

type AttachmentMigrationPreview struct {
    SourceRoot string `json:"source_root"`
    TargetRoot string `json:"target_root"`
    FileCount  int64  `json:"file_count"`
    SizeBytes  int64  `json:"size_bytes"`
}
```

实现 `DefaultAttachmentRootForProject`、`AttachmentRootForProject`、`GetAttachmentStorageStatus`、`PreflightAttachmentStorageMigration` 和 `MigrateAttachmentStorage`。项目目录固定使用 `work-orders/work-order-<id>/` 与 `cas/<hash-prefix>/` 两个下级区域。旧版本继续兼容 `<数据库目录>/cmdb/attachments/project-<id>/work-order-<id>/` 和全局 CAS 路径。

目标目录先写入并删除探针文件；迁移只遍历当前项目数据库引用的附件，复制到 `.cmdb-migration-<uuid>` 临时文件并逐个计算 SHA-256。目标已有相同文件时先校验，不能覆盖无关文件；全部校验成功后将临时文件移动到最终相对路径并调用 `UpdateProjectAttachmentRoot`。任何一步失败都清理本轮创建的文件、保持旧目录配置，旧目录不删除。

- [ ] **Step 4: 将附件读写统一切到项目目录**

把 `SaveWorkOrderAttachmentForProject`、`BuildAttachmentLocalPath`、`resolveAttachmentPath`、删除和工单目录暂存逻辑统一改为接收 `ProjectScope` 并调用 `AttachmentRootForProject(scope)`。不得继续调用无项目参数的 `AttachmentRoot()` 拼全局目录。

- [ ] **Step 5: 运行附件存储测试**

Run: `go test ./internal/store -run "AttachmentStorage|WorkOrderAttachment|ProjectScope" -count=1`

Expected: PASS。

- [ ] **Step 6: 提交迁移服务**

```powershell
git add internal/store/attachment_storage.go internal/store/attachment_storage_test.go internal/store/work_order_attachments.go internal/store/project_scope_cmdb_test.go
git commit -m "feat(store): 增加附件目录迁移与校验"
```

### Task 3：附件目录与云端本地化 API

**Files:**
- Create: `internal/server_attachment_storage.go`
- Create: `internal/server_attachment_storage_test.go`
- Modify: `internal/server_work_order_attachments.go`
- Modify: `internal/server_work_order_attachment_test.go`
- Modify: `internal/server.go`

- [ ] **Step 1: 写失败的 HTTP 测试**

覆盖以下请求：

```text
GET  /api/cmdb/attachment-storage
POST /api/cmdb/attachment-storage/preflight
POST /api/cmdb/attachment-storage/migrate
POST /api/cmdb/attachment-storage/restore-default
GET  /api/cmdb/attachments/pending
PUT  /api/cmdb/work-orders/{id}/attachments/{attachment_id}/localize
```

测试断言项目头隔离、错误状态码、迁移失败不切换路径、`pending` 只返回当前项目附件、本地化请求在哈希不一致时拒绝。

- [ ] **Step 2: 运行失败测试**

Run: `go test ./internal -run "AttachmentStorage|AttachmentCloud|WorkOrderAttachment" -count=1`

Expected: FAIL，路由返回 404 或处理器未定义。

- [ ] **Step 3: 实现严格 JSON 处理器和路由**

请求体使用：

```go
type attachmentStorageTargetRequest struct { TargetRoot string `json:"target_root"` }
type localizeAttachmentRequest struct { TempToken string `json:"temp_token"` }
```

Electron 桥接先通过受控导入接口登记临时文件并取得一次性 `temp_token`；`localize` 只接受该令牌，禁止渲染进程提交任意文件路径。后端重新计算 SHA-256，与附件 `content_hash` 一致后移动到项目 CAS 目标。失败时删除临时文件和令牌，不更新附件状态。

- [ ] **Step 4: 运行接口测试**

Run: `go test ./internal -run "AttachmentStorage|AttachmentCloud|WorkOrderAttachment" -count=1`

Expected: PASS。

- [ ] **Step 5: 提交接口改动**

```powershell
git add internal/server_attachment_storage.go internal/server_attachment_storage_test.go internal/server_work_order_attachments.go internal/server_work_order_attachment_test.go internal/server.go
git commit -m "feat(api): 提供附件目录与云同步接口"
```

### Task 4：Netcatty 原生目录选择与受控 S3 桥接

**Files:**
- Create: `integrations/netcatty/electron/cmdbAttachmentCloud.cjs`
- Create: `integrations/netcatty/electron/cmdbAttachmentCloud.test.cjs`
- Modify: `integrations/netcatty/electron/cmdbBridge.cjs`
- Modify: `integrations/netcatty/electron/cmdbBridge.test.cjs`
- Modify: `scripts/prepare-netcatty.mjs`
- Modify: `scripts/prepare-netcatty.test.mjs`

- [ ] **Step 1: 写目录选择失败测试**

在 `cmdbBridge.test.cjs` 增加：

```js
test("selects an attachment directory with the native directory dialog", async () => {
  const handlers = registerTestBridge({
    dialog: {
      showOpenDialog: async (options) => {
        assert.deepEqual(options.properties, ["openDirectory", "createDirectory"]);
        return { canceled: false, filePaths: ["D:/cmdb-files/project-1"] };
      },
      showSaveDialog: async () => ({ canceled: true }),
    },
  });
  assert.deepEqual(await handlers.get(CMDB_CHANNELS.selectAttachmentDirectory)(), {
    cancelled: false,
    directoryPath: "D:/cmdb-files/project-1",
  });
});
```

- [ ] **Step 2: 写 S3 流式加密桥接失败测试**

测试 `resolveAttachmentObjectKey`、本地文件不存在、远端不存在、AES-256-GCM 加密上传、解密下载、错误密钥认证失败和临时文件清理。测试密文不能包含已知明文片段。S3 客户端、随机源和文件流通过构造参数注入，测试不连接真实网络。

- [ ] **Step 3: 运行 Electron 测试确认失败**

Run: `node --test integrations/netcatty/electron/cmdbBridge.test.cjs integrations/netcatty/electron/cmdbAttachmentCloud.test.cjs`

Expected: FAIL，频道或模块不存在。

- [ ] **Step 4: 实现受控主进程能力**

新增 IPC：

```js
selectAttachmentDirectory: "netcatty:cmdb:select-attachment-directory",
syncAttachments: "netcatty:cmdb:sync-attachments",
downloadAttachment: "netcatty:cmdb:download-attachment",
```

`cmdbAttachmentCloud.cjs` 复用 Netcatty `cloudSyncBridge.cjs` 的 `buildS3Client`，使用 `HeadObjectCommand`、`PutObjectCommand`、`GetObjectCommand`。上传路径只能来自本地 Cmdb API 的待补传记录。主进程接收单次调用的 32 字节内容密钥和 12 字节数据 IV，使用 `createCipheriv("aes-256-gcm", key, iv)` 流式加密到临时 `.nca` 文件；文件头包含固定魔数与格式版本，尾部保存 16 字节认证标签。上传结束后删除临时密文并清零密钥 Buffer。

下载先保存密文临时文件，再使用 `createDecipheriv` 流式解密。认证失败时删除所有临时文件；成功后将明文临时文件登记为一次性 `temp_token`，再调用后端 `localize` 校验 SHA-256 并入库。

- [ ] **Step 5: 更新装配脚本**

复制新增桥接文件；在 `registerBridges.cjs` 注册时向 `registerCmdbBridge` 注入 S3 附件动作；在 `electron/preload/api.cjs` 暴露：

```js
cmdbSelectAttachmentDirectory: () => ipcRenderer.invoke("netcatty:cmdb:select-attachment-directory"),
cmdbSyncAttachments: (payload) => ipcRenderer.invoke("netcatty:cmdb:sync-attachments", payload),
cmdbDownloadAttachment: (payload) => ipcRenderer.invoke("netcatty:cmdb:download-attachment", payload),
```

`global.d.ts` 增加对应类型。装配测试必须检查复制文件、preload 方法和类型声明。

- [ ] **Step 6: 运行桥接与装配测试**

Run: `node --test integrations/netcatty/electron/cmdbBridge.test.cjs integrations/netcatty/electron/cmdbAttachmentCloud.test.cjs`

Run: `node --test scripts/prepare-netcatty.test.mjs`

Expected: PASS。

- [ ] **Step 7: 提交原生桥接**

```powershell
git add integrations/netcatty/electron/cmdbAttachmentCloud.cjs integrations/netcatty/electron/cmdbAttachmentCloud.test.cjs integrations/netcatty/electron/cmdbBridge.cjs integrations/netcatty/electron/cmdbBridge.test.cjs scripts/prepare-netcatty.mjs scripts/prepare-netcatty.test.mjs
git commit -m "feat(netcatty): 增加附件目录与 S3 原生桥接"
```

### Task 5：设置页目录选择与迁移交互

**Files:**
- Modify: `integrations/netcatty/cmdb/core/transport.js`
- Modify: `integrations/netcatty/cmdb/api.js`
- Modify: `integrations/netcatty/cmdb/ConfigCenter.jsx`
- Create: `integrations/netcatty/cmdb/attachmentStorageModel.js`
- Create: `integrations/netcatty/cmdb/attachmentStorageModel.test.js`
- Modify: `scripts/prepare-netcatty.test.mjs`

- [ ] **Step 1: 写状态模型失败测试**

```js
test("builds a migration confirmation from backend status", () => {
  assert.deepEqual(buildAttachmentMigrationSummary({
    source_root: "C:/old",
    target_root: "D:/new",
    file_count: 3,
    size_bytes: 2048,
  }), {
    source: "C:/old",
    target: "D:/new",
    countLabel: "3 个文件",
    sizeLabel: "2 KiB",
  });
});
```

- [ ] **Step 2: 运行失败测试**

Run: `node --test integrations/netcatty/cmdb/attachmentStorageModel.test.js`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 增加前端 API 与桥接封装**

`api.js` 增加状态、预检、迁移和恢复默认请求；`transport.js` 增加 `selectAttachmentDirectory()`，只调用 `window.netcatty.cmdbSelectAttachmentDirectory()`。

- [ ] **Step 4: 改造设置页附件存储区**

删除只读的伪路径拼接。显示后端返回的实际目录、是否默认、可写状态、文件数量和大小；“选择目录”先调用原生选择器，再预检并打开原生确认弹窗；确认后执行迁移并刷新。迁移失败必须保留旧目录并显示后端错误。“恢复默认”调用同一迁移链路。

- [ ] **Step 5: 运行模型和装配测试**

Run: `node --test integrations/netcatty/cmdb/attachmentStorageModel.test.js scripts/prepare-netcatty.test.mjs`

Expected: PASS，且装配测试不再匹配“附件文件不参与云同步”的旧文案。

- [ ] **Step 6: 提交设置界面**

```powershell
git add integrations/netcatty/cmdb/core/transport.js integrations/netcatty/cmdb/api.js integrations/netcatty/cmdb/ConfigCenter.jsx integrations/netcatty/cmdb/attachmentStorageModel.js integrations/netcatty/cmdb/attachmentStorageModel.test.js scripts/prepare-netcatty.test.mjs
git commit -m "feat(cmdb): 支持选择和迁移附件目录"
```

### Task 6：自动补传与工单按需下载

**Files:**
- Create: `integrations/netcatty/CmdbAttachmentCloudSync.ts`
- Create: `integrations/netcatty/CmdbAttachmentCloudSync.test.ts`
- Modify: `integrations/netcatty/CmdbSurface.tsx`
- Modify: `integrations/netcatty/cmdb/core/transport.js`
- Modify: `integrations/netcatty/cmdb/api.js`
- Modify: `integrations/netcatty/cmdb/WorkOrders.jsx`
- Modify: `scripts/prepare-netcatty.mjs`
- Modify: `scripts/prepare-netcatty.test.mjs`

- [ ] **Step 1: 写同步条件失败测试**

测试 `resolveCmdbAttachmentS3Config(state)`：只有 Netcatty 已解锁且 S3 provider 为已连接状态并存在配置时返回配置，否则返回不可用原因；不得从 Cmdb 设置读取第二份凭证。

测试 `createAttachmentKeyEnvelope(derivedKey)` 和 `unwrapAttachmentKey(derivedKey, envelope)`：生成 32 字节随机内容密钥，使用 `unlockedKey.derivedKey` 通过 AES-GCM 包裹；正确主密钥可恢复，错误主密钥必须失败；原始内容密钥不出现在序列化元数据中。

- [ ] **Step 2: 运行失败测试**

在装配后的 Netcatty 测试环境运行：

Run: `npm test -- CmdbAttachmentCloudSync`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现补传调度器**

`CmdbAttachmentCloudSync.ts` 从 `getCloudSyncManager().getState()` 读取当前 S3 连接、配置和 `unlockedKey.derivedKey`。首次上传时生成内容密钥、包裹 IV、数据 IV与随机 `cloud_object_id`，只把包裹后的密钥及 IV 写回附件元数据；原始内容密钥仅作为本次 IPC 参数传给主进程。使用单例 Promise 防止并发重复补传；未解锁或无 S3 时返回 `{ available: false }`，不抛出伪故障、不降级明文上传。

- [ ] **Step 4: 接入现有 Cmdb 同步请求**

装配脚本在 `AppSideEffects.tsx` 现有 `netcatty:cmdb-cloud-sync-request` 处理流程中，在元数据同步完成后调用附件补传。上传附件后继续使用现有 `scheduleCmdbCloudSync()`，不再建立第二套定时器。

- [ ] **Step 5: 改造附件下载**

附件列表根据 `s3_status` 和本地状态显示“等待上传、已同步、同步失败、仅云端”。下载时先用 `unlockedKey.derivedKey` 解包附件内容密钥，再调用 `cmdbDownloadAttachment`；本地不存在则从 S3 拉取、流式解密并由后端校验入库，再执行现有保存对话框。下载失败不生成空文件，Netcatty 未解锁时明确提示先解锁。

- [ ] **Step 6: 运行前端、同步和装配测试**

Run: `node --test integrations/netcatty/cmdb/attachmentStorageModel.test.js`

Run: `node --test scripts/prepare-netcatty.test.mjs`

Run in assembled Netcatty: `npm test -- CmdbAttachmentCloudSync cmdbCloudSync cmdbSyncPayloadIntegration`

Expected: PASS。

- [ ] **Step 7: 提交同步界面与运行时**

```powershell
git add integrations/netcatty/CmdbAttachmentCloudSync.ts integrations/netcatty/CmdbAttachmentCloudSync.test.ts integrations/netcatty/CmdbSurface.tsx integrations/netcatty/cmdb/core/transport.js integrations/netcatty/cmdb/api.js integrations/netcatty/cmdb/WorkOrders.jsx scripts/prepare-netcatty.mjs scripts/prepare-netcatty.test.mjs
git commit -m "feat(cmdb): 自动同步并按需下载工单附件"
```

### Task 7：完整回归与隔离测试机验收

**Files:**
- Modify: `使用说明.md`
- Modify only if required by actual implementation: `docs/superpowers/specs/2026-10-09-cmdb-attachment-storage-sync-design.md`

- [ ] **Step 1: 运行后端完整测试**

Run: `go test ./...`

Expected: PASS。

- [ ] **Step 2: 运行集成源码测试**

Run: `node --test integrations/netcatty/electron/*.test.cjs integrations/netcatty/cmdb/*.test.js scripts/prepare-netcatty.test.mjs scripts/netcatty-update-integration.test.mjs`

Expected: PASS。

- [ ] **Step 3: 重新装配隔离 Netcatty 并运行其测试、lint 和构建**

Run: `node scripts/prepare-netcatty.mjs --target build/netcatty-final`

随后按目标仓库实际脚本运行相关测试、lint 和生产构建；命令以 `build/netcatty-final/package.json` 为准，不猜测脚本名称。

- [ ] **Step 4: 本地目录手测**

使用隔离端口和隔离数据库：

1. 在设置页选择新的测试目录。
2. 上传至少两个附件，其中一个使用中文文件名。
3. 确认文件实际落盘到选择目录。
4. 重启 Netcatty 后下载附件并核对内容。
5. 切换到第二个目录，确认迁移数量、大小和哈希一致。
6. 人为制造不可写或复制失败，确认仍使用旧目录。

- [ ] **Step 5: S3 双机行为验收**

在测试 S3 或可控兼容对象存储中：

1. 机器 A 上传附件并确认状态从 `pending` 变为 `synced`。
2. 断网上传第二个附件，确认本地可用且保持待补传。
3. 恢复网络并触发 Netcatty 同步，确认自动补传。
4. 使用独立隔离数据库模拟机器 B，同步元数据后按需下载。
5. 对比机器 A、机器 B 的明文 SHA-256，均应等于附件 `content_hash`；S3 对象应为不同的密文内容。
6. 直接检查 S3 对象，确认不存在原始文件头或已知明文片段。
7. 使用错误内容密钥或篡改密文认证标签，确认解密失败且不生成正式文件。
8. 删除测试对象，确认返回真实错误且不生成正式文件。

- [ ] **Step 6: 更新使用说明**

明确记录：目录按项目在本机配置；路径不跨机器覆盖；附件元数据随快照同步；二进制使用 Netcatty 已解锁主密钥包裹的随机内容密钥加密后自动补传；异机解锁后按需下载和解密；未启用 S3 时保持本地可用。

- [ ] **Step 7: 提交文档和最终验证结果**

```powershell
git add 使用说明.md
git commit -m "docs(cmdb): 说明附件目录与云同步行为"
```

最终交付只报告实际运行的测试和手测结果；没有可用测试 S3 时，必须将跨机二进制同步标为未验证，不能写成完成。

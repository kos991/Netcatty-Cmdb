# Netcatty Cmdb 项目化、云同步与数据交换实施计划

> **面向执行代理：** 必须使用 `subagent-driven-development`（推荐）或 `executing-plans` 逐项实施本计划。所有步骤使用复选框跟踪；每个任务先写失败测试，再做最小实现，验证通过后单独提交。

**目标：** 在不破坏现有资产生命周期能力的前提下，把 Cmdb 完整项目化并接入 Netcatty 原生界面、主机/钥匙串和加密云同步，同时确保正式发布包首次启动为空业务库。

**架构：** Go + SQLite 继续负责本地业务数据、事务、迁移、规范快照和导入导出；Electron 主进程负责 Netcatty 主机/钥匙串引用解析、原生连接、项目包加密和云端密文对象；React + antd 5 负责项目上下文、配置中心和业务交互。跨设备关系统一使用 UUID，SQLite 自增 ID 只留作本机主键，云端不传 SQLite 文件和任何秘密。

**技术栈：** Go 1.25、modernc SQLite、Excelize、React 18、Ant Design 5、Electron、Node.js 22、Netcatty v1.1.83、GitHub Actions。

---

## 实施原则与顺序

1. 第一批提交只解决发布数据阻断、项目模型和旧库迁移；通过空库与升级测试后才能继续。
2. 第二批提交完成主数据、项目隔离和标准导入导出；每个阶段均能独立运行和回滚。
3. 第三批提交完成原生工作区、术语和 IP 视觉；继续使用 antd 5，不引入 MUI。
4. 第四批提交主机/钥匙串引用和原生连接；Cmdb 永远不保存秘密值。
5. 第五批提交规范快照和 Netcatty 云同步；同步失败不得影响 Vault 已验证结果，也不得伪装整体成功。
6. 最后统一完成新装、旧库、迁移包、双端同步和 Windows Portable 验收，再同步 `v1.3.0` 版本并发布。

## 文件职责

```text
main.go / main_test.go                            空库启动、数据库路径与启动错误
internal/store/project_*.go                      项目、UUID、修订号、墓碑和升级备份
internal/store/config_*.go                       组织、部门、分组、类型、软件、位置和状态主数据
internal/store/*_io.go                           模块模板、预览、事务导入和全部匹配导出
internal/store/cmdb_snapshot.go                  规范快照、预检、冲突和事务应用
internal/store/cmdb_links.go                     Netcatty 主机与钥匙串引用
internal/server_*.go                             项目化 HTTP API、导入导出和同步端点
web/src/CmdbWorkspace.jsx                        原生 Cmdb 工作区与项目上下文
web/src/cmdb/CmdbConfig.jsx                      配置中心总入口
web/src/cmdb/CmdbConnections.jsx                 资产连接与凭证区
web/src/IPManager.jsx                            五态 IP 网格与分配交互
integrations/netcatty/electron/cmdbBridge.cjs    受限 IPC、主机/钥匙串和项目包桥
integrations/netcatty/electron/cmdbSync.cjs      Cmdb 密文对象同步编排
scripts/prepare-netcatty.mjs                     锁定提交的原生装配与类型声明
.github/workflows/*.yml                          空库扫描、集成测试和 v1.3.0 发布
```

## 任务 1：阻断发布包携带业务数据

**文件：**

- 修改：`main.go`
- 修改：`main_test.go`
- 删除：`seed/seed_v2.json`
- 修改：`.github/workflows/ci.yml`
- 修改：`.github/workflows/release.yml`
- 新建：`scripts/check-release-data.mjs`

- [ ] **步骤 1：写全新数据库为空的失败测试**

在 `main_test.go` 增加 `openApplicationStore` 的临时库测试，固定断言项目之外的业务表均为零：

```go
func TestOpenApplicationStoreCreatesEmptyBusinessDatabase(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "assets.db")
	st, err := openApplicationStore(dbPath)
	if err != nil { t.Fatal(err) }
	if err := st.Close(); err != nil { t.Fatal(err) }
	db, err := sql.Open("sqlite", dbPath)
	if err != nil { t.Fatal(err) }
	defer db.Close()

	for _, table := range []string{"assets", "asset_logs", "ip_pool", "servers", "server_apps", "cmdb_assets", "cmdb_persons"} {
		var count int
		if err := db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&count); err != nil { t.Fatalf("%s: %v", table, err) }
		if count != 0 { t.Fatalf("全新库 %s 有 %d 条业务数据", table, count) }
	}
}
```

- [ ] **步骤 2：确认测试因现有嵌入种子而失败**

运行：`go test . -run TestOpenApplicationStoreCreatesEmptyBusinessDatabase -count=1`

预期：至少一个业务表记录数大于零，测试失败。

- [ ] **步骤 3：移除正式启动种子导入**

从 `main.go` 删除 `seed/seed_v2.json` 的 `go:embed`、JSON 解析、`ImportSeedV2`、`MarkSeededV2` 和 `EnsureServersSeeded` 调用；抽取唯一启动入口：

```go
func openApplicationStore(dbPath string) (*store.Store, error) {
	st, err := store.Open(dbPath)
	if err != nil { return nil, fmt.Errorf("打开数据库失败: %w", err) }
	if _, err := st.SeedIPSubnetsFromPool(); err != nil {
		st.Close()
		return nil, fmt.Errorf("初始化网段定义失败: %w", err)
	}
	return st, nil
}
```

测试夹具继续在测试函数内显式插入，不从发布资源读取。

- [ ] **步骤 4：增加发布产物敏感数据扫描**

`scripts/check-release-data.mjs` 递归扫描指定产物，命中以下任一内容即退出 1：`seed_v2.json`、规格中登记的已知资产编号、已知人员名、已知真实 IP。脚本只输出命中的规则名和文件，不输出完整敏感内容。CI 在 Go 构建和 Portable 构建后分别运行：

```powershell
node scripts/check-release-data.mjs build/cmdb-server.exe
node scripts/check-release-data.mjs build/netcatty/release
```

- [ ] **步骤 5：验证并提交**

运行：

```powershell
go test . -run TestOpenApplicationStoreCreatesEmptyBusinessDatabase -count=1
go test -count=1 ./...
go build -trimpath -o build/cmdb-server.exe .
node scripts/check-release-data.mjs build/cmdb-server.exe
```

预期：全新库业务表为零，扫描无命中，全部命令退出 0。

提交：

```powershell
git add main.go main_test.go seed/seed_v2.json scripts/check-release-data.mjs .github/workflows/ci.yml .github/workflows/release.yml
git commit -m "fix(release): start CMDB with empty business data"
```

## 任务 2：建立项目、稳定 UUID、修订号和墓碑模型

**文件：**

- 新建：`internal/store/project_schema.go`
- 新建：`internal/store/project_schema_test.go`
- 修改：`internal/store/store.go`
- 修改：`internal/store/cmdb_migrate.go`
- 修改：`internal/store/cmdb_migrate_test.go`

- [ ] **步骤 1：写全新库与旧库迁移失败测试**

测试固定覆盖：全新库只有一个空默认项目；旧表记录全部补上同一 `project_id`、非空 `sync_id`、`revision=1`；重复打开不新增项目或改变 UUID。

```go
func TestProjectMigrationBackfillsLegacyRowsIdempotently(t *testing.T) {
	dbPath := createLegacyFixture(t)
	first := openTestStoreAt(t, dbPath)
	project := mustDefaultProject(t, first)
	assetSyncID := mustString(t, first, "SELECT sync_id FROM assets LIMIT 1")
	first.Close()

	second := openTestStoreAt(t, dbPath)
	defer second.Close()
	if got := mustInt(t, second, "SELECT COUNT(*) FROM cmdb_projects"); got != 1 { t.Fatalf("项目数=%d", got) }
	if got := mustString(t, second, "SELECT sync_id FROM assets LIMIT 1"); got != assetSyncID { t.Fatalf("UUID 被重写: %s -> %s", assetSyncID, got) }
	if got := mustInt64(t, second, "SELECT project_id FROM assets LIMIT 1"); got != project.ID { t.Fatalf("project_id=%d", got) }
}
```

- [ ] **步骤 2：确认旧结构缺列导致失败**

运行：`go test ./internal/store -run "TestProjectMigration" -count=1`

预期：`cmdb_projects` 不存在或业务表缺少 `project_id`。

- [ ] **步骤 3：实现项目与同步元数据结构**

`project_schema.go` 定义并由 `Store.Open` 事务执行：

```sql
CREATE TABLE IF NOT EXISTS cmdb_projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sync_id TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS cmdb_tombstones (
  project_id INTEGER NOT NULL,
  entity_type TEXT NOT NULL,
  sync_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  deleted_at TEXT NOT NULL,
  PRIMARY KEY (project_id, entity_type, sync_id)
);
```

为跨设备业务表幂等补充：`project_id INTEGER`、`sync_id TEXT`、`revision INTEGER NOT NULL DEFAULT 1`、`updated_at TEXT`、`deleted_at TEXT`。迁移生成 UUID 使用 `github.com/google/uuid`，默认项目固定代码 `default`、名称 `默认项目`。

- [ ] **步骤 4：验证并提交**

运行：`go test ./internal/store -run "TestProjectMigration|TestMigrateCMDBFullSchema" -count=1`

提交：

```powershell
git add internal/store/project_schema.go internal/store/project_schema_test.go internal/store/store.go internal/store/cmdb_migrate.go internal/store/cmdb_migrate_test.go
git commit -m "feat(projects): add project and sync identity schema"
```

## 任务 3：升级前备份并阻断失败迁移

**文件：**

- 新建：`internal/store/database_backup.go`
- 新建：`internal/store/database_backup_test.go`
- 修改：`internal/store/store.go`
- 修改：`main.go`

- [ ] **步骤 1：写备份与失败阻断测试**

```go
func TestOpenCreatesBackupBeforeProjectMigration(t *testing.T) {
	dbPath := createLegacyFixture(t)
	_, err := Open(dbPath)
	if err != nil { t.Fatal(err) }
	matches, _ := filepath.Glob(dbPath + ".backup-*")
	if len(matches) != 1 { t.Fatalf("备份数=%d", len(matches)) }
	assertSQLiteReadable(t, matches[0])
}
```

再注入失败迁移，断言 `Open` 返回包含备份路径的错误，服务不会继续启动。

- [ ] **步骤 2：确认当前打开流程不创建备份**

运行：`go test ./internal/store -run "TestOpenCreatesBackup|TestMigrationFailure" -count=1`

- [ ] **步骤 3：实现仅在需要迁移时备份**

`BackupDatabase` 使用 SQLite `VACUUM INTO` 生成同目录时间戳备份；`needsProjectMigration` 为假时不重复备份。`main.go` 将错误写入日志并退出，不注册 HTTP 服务。

- [ ] **步骤 4：验证并提交**

运行：`go test ./internal/store -run "TestOpenCreatesBackup|TestMigrationFailure" -count=1`

提交：`git commit -am "feat(migration): back up databases before project upgrade"`

## 任务 4：让全部查询和写入受当前项目约束

**文件：**

- 新建：`internal/store/project_scope.go`
- 新建：`internal/store/project_scope_test.go`
- 修改：`internal/store/legacy_store.go`
- 修改：`internal/store/legacy_models.go`
- 修改：`internal/store/cmdb_store.go`
- 修改：`internal/store/person_store.go`
- 修改：`internal/store/ip_pool.go`
- 修改：`internal/store/cmdb_modules.go`
- 修改：`internal/server.go`
- 修改：`internal/server_cmdb.go`
- 修改：`internal/server_cmdb_modules.go`

- [ ] **步骤 1：写两项目隔离失败测试**

在两个项目写入相同名称、不同 `sync_id` 的资产、人员、IP、应用和履历；断言项目 A 的列表、详情、统计、全局查询和导出永远不返回项目 B 数据，并断言跨项目关联写入返回错误。

```go
ctxA := ProjectScope{ProjectID: projectA.ID}
rows, total, err := s.QueryCmdbAssets(ctxA, CmdbAssetQuery{Page: 1, PageSize: 20})
if err != nil { t.Fatal(err) }
if total != 1 || rows[0].ProjectID != projectA.ID { t.Fatalf("项目隔离失败: %+v", rows) }
```

- [ ] **步骤 2：确认现有无项目参数接口失败**

运行：`go test ./internal/store -run TestProjectScope -count=1`

- [ ] **步骤 3：实现一致的项目上下文**

新增：

```go
type ProjectScope struct { ProjectID int64 }
func (s ProjectScope) Validate() error {
	if s.ProjectID <= 0 { return errors.New("缺少有效项目") }
	return nil
}
```

所有业务查询将 `project_id = ?` 放入同一 WHERE 构造器；写入从服务端解析 `X-Cmdb-Project`，不接受请求体覆盖项目；详情按 `(id, project_id)` 查询。项目 API 固定为：`GET /api/cmdb/projects`、`POST /api/cmdb/projects`、`PUT /api/cmdb/projects/{id}`。

- [ ] **步骤 4：验证并提交**

运行：`go test ./internal/store -run TestProjectScope -count=1` 和 `go test -count=1 ./...`

提交：`git commit -am "feat(projects): isolate all CMDB operations by project"`

## 任务 5：完成组织层级和配置主数据

**文件：**

- 新建：`internal/store/config_schema.go`
- 新建：`internal/store/config_store.go`
- 新建：`internal/store/config_store_test.go`
- 修改：`internal/store/cmdb_meta.go`
- 修改：`internal/store/cmdb_taxonomy.go`
- 修改：`internal/store/person_store.go`
- 修改：`internal/server_cmdb_taxonomy.go`
- 修改：`internal/server_cmdb_person_custom.go`
- 修改：`internal/server.go`

- [ ] **步骤 1：写层级 CRUD 与引用保护测试**

测试覆盖组织 → 部门 → 分组三级树、同级名称唯一、移动节点、空节点可见、人员绑定 ID、被引用节点禁止删除、设备类型/软件/位置/状态/厂商模型按项目隔离。

```go
tree, err := s.ListOrgTree(ProjectScope{ProjectID: project.ID})
if err != nil { t.Fatal(err) }
if tree[0].Children[0].Children[0].Name != "运维组" { t.Fatalf("层级错误: %+v", tree) }
if err := s.DeleteOrgNode(scope, department.ID); !errors.Is(err, ErrReferenced) { t.Fatalf("应阻止删除: %v", err) }
```

- [ ] **步骤 2：确认现有自由文本结构无法通过**

运行：`go test ./internal/store -run "TestOrgTree|TestConfigCatalog" -count=1`

- [ ] **步骤 3：实现统一配置目录**

组织节点使用 `cmdb_org_nodes(id, project_id, sync_id, parent_id, node_type, name, sort_order, revision, updated_at, deleted_at)`；软件使用 `cmdb_software_catalog` 和 `cmdb_asset_software`；位置与状态使用独立目录表；设备类型继续复用并扩展 `cmdb_device_categories`。人员保存 `org_id`、`department_id`、`group_id`，展示名称由 JOIN 得出，旧自由文本仅在迁移阶段解析。

API 固定为：

```text
GET/POST                    /api/cmdb/config/{kind}
PUT/DELETE                  /api/cmdb/config/{kind}/{id}
GET                         /api/cmdb/config/org-tree
POST                        /api/cmdb/config/org-tree/move
```

`kind` 白名单：`org-nodes`、`device-types`、`software`、`locations`、`statuses`、`models`。

- [ ] **步骤 4：验证并提交**

运行：`go test ./internal/store -run "TestOrgTree|TestConfigCatalog" -count=1`

提交：

```powershell
git add internal/store/config_schema.go internal/store/config_store.go internal/store/config_store_test.go internal/store/cmdb_meta.go internal/store/cmdb_taxonomy.go internal/store/person_store.go internal/server_cmdb_taxonomy.go internal/server_cmdb_person_custom.go internal/server.go
git commit -m "feat(config): manage organization and CMDB catalogs"
```

## 任务 6：接入配置中心、级联选择和统一业务术语

**文件：**

- 修改：`web/src/CmdbWorkspace.jsx`
- 修改：`web/src/cmdbWorkspaceState.js`
- 修改：`web/src/cmdbWorkspaceState.test.js`
- 修改：`web/src/modules/org/OrgPersonCenter.jsx`
- 修改：`web/src/AssetCenter.jsx`
- 修改：`web/src/ServerCenter.jsx`
- 修改：`web/src/Dashboard.jsx`
- 修改：`web/src/AuditLogs.jsx`
- 修改：`web/src/cmdb/CmdbConfig.jsx`
- 修改：`web/src/cmdb/CmdbTaxonomy.jsx`
- 修改：`web/src/cmdb/cmdbApi.js`
- 修改：`web/src/cmdb/columns.js`
- 修改：`使用说明.md`

- [ ] **步骤 1：写导航和级联值转换失败测试**

在 `web/src/cmdbWorkspaceState.test.js` 断言左侧入口为：全局查询、终端资产、基础设施、业务系统、组织与人员、IP 规划池、统计与履历、配置中心；新增 `web/src/modules/org/orgFormState.test.js` 覆盖树路径与表单 ID 映射。

```js
assert.deepEqual(MODULES.map(({ key }) => key), [
  'search', 'assets', 'infrastructure', 'systems', 'people', 'ip', 'operations', 'config',
])
assert.deepEqual(toOrgPath({ org_id: 1, department_id: 2, group_id: 3 }), [1, 2, 3])
```

- [ ] **步骤 2：确认测试失败**

运行：`node --test web/src/cmdbWorkspaceState.test.js web/src/modules/org/orgFormState.test.js`

- [ ] **步骤 3：实现配置入口和级联选择**

`OrgPersonCenter` 使用 antd `Cascader` 写入三个 ID；`CmdbConfig` 使用侧栏/标签组织现有分类、模型、自定义字段和新增软件、位置、状态配置，不复制现有 CRUD。资产新增、修改、调配复用同一组织级联数据源。

全仓用户可见文案统一：

```text
CMDB 资产管理 / CMDB 资源管理 -> Cmdb
云桌面盒子 SN / 盒子SN       -> 终端主机 SN
房间/法庭 / 法庭号           -> 房间 / 位置
物理服务器                   -> 基础设施
系统应用                     -> 业务系统
安元软件安装情况             -> 软件安装情况（来源为软件目录）
```

删除调配、占位示例、导出标题、履历描述和使用说明中的“法庭/庭审/安元”固定文案；历史数据库值不做破坏性替换。

- [ ] **步骤 4：验证并提交**

运行：

```powershell
node --test web/src/cmdbWorkspaceState.test.js web/src/modules/org/orgFormState.test.js
rg -n "云桌面盒子|房间/法庭|法庭号|安元|CMDB 资产管理|CMDB 资源管理" web/src internal 使用说明.md
Set-Location web; npm.cmd run build; Set-Location ..
```

预期：测试和构建通过；`rg` 仅允许测试夹具或明确的旧数据迁移映射命中。

提交：`git commit -am "feat(ui): add CMDB configuration center and unified terminology"`

## 任务 7：建立标准模块导入导出框架

**文件：**

- 新建：`internal/store/exchange.go`
- 新建：`internal/store/exchange_test.go`
- 新建：`internal/server_exchange.go`
- 修改：`internal/server.go`
- 修改：`internal/store/cmdb_io.go`
- 修改：`internal/store/person_store.go`
- 修改：`internal/store/ip_pool.go`
- 修改：`internal/store/legacy_store.go`
- 修改：`web/src/cmdb/cmdbApi.js`
- 新建：`web/src/cmdb/ImportPreviewModal.jsx`
- 修改：`web/src/AssetCenter.jsx`
- 修改：`web/src/ServerCenter.jsx`
- 修改：`web/src/modules/org/OrgPersonCenter.jsx`
- 修改：`web/src/IPManager.jsx`
- 修改：`web/src/cmdb/CmdbConfig.jsx`

- [ ] **步骤 1：写模板往返、预览不写库和事务回滚测试**

对 `terminal-assets`、`infrastructure`、`applications`、`people`、`ip-pool`、`software`、`config` 逐一运行模板生成 → 填值 → 预览 → 提交 → 导出；断言预览前后计数一致、无效行提交整体回滚、当前筛选导出忽略分页。

```go
preview, err := s.PreviewExchange(scope, "people", bytes.NewReader(file), ImportModeCreateOrUpdate)
if err != nil { t.Fatal(err) }
if got := countPersons(t, s, scope); got != before { t.Fatalf("预览写库: %d -> %d", before, got) }
```

- [ ] **步骤 2：确认统一交换接口尚不存在**

运行：`go test ./internal/store -run TestExchange -count=1`

- [ ] **步骤 3：实现白名单交换器和匹配规则**

```go
type ImportMode string
const (
	ImportCreateOnly ImportMode = "create-only"
	ImportCreateOrUpdate ImportMode = "create-or-update"
)
type ImportPreview struct {
	Rows []ImportPreviewRow `json:"rows"`
	Creates int `json:"creates"`
	Updates int `json:"updates"`
	Errors int `json:"errors"`
}
```

匹配键严格执行设计稿：资产 `项目编码+资产编码`、人员 `项目编码+工号`、IP `项目编码+网段+IP`、业务系统 `项目编码+系统编码`、软件 `项目编码+软件名+厂商`、组织节点 `项目编码+完整路径`。无工号人员和无编码资产只标记人工确认，不按名称覆盖。

API：

```text
GET  /api/cmdb/exchange/{module}/template
POST /api/cmdb/exchange/{module}/preview
POST /api/cmdb/exchange/{module}/commit
GET  /api/cmdb/exchange/{module}/export?scope=filtered|selected|all
```

提交前调用 `BackupDatabase`，全部写入同一事务；运维履历只允许导出。

- [ ] **步骤 4：实现统一预览界面并验证**

`ImportPreviewModal` 固定显示新增、更新、跳过、错误、逐行原因和模式选择；Electron 导入 token 从预览保留到提交。所有导出调用当前项目并保留当前筛选，`selected` 传稳定 UUID，不传页码。

运行：`go test ./internal/store -run TestExchange -count=1`、`node --test web/src/cmdbTransport.test.js`、`npm.cmd --prefix web run build`。

提交：`git commit -am "feat(exchange): add transactional CMDB imports and exports"`

## 任务 8：实现加密项目完整迁移包

**文件：**

- 新建：`internal/store/project_package.go`
- 新建：`internal/store/project_package_test.go`
- 新建：`internal/server_project_package.go`
- 修改：`internal/server.go`
- 修改：`integrations/netcatty/electron/cmdbBridge.cjs`
- 修改：`integrations/netcatty/electron/cmdbBridge.test.cjs`
- 修改：`scripts/prepare-netcatty.mjs`
- 修改：`web/src/cmdb/CmdbConfig.jsx`
- 修改：`web/src/cmdb/cmdbApi.js`

- [ ] **步骤 1：写清单、校验和和恢复回滚测试**

测试包内文件名固定为设计稿的 10 个 JSON 文件；断言 SHA-256 校验、版本拒绝、损坏包拒绝、主机/钥匙串缺失变成未解析引用、错误恢复不产生半写入。

- [ ] **步骤 2：实现 Go 侧明文规范包**

Go 只在内存生成/解析 ZIP 规范数据：

```go
type ProjectPackageManifest struct {
	SchemaVersion int `json:"schema_version"`
	ProjectSyncID string `json:"project_sync_id"`
	CreatedAt string `json:"created_at"`
	Files map[string]string `json:"files"` // 文件名 -> SHA-256
}
```

预检端点只返回版本、数量、冲突和未解析引用；提交端点先备份后单事务恢复。普通业务接口无法导入历史履历。

- [ ] **步骤 3：实现 Electron 加密边界**

新增 IPC：`cmdbExportProjectPackage`、`cmdbPreviewProjectPackage`、`cmdbRestoreProjectPackage`。主进程用 Netcatty 现有主密钥派生/AES-GCM 工具加密同账户迁移包；离线迁移使用 `scrypt` 派生用户口令密钥。渲染器只拿预检摘要，不拿明文 ZIP、主密钥或口令。

- [ ] **步骤 4：验证并提交**

运行：

```powershell
go test ./internal/store -run TestProjectPackage -count=1
node --test integrations/netcatty/electron/cmdbBridge.test.cjs
npm.cmd --prefix web run build
```

提交：`git commit -am "feat(migration): add encrypted CMDB project packages"`

## 任务 9：改造成 Netcatty 原生 Cmdb 工作区

**文件：**

- 修改：`scripts/prepare-netcatty.mjs`
- 修改：`web/src/CmdbWorkspace.jsx`
- 修改：`web/src/cmdbWorkspaceState.js`
- 修改：`web/src/cmdbWorkspaceState.test.js`
- 修改：`web/src/cmdb-workspace.css`
- 修改：`web/src/app.css`
- 修改：`web/src/cmdb/cmdb.css`
- 修改：`netcatty/package.json`
- 新建：`scripts/prepare-netcatty.test.mjs`

- [ ] **步骤 1：写装配结果失败测试**

测试对锁定的 Netcatty fixture 执行装配，断言：根标签 `label="Cmdb"`、`Database size={14}`、活动标题 `Cmdb`、内部无横向一级导航、侧栏默认选中全局查询、所有项目工作区图标来自 `lucide-react`。

- [ ] **步骤 2：确认旧名称与布局导致失败**

运行：`node --test scripts/prepare-netcatty.test.mjs web/src/cmdbWorkspaceState.test.js`

- [ ] **步骤 3：实现原生侧栏和宿主主题**

`scripts/prepare-netcatty.mjs` 将 `TopTabs.tsx` 和 `AppActiveTabChrome.tsx` 的用户可见名称统一为 `Cmdb`。`CmdbWorkspace` 左侧放项目名称、八个入口和 Netcatty 同密度折叠行为，右侧只渲染业务工具栏与内容；删除 `ModuleTabs` 横向一级导航。antd `ConfigProvider` 继续读取宿主亮/暗色 token，卡片圆角不超过 8px。

- [ ] **步骤 4：验证并提交**

运行：

```powershell
node --test scripts/prepare-netcatty.test.mjs web/src/cmdbWorkspaceState.test.js
npm.cmd --prefix web run build
node scripts/prepare-netcatty.mjs --target build/netcatty
```

在已检出锁定上游时再运行 `npm.cmd --prefix build/netcatty run lint` 和 `npm.cmd --prefix build/netcatty run build`。

提交：`git commit -am "feat(netcatty): align CMDB workspace with native UI"`

## 任务 10：实现五态 IP 视觉和冲突行为

**文件：**

- 修改：`internal/store/ip_pool.go`
- 修改：`internal/store/ip_pool_test.go`
- 修改：`internal/server_ip_pool.go`
- 修改：`web/src/IPManager.jsx`
- 修改：`web/src/modules/ippool/ip-pool-new.css`
- 新建：`web/src/ipPoolState.js`
- 新建：`web/src/ipPoolState.test.js`

- [ ] **步骤 1：写状态映射与双重分配失败测试**

```js
assert.deepEqual(ipVisualState('空闲'), { key: 'free', label: '空闲', marker: 'dot' })
assert.deepEqual(ipVisualState('在用'), { key: 'occupied', label: '已占用', marker: 'lock' })
assert.equal(ipVisualState('冲突').key, 'conflict')
```

Go 测试断言同项目同一 IP 分配给不同资产时返回 `ErrIPConflict`，保留/不可分配地址不能进入普通分配。

- [ ] **步骤 2：实现状态语义与稳定尺寸**

状态固定为：空闲、在用、保留、冲突、不可分配。每个网格单元同时使用底色、边框、图标/纹理和文字；设置固定 `aspect-ratio`、最小宽度和不改变布局的 hover。图例展示五态和数量，点击空闲进入分配，点击占用/冲突打开详情。

- [ ] **步骤 3：验证并提交**

运行：`go test ./internal/store -run "TestIP.*Conflict|TestIPPool" -count=1`、`node --test web/src/ipPoolState.test.js`、`npm.cmd --prefix web run build`。

提交：`git commit -am "feat(ip): distinguish allocation states and conflicts"`

## 任务 11：建立 Netcatty 主机和钥匙串引用

**文件：**

- 新建：`internal/store/cmdb_links.go`
- 新建：`internal/store/cmdb_links_test.go`
- 新建：`internal/server_cmdb_links.go`
- 修改：`internal/store/project_schema.go`
- 修改：`internal/server.go`
- 修改：`web/src/cmdb/cmdbApi.js`
- 新建：`web/src/cmdb/CmdbConnections.jsx`
- 修改：`web/src/cmdb/CmdbResources.jsx`

- [ ] **步骤 1：写引用约束与秘密隔离测试**

测试同一主机在项目中只能有一个主资产关联；引用字段仅允许 `host_id`、`credential_id`、展示名、类型、状态和时间，不允许 `password`、`private_key`、`token`；解除和失效写入履历。

- [ ] **步骤 2：实现引用表与 API**

```sql
CREATE TABLE IF NOT EXISTS cmdb_asset_host_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  sync_id TEXT NOT NULL UNIQUE,
  asset_sync_id TEXT NOT NULL,
  host_id TEXT NOT NULL,
  credential_id TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'linked',
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_cmdb_primary_host
ON cmdb_asset_host_links(project_id, host_id) WHERE is_primary = 1 AND deleted_at IS NULL;
```

API 提供列表、关联、解除和状态更新；响应只返回引用元数据。`CmdbConnections` 展示连接、查看主机、关联已有主机、新建主机并关联、修复失效引用。

- [ ] **步骤 3：验证并提交**

运行：`go test ./internal/store -run TestCmdbLinks -count=1` 和 `npm.cmd --prefix web run build`。

提交：`git commit -am "feat(links): relate CMDB assets to Netcatty references"`

## 任务 12：接入 Netcatty 原生主机、钥匙串和连接流程

**文件：**

- 新建：`integrations/netcatty/electron/cmdbHostBridge.cjs`
- 新建：`integrations/netcatty/electron/cmdbHostBridge.test.cjs`
- 修改：`integrations/netcatty/electron/cmdbBridge.cjs`
- 修改：`integrations/netcatty/electron/cmdbBridge.test.cjs`
- 修改：`scripts/prepare-netcatty.mjs`
- 修改：`web/src/cmdbTransport.js`
- 修改：`web/src/cmdbTransport.test.js`
- 修改：`web/src/cmdb/CmdbConnections.jsx`

- [ ] **步骤 1：写 IPC 权限边界失败测试**

测试只返回主机 ID、名称、协议、地址、端口和钥匙串引用状态；调用连接时必须把 `host_id` 交回 Netcatty 原生连接控制器；失效引用返回 `unresolved`，不得静默删除；任一响应都不含密码、私钥和令牌。

- [ ] **步骤 2：实现宿主桥和反向入口**

新增 preload 方法：

```ts
cmdbListHosts(query?: string): Promise<CmdbHostSummary[]>;
cmdbListCredentials(query?: string): Promise<CmdbCredentialSummary[]>;
cmdbCreateHost(payload: CmdbHostDraft): Promise<CmdbHostSummary>;
cmdbConnectHost(hostId: string): Promise<void>;
cmdbOpenHost(hostId: string): Promise<void>;
cmdbOpenAssetLinker(hostId: string): Promise<void>;
```

装配脚本在 Netcatty 主机编辑/上下文菜单注入“关联 Cmdb 资产”“查看关联资产”“解除关联”，只传稳定引用。资产新建主机时预填名称、地址、端口、协议和项目，不写入钥匙串秘密。

- [ ] **步骤 3：验证并提交**

运行：

```powershell
node --test integrations/netcatty/electron/cmdbHostBridge.test.cjs integrations/netcatty/electron/cmdbBridge.test.cjs web/src/cmdbTransport.test.js
npm.cmd --prefix web run build
```

提交：`git commit -am "feat(netcatty): connect CMDB assets through native hosts"`

## 任务 13：实现规范快照、预检、冲突和事务应用

**文件：**

- 新建：`internal/store/cmdb_snapshot.go`
- 新建：`internal/store/cmdb_snapshot_test.go`
- 新建：`internal/server_cmdb_snapshot.go`
- 修改：`internal/server.go`

- [ ] **步骤 1：写快照稳定性和冲突测试**

测试 A 创建/B 应用、不同记录收敛、同字段并发冲突、删除墓碑防复活、IP 双占、重复资产编码、重复主连接、未知引用和失败整体回滚。

```go
type CmdbSnapshot struct {
	SchemaVersion int `json:"schema_version"`
	ProjectSyncID string `json:"project_sync_id"`
	GeneratedAt string `json:"generated_at"`
	BaseHash string `json:"base_hash"`
	Collections map[string]json.RawMessage `json:"collections"`
	Tombstones []Tombstone `json:"tombstones"`
}
```

同一数据库状态连续导出时，排序和摘要必须稳定；`generated_at` 不参与内容摘要。

- [ ] **步骤 2：实现三个受限同步端点**

```text
POST /api/cmdb/sync/export
POST /api/cmdb/sync/preflight
POST /api/cmdb/sync/apply
```

`export` 只输出 UUID 和业务字段；`preflight` 返回新增、修改、删除、冲突和未解析引用计数，不写库；`apply` 先备份，在单事务内应用并返回新摘要。请求不能指定数据库路径或云端对象键。

- [ ] **步骤 3：验证并提交**

运行：`go test ./internal/store -run "TestCmdbSnapshot|TestCmdbMerge" -count=1` 和 `go test -count=1 ./...`。

提交：`git commit -am "feat(sync): add canonical CMDB snapshots and merge preflight"`

## 任务 14：接入 Netcatty 加密云同步

**文件：**

- 新建：`integrations/netcatty/electron/cmdbSync.cjs`
- 新建：`integrations/netcatty/electron/cmdbSync.test.cjs`
- 修改：`integrations/netcatty/electron/cmdbBridge.cjs`
- 修改：`scripts/prepare-netcatty.mjs`
- 修改：`web/src/CmdbWorkspace.jsx`
- 新建：`web/src/cmdb/CmdbSyncStatus.jsx`

- [ ] **步骤 1：写对象键、加密、部分失败和回读验证测试**

测试固定对象键 `cmdb/index/v1` 与 `cmdb/projects/<project_sync_id>/snapshot/v1`；云端写入体必须为 AES-GCM 密文；Vault 成功/Cmdb 失败返回部分失败；写后回读摘要不一致保持待同步；人员联系方式和履历关闭时稳定省略而不产生删除墓碑。

- [ ] **步骤 2：实现同步编排**

`cmdbSync.cjs` 复用 Netcatty 已有账户、主密钥派生、同步锁、可信基线、保护快照和云提供方。执行顺序固定为：主机/钥匙串 → 项目配置 → 业务实体 → 关联 → 完整性检查。每个项目单独保存基线和状态；Cmdb 失败不回滚已验证成功的 Vault 对象，但整体状态显示“部分失败”。

同步设置增加 Cmdb 开关、人员联系方式开关、履历开关、手动同步和历史状态；首次启用显示明确确认。React 只触发主进程和展示状态，不访问云端 SDK。

- [ ] **步骤 3：验证并提交**

运行：

```powershell
node --test integrations/netcatty/electron/cmdbSync.test.cjs integrations/netcatty/electron/cmdbBridge.test.cjs
node scripts/prepare-netcatty.mjs --target build/netcatty
npm.cmd --prefix build/netcatty run lint
npm.cmd --prefix build/netcatty run build
```

提交：`git commit -am "feat(sync): integrate encrypted CMDB cloud objects"`

## 任务 15：完成全量回归和原生窗口验收

**文件：**

- 新建：`docs/fix-reports/fix-report-v1.3.0-2026-09-17.md`
- 修改：`.github/workflows/ci.yml`
- 修改：`README.md`
- 修改：`使用说明.md`

- [ ] **步骤 1：运行自动化回归**

```powershell
go test -count=1 ./...
node --test web/src/*.test.js web/src/modules/org/*.test.js
node --test integrations/netcatty/electron/*.test.cjs
npm.cmd --prefix web run build
node scripts/check-version.mjs
```

预期：全部退出 0；任何失败先修复对应任务，不在报告中写成已通过。

- [ ] **步骤 2：用临时库构建并启动集成版**

在 `build/netcatty` 的锁定上游执行装配、lint、build 和 Windows Portable；设置 `NETCATTY_CMDB_DB_PATH` 指向 `New-TemporaryFile` 所在目录中的 `acceptance-assets.db`，不得指向正式安装目录。

- [ ] **步骤 3：执行桌面尺寸原生验收**

使用 Electron/Playwright 自动化在亮色和暗色模式分别截图并核对：根标签只显示 `Cmdb`；默认全局查询；八个侧栏入口；无横向一级导航；所有页面无重叠；五态 IP 无需只读颜色即可区分；配置 CRUD 闭环；人员级联；资产新增/修改/调配/维修/注销/履历/全部匹配导出；主机连接；同步部分失败状态。

截图保存到 `docs/acceptance/v1.3.0/`，报告只引用本轮实际截图和命令输出。

- [ ] **步骤 4：执行新装、升级、迁移包和双端同步验收**

用四套临时目录：全新库、v1.2.0 夹具库、设备 A、设备 B。断言全新库业务表为零；旧库记录数和关键字段不丢；项目包密码错误不写库；A/B 新增修改删除收敛；同字段与 IP 双占进入冲突；钥匙串缺失保留待关联。

- [ ] **步骤 5：形成修复报告并提交**

报告包含目标、文件清单、关键改动、实际命令、手测步骤、版本同步、风险、结论，证据使用仓库相对路径。

提交：`git commit -am "test(cmdb): complete v1.3.0 acceptance"`

## 任务 16：同步版本并发布 v1.3.0

**文件：**

- 修改：`VERSION`
- 修改：`web/package.json`
- 修改：`web/package-lock.json`
- 修改：`netcatty/package.json`
- 修改：`README.md`
- 修改：`使用说明.md`
- 修改：`.github/workflows/release.yml`

- [ ] **步骤 1：同步版本号**

将上述版本位置统一为 `1.3.0`，README 和使用说明只描述已通过验收的能力；不删除 `v1.2.0` Release，不重写 Git 历史。

- [ ] **步骤 2：执行发布前门禁**

```powershell
node scripts/check-version.mjs --tag v1.3.0
go test -count=1 ./...
npm.cmd --prefix web run build
node --test integrations/netcatty/electron/*.test.cjs
node scripts/check-release-data.mjs build
git status --short
```

预期：版本一致、测试与构建通过、无敏感数据命中；`git status` 只含本任务版本和文档文件。

- [ ] **步骤 3：提交、推送并发布**

```powershell
git add VERSION web/package.json web/package-lock.json netcatty/package.json README.md 使用说明.md .github/workflows/release.yml
git commit -m "chore(release): prepare v1.3.0"
git push origin main
git tag -a v1.3.0 -m "Netcatty-Cmdb v1.3.0"
git push origin v1.3.0
```

等待 GitHub Actions 的 `server-binaries`、`netcatty-windows`、`publish` 全部成功；下载 Release 资产复算 SHA-256，并用临时用户数据目录启动一次 Portable。只有远端 Release 和校验均成功才宣布发布完成。

---

## 需求覆盖索引

| 验收项 | 对应任务 |
| --- | --- |
| AC-01 名称统一为 Cmdb | 6、9 |
| AC-02 全部数据属于项目 | 2、4 |
| AC-03 组织管理和人员级联 | 5、6 |
| AC-04 配置管理入口 | 5、6 |
| AC-05 术语和固定文案清理 | 6 |
| AC-06 IP 五态视觉 | 10 |
| AC-07 原生布局、主题和 Lucide | 9 |
| AC-08 主机与钥匙串关联、连接 | 11、12 |
| AC-09 不保存和导出秘密 | 8、11、12、14 |
| AC-10 共用账户、加密和同步入口 | 14 |
| AC-11 多端合并、删除、冲突和回滚 | 13、14 |
| AC-12 各模块标准导入导出 | 7 |
| AC-13 全部匹配导出 | 4、7 |
| AC-14 加密项目迁移包 | 8 |
| AC-15 新装空库、升级保留数据 | 1、2、3、15 |
| AC-16 保留全局查询和生命周期能力 | 4、6、15 |

## 回滚边界

- 数据结构只做向前兼容增表/增列；每次旧库迁移、项目恢复和远端应用前创建可读备份。
- UI 和 IPC 改动集中在 `web/src`、`integrations/netcatty` 与装配脚本，可回滚界面而不删除新数据库字段。
- 云同步可关闭；关闭只停止上传下载，不删除本地或云端对象。
- 正式安装目录和用户现有 `assets.db` 不用于开发测试；所有验收使用显式临时路径。
- Release 删除、远端密文删除和 Git 历史重写不属于本计划自动步骤，必须另行获得用户明确授权。

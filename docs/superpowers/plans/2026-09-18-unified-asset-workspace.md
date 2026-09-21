# Netcatty Cmdb 统一资产工作区实施计划

> **面向执行代理：** 必须使用 `subagent-driven-development`（推荐）或 `executing-plans`，严格按任务顺序执行；所有步骤使用复选框追踪。执行时只暂存本任务文件，不得把工作树中既有未提交改动混入提交。

**目标：** 在 Netcatty 原生 Cmdb 中交付一张统一资产列表、三类新增入口、动态设备模板、软件许可、IPAM/VLAN/VXLAN/端口链路以及超融合和云桌面关系，同时保留现有分页、筛选、CRUD、调换、维修、归档、履历与导入导出能力。

**架构：** 保留 `assets`、`cmdb_assets`、`server_apps` 三个现有领域表，通过统一摘要查询提供单列表产品视图；详情和写操作按 `source_table + source_id` 路由到原领域。新增关系对象使用独立、项目隔离、可同步、软删除的表；终端和服务器继续以原台账为生命周期主数据，并自动写穿到 `cmdb_assets` 镜像供网络与关联功能使用。

**技术栈：** Go 1.25、SQLite、React、Netcatty `components/ui`、Tailwind、Radix UI、Lucide、Node.js 原生测试。

---

## 一、执行边界

- 正式前端只修改 `integrations/netcatty/cmdb/`，`web/` 仅作旧逻辑参考。
- 不引入 Ant Design、MUI、ORM、FTS、全局状态管理、关系图或链路聚合对象。
- 数据库迁移只新增表和列，不删除历史列；任何回退都保留新增数据。
- 首次新增资产不要求填写 IPAM、端口链路、VLAN、VXLAN 或复杂承载关系。
- 组织架构不在本计划内重构，但资产负责人、部门筛选和详情关联必须继续工作。
- 所有 API 必须经过现有 `requestProjectScope`，所有新表必须加入 `projectScopedTables`。

## 二、文件职责

### 后端新增文件

- `internal/store/asset_workspace_schema.go`：统一资产新增表、补列及幂等迁移。
- `internal/store/asset_templates.go`：字段模板、设备类型绑定和提交校验。
- `internal/store/asset_workspace.go`：统一摘要查询、详情定位、筛选和通用资产事件。
- `internal/store/asset_mirror.go`：终端、服务器到 `cmdb_assets` 的幂等镜像与写穿。
- `internal/store/software_license.go`：许可及分配关系 CRUD。
- `internal/store/network_inventory.go`：VLAN、VXLAN、端口、链路和 IPAM 绑定。
- `internal/store/virtualization_inventory.go`：超融合、云桌面及通用资产关系。
- `internal/store/asset_workspace_io.go`：三类模板、预览导入和统一导出。
- `internal/server_asset_workspace.go`：统一列表、详情、模板及类型目录接口。
- `internal/server_software_license.go`：软件许可 HTTP 接口。
- `internal/server_network_inventory.go`：VLAN、VXLAN、端口和链路 HTTP 接口。
- `internal/server_virtualization_inventory.go`：超融合和云桌面关系 HTTP 接口。
- `internal/server_asset_workspace_io.go`：分类模板、导入和导出接口。

### 原生界面新增文件

- `integrations/netcatty/cmdb/assetTemplates.js`：前端字段模板解释器和摘要生成器。
- `integrations/netcatty/cmdb/AssetTable.jsx`：统一列表、筛选、分页与批量选择。
- `integrations/netcatty/cmdb/AssetEditor.jsx`：三类新增入口和动态编辑表单。
- `integrations/netcatty/cmdb/AssetDetails.jsx`：统一“资产档案”抽屉。
- `integrations/netcatty/cmdb/NetworkInventory.jsx`：IPAM、VLAN、VXLAN、端口和链路子区块。
- `integrations/netcatty/cmdb/VirtualizationRelations.jsx`：超融合和云桌面关系子区块。
- `integrations/netcatty/cmdb/SoftwareLicenseEditor.jsx`：许可表单和分配关系。
- `integrations/netcatty/cmdb/assetWorkspaceState.js`：列表参数、复合资产引用和操作路由纯函数。

### 主要修改文件

- `internal/store/store.go`：执行新迁移。
- `internal/store/project_schema.go`：新表纳入项目、同步和软删除元数据。
- `internal/store/config_store.go`：设备类型增加模板与存储域绑定。
- `internal/store/legacy_store.go`：终端增改、调换、维修、归档后写穿镜像。
- `internal/store/project_scope_cmdb_sync_store.go`：扩展幂等镜像规则。
- `internal/server.go`：注册新路由。
- `integrations/netcatty/cmdb/api.js`：新增统一资产和关系 API。
- `integrations/netcatty/cmdb/DeviceAssets.jsx`：替换三个页签，成为统一资产工作区容器。
- `integrations/netcatty/cmdb/ConfigCenter.jsx`：设备类型绑定字段模板。
- `integrations/netcatty/cmdb/ui.jsx`：只补充统一列表需要的紧凑菜单和抽屉能力。
- `scripts/prepare-netcatty.test.mjs`：更新装配验收断言。
- `AGENTS.md`、`使用说明.md`：在最终验收后同步已确认产品框架。

---

## 三、分阶段任务

### 任务 1：锁定统一资产契约

**文件：**

- 新增：`internal/store/asset_workspace_test.go`
- 新增：`integrations/netcatty/cmdb/assetWorkspaceState.test.js`
- 修改：`integrations/netcatty/cmdb/state.test.js`

- [ ] **步骤 1：为复合资产引用编写失败测试**

```javascript
import test from 'node:test'
import assert from 'node:assert/strict'
import { assetRefKey, parseAssetRef, routeAssetAction } from './assetWorkspaceState.js'

test('统一资产使用来源表和来源 ID 组成稳定引用', () => {
  assert.equal(assetRefKey({ source_table: 'assets', source_id: 18 }), 'assets:18')
  assert.deepEqual(parseAssetRef('server_apps:9'), { source_table: 'server_apps', source_id: 9 })
  assert.equal(routeAssetAction({ asset_kind: 'license' }), 'license')
})
```

- [ ] **步骤 2：运行测试确认因文件不存在而失败**

```powershell
node --test integrations/netcatty/cmdb/assetWorkspaceState.test.js
```

预期：失败并指出无法加载 `assetWorkspaceState.js`。

- [ ] **步骤 3：定义后端统一摘要契约测试**

```go
func TestUnifiedAssetSummaryContract(t *testing.T) {
	got := UnifiedAssetSummary{AssetKind: "device", AssetType: "物理服务器", SourceTable: "cmdb_assets", SourceID: 7}
	if got.Ref() != "cmdb_assets:7" {
		t.Fatalf("统一引用=%q", got.Ref())
	}
}
```

- [ ] **步骤 4：实现最小纯函数和结构体**

`assetWorkspaceState.js` 固定输出 `source_table:source_id`；`UnifiedAssetSummary` 至少定义以下字段：

```go
type UnifiedAssetSummary struct {
	AssetKind    string `json:"asset_kind"`
	AssetType    string `json:"asset_type"`
	SourceTable  string `json:"source_table"`
	SourceID     int64  `json:"source_id"`
	Name         string `json:"name"`
	Code         string `json:"code"`
	Status       string `json:"status"`
	Owner        string `json:"owner"`
	Department   string `json:"department"`
	Supplier     string `json:"supplier"`
	PrimaryLabel string `json:"primary_label"`
	Summary      string `json:"summary"`
	CmdbAssetID  int64  `json:"cmdb_asset_id"`
}
```

- [ ] **步骤 5：运行契约测试并提交**

```powershell
go test ./internal/store -run TestUnifiedAssetSummaryContract -count=1
node --test integrations/netcatty/cmdb/assetWorkspaceState.test.js integrations/netcatty/cmdb/state.test.js
git add internal/store/asset_workspace.go internal/store/asset_workspace_test.go integrations/netcatty/cmdb/assetWorkspaceState.js integrations/netcatty/cmdb/assetWorkspaceState.test.js integrations/netcatty/cmdb/state.test.js
git commit -m "test: define unified asset contracts"
```

预期：两组测试通过。

### 任务 2：新增幂等数据库结构

**文件：**

- 新增：`internal/store/asset_workspace_schema.go`
- 新增：`internal/store/asset_workspace_schema_test.go`
- 修改：`internal/store/store.go`
- 修改：`internal/store/project_schema.go`
- 修改：`internal/store/project_schema_test.go`

- [ ] **步骤 1：编写旧库升级和二次打开测试**

测试必须断言下列表存在，并都包含 `project_id`、`sync_id`、`revision`、`updated_at`、`deleted_at`：

```go
var assetWorkspaceTables = []string{
	"cmdb_software_licenses", "cmdb_license_assignments",
	"cmdb_vlans", "cmdb_vxlans", "cmdb_asset_ports",
	"cmdb_port_links", "cmdb_asset_relations", "cmdb_asset_events",
}
```

同时断言补列存在：

```go
var requiredColumns = map[string][]string{
	"cmdb_device_categories": {"template_key", "storage_domain"},
	"cmdb_asset_interfaces":  {"ip_pool_id", "vlan_id", "vxlan_id", "ip_role"},
	"ip_subnets":             {"default_vlan_id", "default_vxlan_id"},
	"server_apps":            {"supplier", "runtime_env", "importance", "host_asset_id", "go_live_date", "maintenance_expiry"},
}
```

- [ ] **步骤 2：运行迁移测试确认失败**

```powershell
go test ./internal/store -run 'TestAssetWorkspaceMigration|TestProjectMigrationAddsSyncColumns' -count=1
```

预期：新表或新列不存在。

- [ ] **步骤 3：实现幂等迁移**

`MigrateAssetWorkspaceSchema` 必须在一个事务中创建表、索引并补列；端口链路使用规范端点顺序避免双向重复：

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_cmdb_port_links_project_pair
ON cmdb_port_links(project_id, endpoint_a_port_id, endpoint_b_port_id)
WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cmdb_license_assignments_project_target
ON cmdb_license_assignments(project_id, license_id, target_table, target_id)
WHERE deleted_at IS NULL;
```

- [ ] **步骤 4：接入打开数据库流程**

在 `store.Open` 中保持顺序：基础表 → CMDB 完整迁移 → 配置表 → 统一资产迁移 → 项目元数据迁移。将七张新表加入 `projectScopedTables`，并为测试夹具增加合法插入分支。

- [ ] **步骤 5：验证空库、旧库和幂等性并提交**

```powershell
go test ./internal/store -run 'TestAssetWorkspaceMigration|TestProjectMigration' -count=1
git add internal/store/asset_workspace_schema.go internal/store/asset_workspace_schema_test.go internal/store/store.go internal/store/project_schema.go internal/store/project_schema_test.go
git commit -m "feat: add unified asset schema"
```

预期：首次打开、旧库升级、重复打开全部通过，业务表仍为空。

### 任务 3：建立字段模板与设备类型绑定

**文件：**

- 新增：`internal/store/asset_templates.go`
- 新增：`internal/store/asset_templates_test.go`
- 修改：`internal/store/config_store.go`
- 修改：`internal/store/config_store_test.go`
- 修改：`internal/server_cmdb_taxonomy.go`
- 修改：`internal/server_cmdb_config_test.go`

- [ ] **步骤 1：编写十种模板和隐藏字段测试**

```go
func TestNetworkTemplateExcludesComputerFields(t *testing.T) {
	tpl, ok := AssetTemplateByKey("network_security")
	if !ok { t.Fatal("缺少网络与安全模板") }
	for _, key := range []string{"cpu_info", "memory_mb", "disk_info", "os_type", "mac"} {
		if tpl.HasField(key) { t.Fatalf("网络模板不应显示 %s", key) }
	}
}

func TestVirtualTemplateUsesSupplierInsteadOfBrand(t *testing.T) {
	tpl, _ := AssetTemplateByKey("virtual_cloud")
	if !tpl.HasField("supplier") || tpl.HasField("vendor") { t.Fatal("虚拟资源字段规则错误") }
}
```

- [ ] **步骤 2：定义固定模板目录**

模板键固定为：

```go
var AssetTemplateKeys = []string{
	"computer_server", "general_terminal", "network_security", "storage",
	"virtual_cloud", "hci_cluster", "hci_node", "vdi_platform",
	"desktop_pool", "vdi_terminal",
}
```

字段定义包含 `key`、`label`、`input_type`、`required`、`section`；模板由代码维护，设备类型只保存绑定关系，避免用户编辑出不可验证的字段结构。

- [ ] **步骤 3：扩展设备类型配置项**

`ConfigItem` 增加：

```go
TemplateKey   string `json:"template_key"`
StorageDomain string `json:"storage_domain"`
```

只允许 `storage_domain` 为 `terminal` 或 `cmdb`，只允许绑定已登记模板键；创建和更新均验证。

- [ ] **步骤 4：提供模板读取接口**

注册：

```go
scoped("GET /api/cmdb/asset-templates", s.handleListAssetTemplates)
```

响应固定为：

```json
{"list":[{"key":"computer_server","name":"电脑与服务器","fields":[]}],"total":10}
```

- [ ] **步骤 5：运行测试并提交**

```powershell
go test ./internal/store -run 'TestAssetTemplate|TestConfig.*DeviceType' -count=1
go test ./internal -run 'Test.*AssetTemplate|TestCmdbConfig' -count=1
git add internal/store/asset_templates.go internal/store/asset_templates_test.go internal/store/config_store.go internal/store/config_store_test.go internal/server_cmdb_taxonomy.go internal/server_cmdb_config_test.go internal/server.go
git commit -m "feat: bind device types to field templates"
```

### 任务 4：补齐终端和服务器自动镜像联动

**文件：**

- 新增：`internal/store/asset_mirror.go`
- 新增：`internal/store/asset_mirror_test.go`
- 修改：`internal/store/legacy_store.go`
- 修改：`internal/store/project_scope_cmdb_sync_store.go`
- 修改：`internal/store/project_scope_cmdb_sync_test.go`
- 修改：`internal/store/legacy_operations_store_test.go`

- [ ] **步骤 1：编写创建、修改、调换、维修、归档镜像测试**

测试创建终端后查询：

```sql
SELECT source_type, source_id, owner, department, room, status, box_sn
FROM cmdb_assets
WHERE project_id=? AND source_type='legacy_asset' AND source_id=? AND deleted_at IS NULL
```

每次业务操作后断言镜像值同步；重复同步不得产生第二条镜像。

- [ ] **步骤 2：运行测试确认现有写操作未完整联动**

```powershell
go test ./internal/store -run 'TestLegacyAssetMirror|TestLegacyOperationsMirror' -count=1
```

- [ ] **步骤 3：实现事务内幂等写穿**

统一入口签名：

```go
func upsertLegacyAssetMirror(tx *sql.Tx, scope ProjectScope, asset *Asset) (int64, error)
func upsertLegacyServerMirror(tx *sql.Tx, scope ProjectScope, server *PhysicalServer) (int64, error)
```

使用 `(project_id, source_type, source_id)` 唯一键，更新时递增 `revision`；业务主表写入和镜像写入必须处于同一事务。

- [ ] **步骤 4：保留显式全量修复入口**

现有 `SyncLegacyToCmdbForProject` 继续用于历史数据修复，但改用同一组 `upsert` 函数。统一列表不得在每次查询时偷偷执行同步。

- [ ] **步骤 5：验证多项目隔离并提交**

```powershell
go test ./internal/store -run 'TestLegacyAssetMirror|TestProjectScopeCmdbReadIsolationAndSyncMetadata|TestLegacyOperations' -count=1
git add internal/store/asset_mirror.go internal/store/asset_mirror_test.go internal/store/legacy_store.go internal/store/project_scope_cmdb_sync_store.go internal/store/project_scope_cmdb_sync_test.go internal/store/legacy_operations_store_test.go
git commit -m "feat: keep legacy assets mirrored automatically"
```

### 任务 5：实现统一资产查询和详情定位

**文件：**

- 修改：`internal/store/asset_workspace.go`
- 修改：`internal/store/asset_workspace_test.go`
- 新增：`internal/server_asset_workspace.go`
- 新增：`internal/server_asset_workspace_test.go`
- 修改：`internal/server.go`

- [ ] **步骤 1：编写三类资产、分页和筛选失败测试**

构造终端、基础设施、业务系统和许可各一条，断言：

```go
query := UnifiedAssetQuery{Keyword: "华为", Kind: "device", Status: "在用", Page: 1, PageSize: 20}
list, total, err := s.QueryUnifiedAssetsForProject(scope, query)
```

同时覆盖 `asset_kind`、`asset_type`、`owner`、`department`、`supplier`、归档隐藏及不同项目隔离。

- [ ] **步骤 2：实现统一查询参数**

```go
type UnifiedAssetQuery struct {
	Keyword, Kind, AssetType, Status, Owner, Department, Supplier string
	IncludeArchived bool
	Page, PageSize int
}
```

查询使用参数化 `UNION ALL` 子查询；终端、CMDB 资产、业务系统、许可分别映射到统一列，最终统一排序和分页。

- [ ] **步骤 3：实现统一详情定位**

`GET /api/cmdb/unified-assets/{source}/{id}` 返回：

```json
{
  "summary": {},
  "record": {},
  "source_table": "cmdb_assets",
  "source_id": 7,
  "cmdb_asset_id": 7
}
```

来源白名单仅允许 `assets`、`cmdb_assets`、`server_apps`、`cmdb_software_licenses`，禁止直接拼接路径值到 SQL。

- [ ] **步骤 4：注册统一列表接口**

```go
scoped("GET /api/cmdb/unified-assets", s.handleListUnifiedAssets)
scoped("GET /api/cmdb/unified-assets/{source}/{id}", s.handleGetUnifiedAsset)
```

响应沿用 `list/total/page/page_size`。

- [ ] **步骤 5：运行存储和 HTTP 测试并提交**

```powershell
go test ./internal/store -run TestUnifiedAsset -count=1
go test ./internal -run TestUnifiedAsset -count=1
git add internal/store/asset_workspace.go internal/store/asset_workspace_test.go internal/server_asset_workspace.go internal/server_asset_workspace_test.go internal/server.go
git commit -m "feat: add unified asset query API"
```

### 任务 6：实现软件许可及分配关系

**文件：**

- 新增：`internal/store/software_license.go`
- 新增：`internal/store/software_license_test.go`
- 新增：`internal/server_software_license.go`
- 新增：`internal/server_software_license_test.go`
- 修改：`internal/server.go`

- [ ] **步骤 1：编写数量、到期和脱敏测试**

覆盖以下规则：授权数量不得小于零；分配总量不得超过授权数量；失效目标不得分配；密钥 API 只返回掩码和末四位；导出不包含密钥材料。

```go
license := SoftwareLicense{Code: "LIC-001", Name: "Office", Quantity: 100, SecretLast4: "8X2Q"}
if got := license.MaskedSecret(); got != "****8X2Q" { t.Fatalf("脱敏=%q", got) }
```

- [ ] **步骤 2：实现项目隔离 CRUD**

```go
func (s *Store) QuerySoftwareLicensesForProject(scope ProjectScope, q SoftwareLicenseQuery) ([]SoftwareLicense, int, error)
func (s *Store) SaveSoftwareLicenseForProject(scope ProjectScope, license *SoftwareLicense) (int64, error)
func (s *Store) ReplaceLicenseAssignmentsForProject(scope ProjectScope, licenseID int64, items []LicenseAssignment) error
func (s *Store) ArchiveSoftwareLicenseForProject(scope ProjectScope, id int64) error
```

分配替换必须在事务中校验数量和目标存在性。

- [ ] **步骤 3：注册 HTTP 接口**

```text
GET    /api/cmdb/licenses
POST   /api/cmdb/licenses
GET    /api/cmdb/licenses/{id}
PUT    /api/cmdb/licenses/{id}
DELETE /api/cmdb/licenses/{id}
PUT    /api/cmdb/licenses/{id}/assignments
```

- [ ] **步骤 4：验证统一列表可查到许可**

新增一条许可后，以名称、编码、供应商和到期日期关键词查询统一列表，断言 `asset_kind=license`。

- [ ] **步骤 5：运行测试并提交**

```powershell
go test ./internal/store -run TestSoftwareLicense -count=1
go test ./internal -run TestSoftwareLicense -count=1
git add internal/store/software_license.go internal/store/software_license_test.go internal/server_software_license.go internal/server_software_license_test.go internal/server.go internal/store/asset_workspace.go internal/store/asset_workspace_test.go
git commit -m "feat: add software license inventory"
```

### 任务 7：实现业务系统扩展字段和承载关系

**文件：**

- 修改：`internal/store/legacy_models.go`
- 修改：`internal/store/legacy_store.go`
- 修改：`internal/store/legacy_asset_store_test.go`
- 修改：`internal/server.go`
- 修改：`internal/server_cmdb_test.go`

- [ ] **步骤 1：编写业务系统字段往返测试**

保存并读取 `supplier`、`runtime_env`、`importance`、`host_asset_id`、`go_live_date`、`maintenance_expiry`，断言虚拟资源可作为承载对象，物理品牌字段不进入业务系统请求。

- [ ] **步骤 2：扩展 `ServerApp` 结构**

```go
Supplier          string `json:"supplier"`
RuntimeEnv        string `json:"runtime_env"`
Importance        string `json:"importance"`
HostAssetID       int64  `json:"host_asset_id"`
GoLiveDate        string `json:"go_live_date"`
MaintenanceExpiry string `json:"maintenance_expiry"`
```

- [ ] **步骤 3：兼容旧 `server_id`**

新建和编辑允许 `server_id` 或 `host_asset_id` 至少一个存在；`host_asset_id` 必须属于当前项目。旧 `/api/servers/{id}/apps` 路由继续可用，统一界面优先提交 `host_asset_id`。

- [ ] **步骤 4：验证统一摘要和详情**

业务系统摘要使用供应商、版本、运行环境构成 `summary`，主要标识优先访问地址，其次承载设备 IP。

- [ ] **步骤 5：运行测试并提交**

```powershell
go test ./internal/store -run 'Test.*ServerApp|TestUnifiedAsset.*System' -count=1
go test ./internal -run 'Test.*App|TestUnifiedAsset.*System' -count=1
git add internal/store/legacy_models.go internal/store/legacy_store.go internal/store/legacy_asset_store_test.go internal/server.go internal/server_cmdb_test.go internal/store/asset_workspace.go
git commit -m "feat: extend business system records"
```

### 任务 8：实现 VLAN、VXLAN 与 IPAM 绑定

**文件：**

- 新增：`internal/store/network_inventory.go`
- 新增：`internal/store/network_inventory_test.go`
- 新增：`internal/server_network_inventory.go`
- 新增：`internal/server_network_inventory_test.go`
- 修改：`internal/store/ip_pool.go`
- 修改：`internal/store/ip_pool_test.go`
- 修改：`internal/server_ip_pool.go`
- 修改：`internal/server.go`

- [ ] **步骤 1：编写 VLAN/VNI 合法性和引用保护测试**

```go
for _, tc := range []struct{ vlan int; valid bool }{{1, true}, {4094, true}, {0, false}, {4095, false}} { /* 调用校验 */ }
for _, tc := range []struct{ vni int; valid bool }{{1, true}, {16777215, true}, {0, false}, {16777216, false}} { /* 调用校验 */ }
```

删除被网段、接口或链路引用的 VLAN/VXLAN 时，错误必须包含引用数量。

- [ ] **步骤 2：实现项目隔离 CRUD**

```go
func (s *Store) ListVLANsForProject(scope ProjectScope, keyword string) ([]VLAN, error)
func (s *Store) SaveVLANForProject(scope ProjectScope, item *VLAN) (int64, error)
func (s *Store) ListVXLANsForProject(scope ProjectScope, keyword string) ([]VXLAN, error)
func (s *Store) SaveVXLANForProject(scope ProjectScope, item *VXLAN) (int64, error)
```

- [ ] **步骤 3：扩展 IPAM 自动带出规则**

`IPSubnet` 返回 `default_vlan_id`、`default_vxlan_id`；分配接口接受：

```json
{"asset_id":7,"interface_id":12,"ip_field":"physical_ip","vlan_id":20,"vxlan_id":3,"remark":"终端物理地址"}
```

省略 VLAN/VXLAN 时使用网段默认值；指定值必须属于当前项目且关系有效。

- [ ] **步骤 4：注册网络配置接口**

```text
GET/POST/PUT/DELETE /api/cmdb/vlans
GET/POST/PUT/DELETE /api/cmdb/vxlans
```

- [ ] **步骤 5：验证冲突、释放和项目隔离并提交**

```powershell
go test ./internal/store -run 'TestVLAN|TestVXLAN|Test.*IP.*Asset' -count=1
go test ./internal -run 'TestVLAN|TestVXLAN|TestIPPool' -count=1
git add internal/store/network_inventory.go internal/store/network_inventory_test.go internal/server_network_inventory.go internal/server_network_inventory_test.go internal/store/ip_pool.go internal/store/ip_pool_test.go internal/server_ip_pool.go internal/server.go
git commit -m "feat: link IPAM with VLAN and VXLAN"
```

### 任务 9：实现资产端口和规范链路

**文件：**

- 修改：`internal/store/network_inventory.go`
- 修改：`internal/store/network_inventory_test.go`
- 修改：`internal/server_network_inventory.go`
- 修改：`internal/server_network_inventory_test.go`

- [ ] **步骤 1：编写端口占用和双方视角测试**

测试 `服务器 eth0 → 交换机 Gi1/0/12` 只保存一条记录；从任一资产读取均能得到对端；第二条活动链路重复占用同一端口时失败。

- [ ] **步骤 2：实现端点规范化**

```go
func normalizeLinkEndpoints(a, b int64) (int64, int64, error) {
	if a <= 0 || b <= 0 || a == b { return 0, 0, errors.New("链路两端必须是不同的有效端口") }
	if a < b { return a, b, nil }
	return b, a, nil
}
```

- [ ] **步骤 3：实现事务 CRUD 和履历**

端口必须属于当前项目的目标资产；`direction` 只允许 `uplink`、`downlink`；`link_type` 只允许 `access`、`trunk`、`management`、`virtual`。新增、修改、删除链路都写入 `cmdb_asset_events`，统一详情把该事件流与终端原有 `asset_logs` 归一展示。

- [ ] **步骤 4：注册接口**

```text
GET/POST/PUT/DELETE /api/cmdb/assets/{id}/ports
GET/POST/PUT/DELETE /api/cmdb/assets/{id}/links
```

- [ ] **步骤 5：运行测试并提交**

```powershell
go test ./internal/store -run 'TestAssetPort|TestPortLink' -count=1
go test ./internal -run 'TestAssetPort|TestPortLink' -count=1
git add internal/store/network_inventory.go internal/store/network_inventory_test.go internal/server_network_inventory.go internal/server_network_inventory_test.go internal/server.go
git commit -m "feat: add port-level asset links"
```

### 任务 10：实现超融合和云桌面关系

**文件：**

- 新增：`internal/store/virtualization_inventory.go`
- 新增：`internal/store/virtualization_inventory_test.go`
- 新增：`internal/server_virtualization_inventory.go`
- 新增：`internal/server_virtualization_inventory_test.go`
- 修改：`internal/server.go`

- [ ] **步骤 1：编写关系类型和环路校验测试**

关系类型固定为：

```go
const (
	RelationHCIClusterNode   = "hci_cluster_node"
	RelationHCIHostedVM     = "hci_hosted_vm"
	RelationHCIHostedVDI    = "hci_hosted_vdi"
	RelationVDIPlatformPool = "vdi_platform_pool"
	RelationVDIPoolTerminal = "vdi_pool_terminal"
	RelationVDITerminalVM   = "vdi_terminal_vm"
)
```

测试错误类型组合、跨项目关系、自关联、桌面池多平台归属以及删除被引用对象。

- [ ] **步骤 2：实现通用关系存储**

```go
func (s *Store) ReplaceAssetRelationForProject(scope ProjectScope, relation AssetRelation) (int64, error)
func (s *Store) ListAssetRelationsForProject(scope ProjectScope, assetID int64) ([]AssetRelation, error)
func (s *Store) DeleteAssetRelationForProject(scope ProjectScope, id int64) error
```

- [ ] **步骤 3：实现集群容量聚合**

集群详情按成员节点 `custom_fields` 中的计算、内存和存储总量/使用量求和；外部快照存在时单独返回 `external_snapshot`，不得覆盖节点明细聚合。

- [ ] **步骤 4：实现云桌面统计**

平台返回授权总数、已分配数、到期日和桌面池；桌面池返回容量、已分配、规格、网段、VLAN/VXLAN；云桌面终端返回人员、桌面池、物理 IP 和虚拟桌面 IP 两个独立 IPAM 绑定。

- [ ] **步骤 5：注册接口、运行测试并提交**

```powershell
go test ./internal/store -run 'TestHCI|TestVDI|TestAssetRelation' -count=1
go test ./internal -run 'TestHCI|TestVDI|TestAssetRelation' -count=1
git add internal/store/virtualization_inventory.go internal/store/virtualization_inventory_test.go internal/server_virtualization_inventory.go internal/server_virtualization_inventory_test.go internal/server.go
git commit -m "feat: add HCI and VDI asset relations"
```

### 任务 11：实现分类导入导出

**文件：**

- 新增：`internal/store/asset_workspace_io.go`
- 新增：`internal/store/asset_workspace_io_test.go`
- 新增：`internal/server_asset_workspace_io.go`
- 新增：`internal/server_asset_workspace_io_test.go`
- 修改：`internal/server.go`

- [ ] **步骤 1：编写模板列和往返测试**

三类主模板的固定列分别为：

```go
var unifiedTemplateColumns = map[string][]string{
	"device":  {"资产编码", "资产名称", "设备类型", "状态", "负责人", "部门", "供应商", "字段模板数据"},
	"system":  {"系统编码", "系统名称", "系统类型", "状态", "供应商", "版本", "运行环境", "承载资产编码"},
	"license": {"许可编码", "软件名称", "许可类型", "状态", "供应商", "版本", "授权数量", "到期日期"},
}
```

设备模板另加“字段说明”工作表；许可模板和导出不得包含密钥。

- [ ] **步骤 2：实现预览令牌和事务提交**

预览返回 `token`、`total`、`valid`、`invalid`、`errors`；提交必须重读同一临时文件并在单事务中写入，任一行失败整批回滚。

- [ ] **步骤 3：实现统一导出**

统一导出复用 `UnifiedAssetQuery` 的筛选构造器，但调用不带 `LIMIT/OFFSET` 的 `AllUnifiedAssetsForProject`，不得依赖当前页面行或把总数塞进 `page_size`；三类同时筛选时输出三个工作表。

- [ ] **步骤 4：为网络关系提供独立模板**

VLAN/VXLAN、端口链路、超融合/云桌面关系各使用独立工作表，不塞入首次资产导入。

- [ ] **步骤 5：注册接口、运行测试并提交**

```text
GET  /api/cmdb/unified-assets/template?kind=device
POST /api/cmdb/unified-assets/import?kind=device&commit=0
GET  /api/cmdb/unified-assets/export
```

```powershell
go test ./internal/store -run TestAssetWorkspaceIO -count=1
go test ./internal -run TestAssetWorkspaceIO -count=1
git add internal/store/asset_workspace_io.go internal/store/asset_workspace_io_test.go internal/server_asset_workspace_io.go internal/server_asset_workspace_io_test.go internal/server.go
git commit -m "feat: add unified asset import and export"
```

### 任务 12：接入原生 API 与统一列表状态

**文件：**

- 修改：`integrations/netcatty/cmdb/api.js`
- 修改：`integrations/netcatty/cmdb/assetWorkspaceState.js`
- 修改：`integrations/netcatty/cmdb/assetWorkspaceState.test.js`

- [ ] **步骤 1：编写筛选序列化和操作路由测试**

断言空筛选不进入查询串，切换一级类别清空不适用的具体类型，编辑分别路由到 `terminal`、`cmdb`、`system`、`license`。

- [ ] **步骤 2：增加 API 方法**

```javascript
unifiedAssets: (params = {}) => req(`/api/cmdb/unified-assets?${toQuery(params)}`),
unifiedAsset: (source, id) => req(`/api/cmdb/unified-assets/${source}/${id}`),
assetTemplates: () => req('/api/cmdb/asset-templates'),
licenses: (params = {}) => req(`/api/cmdb/licenses?${toQuery(params)}`),
vlans: (params = {}) => req(`/api/cmdb/vlans?${toQuery(params)}`),
vxlans: (params = {}) => req(`/api/cmdb/vxlans?${toQuery(params)}`),
```

- [ ] **步骤 3：增加统一筛选归一化**

```javascript
export function normalizeAssetFilters(filters) {
  const next = { ...filters }
  if (!next.asset_kind) next.asset_type = ''
  return next
}
```

- [ ] **步骤 4：运行测试并提交**

```powershell
node --test integrations/netcatty/cmdb/assetWorkspaceState.test.js
git add integrations/netcatty/cmdb/api.js integrations/netcatty/cmdb/assetWorkspaceState.js integrations/netcatty/cmdb/assetWorkspaceState.test.js
git commit -m "feat: add native unified asset client"
```

### 任务 13：重构为一张统一资产列表

**文件：**

- 新增：`integrations/netcatty/cmdb/AssetTable.jsx`
- 修改：`integrations/netcatty/cmdb/DeviceAssets.jsx`
- 修改：`integrations/netcatty/cmdb/ui.jsx`
- 修改：`scripts/prepare-netcatty.test.mjs`

- [ ] **步骤 1：先修改装配测试表达新界面**

删除对 `TerminalAssets`、`Infrastructure`、`Systems` 三个页签和 `w-[420px]` 的正向断言，改为：

```javascript
assert.match(deviceAssetCenter, /<AssetTable/)
assert.match(deviceAssetCenter, /w-\[min\(720px,100%\)\]/)
assert.match(deviceAssetCenter, /设备资源/)
assert.match(deviceAssetCenter, /业务系统/)
assert.match(deviceAssetCenter, /软件许可/)
assert.doesNotMatch(deviceAssetCenter, /TabsTrigger[\s\S]*终端资产/)
assert.doesNotMatch(deviceAssetCenter, /终端资产概览/)
```

- [ ] **步骤 2：运行装配测试确认失败**

```powershell
node --test scripts/prepare-netcatty.test.mjs
```

预期：旧界面仍有三页签，断言失败。

- [ ] **步骤 3：实现紧凑页头和筛选栏**

`DeviceAssets.jsx` 只负责搜索、筛选状态、新增菜单、刷新和打开抽屉。搜索框使用：

```jsx
<VaultHeaderSearch
  className="w-[min(720px,100%)] min-w-[280px] flex-1"
  placeholder="搜索资产编码、名称、SN、IP、品牌、型号、供应商或许可证"
/>
```

筛选只显示一级类别、具体类型、状态和“更多筛选”；不显示统计卡和三个业务页签。

- [ ] **步骤 4：实现统一表格**

列固定为名称/编码、类别/类型、配置/供应商、负责人/部门、主要标识、状态、操作。表格行键使用 `assetRefKey(row)`，分页直接使用后端 `total`。

- [ ] **步骤 5：验证装配测试并提交**

```powershell
node --test integrations/netcatty/cmdb/assetWorkspaceState.test.js scripts/prepare-netcatty.test.mjs
git add integrations/netcatty/cmdb/AssetTable.jsx integrations/netcatty/cmdb/DeviceAssets.jsx integrations/netcatty/cmdb/ui.jsx scripts/prepare-netcatty.test.mjs
git commit -m "feat: replace asset tabs with unified table"
```

### 任务 14：实现三类新增入口和动态编辑器

**文件：**

- 新增：`integrations/netcatty/cmdb/assetTemplates.js`
- 新增：`integrations/netcatty/cmdb/assetTemplates.test.js`
- 新增：`integrations/netcatty/cmdb/AssetEditor.jsx`
- 新增：`integrations/netcatty/cmdb/SoftwareLicenseEditor.jsx`
- 修改：`integrations/netcatty/cmdb/DeviceAssets.jsx`
- 修改：`scripts/prepare-netcatty.test.mjs`

- [ ] **步骤 1：编写模板可见性测试**

```javascript
test('交换机隐藏计算机字段', () => {
  const keys = visibleFieldKeys(template('network_security'))
  for (const key of ['cpu_info', 'memory_mb', 'disk_info', 'os_type', 'mac']) assert.equal(keys.includes(key), false)
})

test('虚拟机显示供应商但不显示物理品牌', () => {
  const keys = visibleFieldKeys(template('virtual_cloud'))
  assert.equal(keys.includes('supplier'), true)
  assert.equal(keys.includes('vendor'), false)
})
```

- [ ] **步骤 2：实现“新增资产”三级菜单**

菜单只有 `device`、`system`、`license`。选择设备资源后先选择具体设备类型，再加载其 `template_key`；模板请求失败时显示真实错误并阻止打开空表单。

- [ ] **步骤 3：实现分组表单**

表单分为基础信息、类型配置、归属与位置、网络与系统、采购与维护。首建必填仅包含名称、具体类型和模板中明确标记 `required` 的字段；端口链路和复杂关系不在首建表单中。

- [ ] **步骤 4：按存储域提交且不清空隐藏旧值**

`terminal` 调用 `createAsset/updateAsset`，`cmdb` 调用 `createInfrastructure/replaceInfrastructure`，业务系统调用现有应用接口，许可调用许可接口。编辑时只提交可见且被用户修改的字段，模板隐藏字段不写空字符串。

- [ ] **步骤 5：运行测试并提交**

```powershell
node --test integrations/netcatty/cmdb/assetTemplates.test.js integrations/netcatty/cmdb/assetWorkspaceState.test.js scripts/prepare-netcatty.test.mjs
git add integrations/netcatty/cmdb/assetTemplates.js integrations/netcatty/cmdb/assetTemplates.test.js integrations/netcatty/cmdb/AssetEditor.jsx integrations/netcatty/cmdb/SoftwareLicenseEditor.jsx integrations/netcatty/cmdb/DeviceAssets.jsx scripts/prepare-netcatty.test.mjs
git commit -m "feat: add dynamic unified asset editor"
```

### 任务 15：实现统一资产档案与网络关系操作

**文件：**

- 新增：`integrations/netcatty/cmdb/AssetDetails.jsx`
- 新增：`integrations/netcatty/cmdb/NetworkInventory.jsx`
- 新增：`integrations/netcatty/cmdb/VirtualizationRelations.jsx`
- 修改：`integrations/netcatty/cmdb/DeviceAssets.jsx`
- 修改：`scripts/prepare-netcatty.test.mjs`

- [ ] **步骤 1：扩展装配测试**

断言所有行都打开标题为“资产档案”的 `DetailSheet`，设备资源显示“网络与链路”，许可显示“分配关系”，HCI/VDI 模板显示“关联信息”；首次新增编辑器中不得出现端口链路字段。

- [ ] **步骤 2：实现动态档案分区**

顺序固定为基础信息、类型专属配置、网络与链路、关联信息、生命周期与履历。空字段和模板不适用字段不渲染。

- [ ] **步骤 3：实现 IPAM 选择和双 IP 角色**

网络区块从空闲 IPAM 地址中选择；选择后展示网段、网络类型、默认 VLAN/VXLAN。云桌面终端分别保存 `physical_ip` 和 `virtual_desktop_ip`，两项都显示对应 IPAM 占用状态。

- [ ] **步骤 4：实现端口及链路维护**

资产保存后允许新增本端端口、选择对端资产与端口、方向、链路类型、VLAN、允许 VLAN、VXLAN、速率、状态和备注；保存成功后刷新双方视图。

- [ ] **步骤 5：实现 HCI/VDI 和许可关系区块**

集群显示节点和容量汇总；平台显示桌面池和授权；桌面池显示终端及网络；许可显示分配对象、数量与剩余数。关联对象名称可点击打开对应资产档案。

- [ ] **步骤 6：运行装配测试并提交**

```powershell
node --test integrations/netcatty/cmdb/*.test.js scripts/prepare-netcatty.test.mjs
git add integrations/netcatty/cmdb/AssetDetails.jsx integrations/netcatty/cmdb/NetworkInventory.jsx integrations/netcatty/cmdb/VirtualizationRelations.jsx integrations/netcatty/cmdb/DeviceAssets.jsx scripts/prepare-netcatty.test.mjs
git commit -m "feat: add unified asset detail relationships"
```

### 任务 16：补齐设备类型配置、导入导出和生命周期入口

**文件：**

- 修改：`integrations/netcatty/cmdb/ConfigCenter.jsx`
- 修改：`integrations/netcatty/cmdb/ImportDialog.jsx`
- 修改：`integrations/netcatty/cmdb/DeviceAssets.jsx`
- 修改：`integrations/netcatty/cmdb/AssetDetails.jsx`
- 修改：`scripts/prepare-netcatty.test.mjs`

- [ ] **步骤 1：在配置中心绑定模板和存储域**

设备类型编辑项增加“字段模板”和“数据域”。数据域只显示业务名称“终端台账”和“设备资源”，不得暴露数据库表名；已被资产引用的设备类型禁止删除。

- [ ] **步骤 2：接入三类模板、预览导入和筛选导出**

模板按钮根据当前一级类别下载对应模板；未选择类别时显示三类模板菜单。导入必须先显示有效/无效行和错误原因，再允许确认提交。导出传递当前全部筛选，但不传当前页码。

- [ ] **步骤 3：恢复全部既有生命周期动作**

终端详情保留编辑、调换使用人、维修换件、注销归档、履历和导出；设备资源保留编辑、克隆、批量编辑、注销归档；业务系统和许可使用软删除/归档，不物理删除。

- [ ] **步骤 4：更新装配断言并运行测试**

```powershell
node --test integrations/netcatty/cmdb/*.test.js scripts/prepare-netcatty.test.mjs
```

预期：三类新增、导入预览、导出、配置绑定、终端生命周期操作均有静态装配证据。

- [ ] **步骤 5：提交**

```powershell
git add integrations/netcatty/cmdb/ConfigCenter.jsx integrations/netcatty/cmdb/ImportDialog.jsx integrations/netcatty/cmdb/DeviceAssets.jsx integrations/netcatty/cmdb/AssetDetails.jsx scripts/prepare-netcatty.test.mjs
git commit -m "feat: complete unified asset workflows"
```

### 任务 17：删除正式界面对旧三页签的依赖

**文件：**

- 修改：`integrations/netcatty/cmdb/DeviceAssets.jsx`
- 修改：`integrations/netcatty/cmdb/state.js`
- 修改：`integrations/netcatty/cmdb/state.test.js`
- 修改：`scripts/prepare-netcatty.mjs`
- 修改：`scripts/prepare-netcatty.test.mjs`
- 保留但不再入口引用：`TerminalAssets.jsx`、`Infrastructure.jsx`、`Systems.jsx`

- [ ] **步骤 1：编写旧页面不可达测试**

`DeviceAssets.jsx` 不得导入或懒加载三个旧页面；搜索结果只传复合资产引用，不再切换 `assetTab`。

- [ ] **步骤 2：简化搜索定位状态**

`resolveSearchTarget` 对资产结果统一返回：

```javascript
{ module: 'assets', focusTarget: { source_table, source_id } }
```

人员、履历和 IPAM 的模块跳转保持不变。

- [ ] **步骤 3：保留旧文件作为回滚边界**

本阶段不删除旧页面文件和旧 API；仅移除正式入口引用。待统一工作区完整验收并稳定一个发布周期后，再单独决定是否清理。

- [ ] **步骤 4：运行装配测试并提交**

```powershell
node --test integrations/netcatty/cmdb/*.test.js scripts/prepare-netcatty.test.mjs
git add integrations/netcatty/cmdb/DeviceAssets.jsx integrations/netcatty/cmdb/state.js integrations/netcatty/cmdb/state.test.js scripts/prepare-netcatty.mjs scripts/prepare-netcatty.test.mjs
git commit -m "refactor: route all assets through unified workspace"
```

### 任务 18：全链路回归、文档同步和原生界面验收

**文件：**

- 修改：`AGENTS.md`
- 修改：`使用说明.md`
- 修改：`integrations/netcatty/README.md`
- 修改：`README.md`

- [ ] **步骤 1：运行 Go 全量测试**

```powershell
go test -count=1 ./...
```

预期：全部包通过，无项目隔离、迁移、导入回滚或旧生命周期回归。

- [ ] **步骤 2：运行集成源码和装配测试**

```powershell
node --test integrations/netcatty/cmdb/*.test.js scripts/prepare-netcatty.test.mjs integrations/netcatty/electron/cmdbBridge.test.cjs
```

预期：全部通过；装配产物无 `antd`、MUI 和旧三页签依赖。

- [ ] **步骤 3：装配锁定版本 Netcatty 并执行上游检查**

```powershell
node scripts/prepare-netcatty.mjs --target build/netcatty
```

随后在 `build/netcatty` 按其 `package.json` 实际脚本运行 Cmdb 相关测试、lint 和完整构建；不得猜测脚本名，先用 `npm run` 查看。

- [ ] **步骤 4：启动临时数据库进行原生手测**

```powershell
$env:NETCATTY_CMDB_DB_PATH = Join-Path $env:TEMP 'netcatty-cmdb-unified-assets-test.db'
node scripts/start-native-preview.cjs
```

手测清单：

1. 单列表可同时看到设备资源、业务系统、软件许可，搜索框约 640-720px。
2. 不出现终端资产概览、三个旧页签或状态悬浮窗。
3. 三类新增入口正确；交换机不显示 CPU/内存/硬盘/操作系统/MAC；虚拟机和业务系统不显示物理品牌。
4. 终端新增、调换、维修、归档后统一列表和镜像立即同步。
5. IPAM 分配/释放、VLAN/VXLAN 自动带出、端口双方链路均正确。
6. 超融合集群、节点、云桌面平台、桌面池和终端可逐级打开。
7. 软件许可数量、分配、到期和脱敏显示正确。
8. 导入先预览，失败整批回滚；导出数量等于全部匹配数而不是当前页。
9. 深色和浅色主题下无白底硬编码、文字过大、遮挡和横向溢出。

- [ ] **步骤 5：同步文档中的最终产品框架**

将 `AGENTS.md` 和 `使用说明.md` 中“设备资产内部保留三个独立子页面”的旧规则改为“一张统一资产列表”；明确正式界面仍使用 Netcatty 原生组件，并记录旧页面文件仅作短期回滚。

- [ ] **步骤 6：检查版本和数据污染**

```powershell
git status --short
node scripts/check-release-data.mjs
```

确认未提交 `.superpowers/` 原型、临时数据库、导入文件或演示数据；用户未要求 bump 时不修改版本号。

- [ ] **步骤 7：提交文档和验收调整**

```powershell
git add AGENTS.md 使用说明.md integrations/netcatty/README.md README.md
git commit -m "docs: document unified asset workspace"
```

---

## 四、阶段验收与回滚

| 阶段 | 完成任务 | 可独立验收结果 | 回滚边界 |
| --- | --- | --- | --- |
| 1 | 1-5 | 数据结构、模板、镜像和统一查询可用 | 关闭新路由，旧接口不变 |
| 2 | 6-7 | 业务系统和软件许可进入统一查询 | 保留新增表和列，隐藏新入口 |
| 3 | 8-10 | IPAM/VLAN/VXLAN、端口链路、HCI/VDI 可用 | 关闭关系入口，基础档案继续工作 |
| 4 | 11 | 分类导入导出可用 | 保留旧导入导出接口 |
| 5 | 12-17 | Netcatty 原生单列表、动态表单和档案可用 | 恢复旧三页签入口，不回删数据 |
| 6 | 18 | 全量自动化和原生手测通过 | 不发布，保留上一安装包 |

## 五、完成标准

- 设计文档 AC-01 至 AC-15 均能对应到自动化测试或明确手测证据。
- 所有新对象均按项目隔离并具备稳定 `sync_id`、`revision` 和软删除字段。
- 一张统一列表真实查询三类资产，不依赖前端拼接多个当前页结果。
- 终端、服务器主台账与 CMDB 镜像在同一事务内自动联动，不需要用户手动点同步。
- 正式界面完全使用 Netcatty 原生组件、主题和 Lucide 图标。
- 旧 CRUD、分页、筛选、调换、维修、归档、履历、导入导出能力均通过回归。
- 测试数据只写入临时数据库，发布产物不携带业务数据或演示数据。

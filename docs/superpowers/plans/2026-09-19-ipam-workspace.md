# Netcatty Cmdb IPAM/IP 工作区实施计划

> **面向执行代理：** 必须使用 `subagent-driven-development`（推荐）或 `executing-plans`，逐任务执行并用复选框追踪。每次提交只暂存本任务涉及的文件，不得混入工作树中的既有修改。

**目标：** 在 Netcatty 原生 Cmdb 中交付 12 列紧凑 IP 地址网格、设备与应用占用来源、网段/VLAN/VXLAN 管理、事务分配释放以及导入导出完整闭环。

**架构：** `ip_pool` 继续保存地址台账，设备关系复用 `cmdb_asset_interfaces.ip_pool_id`，业务系统通过新增 `cmdb_app_endpoints.ip_pool_id` 建立明确端点关系；后端根据关系集合计算设备、应用、共同占用和冲突，不信任前端状态。原生界面将现有单文件 IPAM 拆成控制器、地址网格、详情分配和网络目录组件，保持现有 API 风格、项目隔离和同步元数据。

**技术栈：** Go 1.25、SQLite、React、Netcatty `components/ui`、Tailwind、Radix UI、Lucide（仅操作按钮和详情，地址网格不使用图标）、Node.js 原生测试、Go `testing`、Excelize。

---

## 一、执行前置与文件职责

本计划与 `docs/superpowers/plans/2026-09-18-unified-asset-workspace.md` 共用设备接口、VLAN 和 VXLAN 模型。执行时先运行：

```powershell
go test ./internal/store -run 'TestAssetWorkspaceMigration|TestVLAN|TestVXLAN' -count=1
```

若测试不存在或失败，仍按本计划任务 1、8 的幂等迁移和网络目录实现继续执行；不得创建另一套设备接口表。重复涉及的 `cmdb_asset_interfaces` 列和 VLAN/VXLAN 接口以本计划测试契约为共同验收标准。

### 后端新增文件

- `internal/store/ipam_schema.go`：应用端点表、设备接口 IPAM 补列、索引和兼容回填。
- `internal/store/ipam_occupancy.go`：地址关系聚合、最终状态和互斥汇总。
- `internal/store/ipam_bindings.go`：设备/应用分配、逐项解除和状态同步事务。
- `internal/store/network_inventory.go`：VLAN、VXLAN、网段默认网络关系和引用保护。
- `internal/store/ipam_io.go`：IPAM 导入预览、事务提交和筛选导出。
- 上述文件各自对应同名 `_test.go`。
- `internal/server_ipam_relations.go`：地址详情、统一分配和逐项解除接口。
- `internal/server_network_inventory.go`：VLAN/VXLAN 接口。
- `internal/server_ipam_io.go`：IPAM 模板、导入预览/提交和增强导出接口。
- 上述服务文件各自对应同名 `_test.go`。

### 原生界面新增文件

- `integrations/netcatty/cmdb/IPAMAddressGrid.jsx`：A 方案纯数字地址网格和状态图例。
- `integrations/netcatty/cmdb/IPAMDetails.jsx`：地址详情、关联设备/应用和逐项解除。
- `integrations/netcatty/cmdb/IPAMAllocationDialog.jsx`：设备或业务系统分配表单。
- `integrations/netcatty/cmdb/IPAMNetworkCatalogs.jsx`：VLAN/VXLAN 目录视图。
- `integrations/netcatty/cmdb/ipamState.js` 与 `ipamState.test.js`：主机位、色调和请求载荷纯函数及测试。

### 主要修改文件

- `internal/store/store.go`、`project_schema.go`、`project_schema_test.go`：迁移、项目隔离和同步元数据。
- `internal/store/cmdb_store.go`、`cmdb_write.go`：设备接口 IPAM/VLAN/VXLAN 字段和事务同步。
- `internal/store/ip_pool.go`、`project_scope_ip_subnet_store.go`：可视化、汇总、网段默认值和重叠校验。
- `internal/server_ip_pool.go`、`internal/server.go`：响应契约和路由。
- `integrations/netcatty/cmdb/IPAM.jsx`、`api.js`：工作区控制器和 API。
- `scripts/prepare-netcatty.test.mjs`：原生装配和 A 方案静态断言。
- `使用说明.md`、`AGENTS.md`：最终验收后的产品规则。

---

## 二、实施任务

### 任务 1：新增幂等 IPAM 关系数据库结构

**文件：**

- 新增：`internal/store/ipam_schema.go`
- 新增：`internal/store/ipam_schema_test.go`
- 修改：`internal/store/store.go`
- 修改：`internal/store/project_schema.go`
- 修改：`internal/store/project_schema_test.go`
- 修改：`internal/store/cmdb_store.go`

- [ ] **步骤 1：编写旧库升级与幂等迁移测试**

从只有现有 `ip_pool`、`server_apps` 和旧 `cmdb_asset_interfaces` 的数据库开始，连续执行两次迁移并断言：

```go
var requiredInterfaceColumns = []string{"ip_pool_id", "vlan_id", "vxlan_id", "ip_role"}
var requiredEndpointColumns = []string{
    "id", "project_id", "sync_id", "revision", "app_id", "ip_pool_id",
    "host_asset_id", "purpose", "protocol", "port",
    "created_at", "updated_at", "deleted_at",
}
```

同时断言存在活动端点唯一索引：

```sql
CREATE UNIQUE INDEX idx_cmdb_app_endpoints_active
ON cmdb_app_endpoints(project_id, app_id, ip_pool_id, protocol, port)
WHERE deleted_at IS NULL;
```

- [ ] **步骤 2：运行测试确认失败**

```powershell
go test ./internal/store -run 'TestIPAMSchemaMigration|TestIPAMSchemaMigrationIsIdempotent' -count=1
```

预期：应用端点表或设备接口补列不存在。

- [ ] **步骤 3：实现迁移**

```go
func (s *Store) MigrateIPAMSchema() error
```

核心表：

```sql
CREATE TABLE IF NOT EXISTS cmdb_app_endpoints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL DEFAULT 1,
    sync_id TEXT NOT NULL DEFAULT '',
    revision INTEGER NOT NULL DEFAULT 1,
    app_id INTEGER NOT NULL,
    ip_pool_id INTEGER NOT NULL,
    host_asset_id INTEGER NOT NULL DEFAULT 0,
    purpose TEXT NOT NULL DEFAULT '',
    protocol TEXT NOT NULL DEFAULT '',
    port INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT '',
    deleted_at TEXT,
    FOREIGN KEY(app_id) REFERENCES server_apps(id),
    FOREIGN KEY(ip_pool_id) REFERENCES ip_pool(id)
);
```

使用现有 `addMissingColumns` 为 `cmdb_asset_interfaces` 补列，不重建设备接口表。

- [ ] **步骤 4：接入迁移、项目隔离和结构体**

在基础 CMDB 表后、`MigrateProjectSchema` 前执行迁移；把 `cmdb_app_endpoints` 加入 `projectScopedTables` 和测试夹具。补充：

```go
type AppEndpoint struct {
    ID, ProjectID, AppID, IPPoolID, HostAssetID int64
    SyncID, Purpose, Protocol, CreatedAt, UpdatedAt string
    Revision, Port int
}
```

为 `CmdbAssetInterface` 增加 `IPPoolID`、`VLANID`、`VXLANID` 和 `IPRole` JSON 字段。

- [ ] **步骤 5：运行测试并提交**

```powershell
go test ./internal/store -run 'TestIPAMSchemaMigration|TestProjectMigrationAddsSyncColumns' -count=1
git add internal/store/ipam_schema.go internal/store/ipam_schema_test.go internal/store/store.go internal/store/project_schema.go internal/store/project_schema_test.go internal/store/cmdb_store.go
git commit -m "feat: add ipam relation schema"
```

### 任务 2：实现地址占用聚合与互斥汇总

**文件：**

- 新增：`internal/store/ipam_occupancy.go`
- 新增：`internal/store/ipam_occupancy_test.go`
- 修改：`internal/store/legacy_models.go`
- 修改：`internal/store/ip_pool.go`

- [ ] **步骤 1：编写六种状态测试**

```go
tests := []struct{ ip string; devices, apps int; reserved bool; want string }{
    {"10.20.30.2", 1, 0, false, "device"},
    {"10.20.30.3", 0, 2, false, "application"},
    {"10.20.30.4", 1, 2, false, "mixed"},
    {"10.20.30.5", 0, 0, false, "free"},
    {"10.20.30.1", 0, 0, true, "reserved"},
    {"10.20.30.6", 2, 0, false, "conflict"},
}
```

断言两个应用共享不冲突；汇总 `device=1`、`application=1`、`mixed=1`、`conflict=1`，总占用为 4。

- [ ] **步骤 2：运行测试确认失败**

```powershell
go test ./internal/store -run 'TestIPAMOccupancyStates|TestIPAMSummaryUsesDisjointCounts|TestIPAMOccupancyProjectIsolation' -count=1
```

- [ ] **步骤 3：定义响应类型**

```go
type IPOccupancyState string
const (
    IPFree IPOccupancyState = "free"
    IPReserved IPOccupancyState = "reserved"
    IPDevice IPOccupancyState = "device"
    IPApplication IPOccupancyState = "application"
    IPMixed IPOccupancyState = "mixed"
    IPConflict IPOccupancyState = "conflict"
)
type IPRelation struct {
    Type, Name, Code, Role, Protocol string
    RelationID, TargetID, HostAssetID int64
    Port int
}
```

为 `IPEntry` 增加 `host_number`、`display_state`、设备/应用数量、冲突原因和关系数组只读字段。

- [ ] **步骤 4：实现批量关系查询和状态计算**

```go
func (s *Store) AttachIPOccupancyForProject(scope ProjectScope, entries []IPEntry) error
func deriveIPDisplayState(deviceCount, appCount int, reserved bool) (IPOccupancyState, string)
```

设备查询 `cmdb_asset_interfaces.ip_pool_id`，应用查询 `cmdb_app_endpoints.ip_pool_id`，一次列表请求使用固定数量查询。兼容期按完整 IP 精确读取 `assets.ip`、`assets.terminal_ip`、`servers.mgmt_ip` 和 `servers.biz_ip`；显式关系命中后不重复加入。

- [ ] **步骤 5：替换可视化、列表和汇总来源**

`VisualizeIPSubnetForProject`、`QueryIPEntriesForProject` 和 `AllIPEntriesForProject` 返回相同状态字段。`IPPoolSummary` 增加 `Device`、`Application`、`Mixed`、`Conflict`、`Reserved`；`Used` 为唯一占用地址数。

- [ ] **步骤 6：运行测试并提交**

```powershell
go test ./internal/store -run 'TestIPAMOccupancy|TestIPAMSummary|TestVisualizeIPSubnet' -count=1
git add internal/store/ipam_occupancy.go internal/store/ipam_occupancy_test.go internal/store/legacy_models.go internal/store/ip_pool.go
git commit -m "feat: derive ipam occupancy sources"
```

### 任务 3：实现设备与应用分配、逐项解除事务

**文件：**

- 新增：`internal/store/ipam_bindings.go`
- 新增：`internal/store/ipam_bindings_test.go`
- 修改：`internal/store/cmdb_write.go`
- 修改：`internal/store/ip_pool.go`

- [ ] **步骤 1：编写事务测试**

覆盖：未物化地址分配给设备时创建 `ip_pool` 和默认接口；设备地址再分配应用后变 `mixed`；逐项解除正确降级；最后关系解除后变 `free`；多关系旧释放被拒绝；跨项目对象整笔回滚；第二个不同设备占用返回具体冲突对象。

- [ ] **步骤 2：运行测试确认失败**

```powershell
go test ./internal/store -run 'TestAllocateIPTarget|TestRemoveIPRelation|TestIPAMBindingRollback' -count=1
```

- [ ] **步骤 3：定义统一分配请求**

```go
type IPAllocationRequest struct {
    Subnet, IP, TargetType, IPRole, Purpose, Protocol, Remark string
    TargetID, InterfaceID, VLANID, VXLANID, HostAssetID int64
    Port int
}
```

- [ ] **步骤 4：实现事务入口**

```go
func (s *Store) AllocateIPTargetForProject(scope ProjectScope, req IPAllocationRequest) (*IPEntry, error)
func (s *Store) RemoveIPRelationForProject(scope ProjectScope, ipID int64, relationType string, relationID int64) error
```

设备目标更新选定接口或创建“默认接口”；应用目标创建应用端点。事务结束前重新计算关系数量并同步兼容 `ip_pool.status`。

- [ ] **步骤 5：接入资产接口保存路径和旧接口**

资产接口保存时明确选择 `ip_pool_id` 才建立关系；只有文本 IP 时仅精确匹配同项目已有记录，不猜网段。替换接口前重新计算引用。`AllocateIPToAssetForProject` 保留旧终端兼容；多关系地址调用 `ReleaseIPForProject` 返回具体关系数量错误。

- [ ] **步骤 6：运行测试并提交**

```powershell
go test ./internal/store -run 'TestAllocateIP|TestRemoveIPRelation|TestCmdb.*IP|TestIPAMBinding' -count=1
git add internal/store/ipam_bindings.go internal/store/ipam_bindings_test.go internal/store/cmdb_write.go internal/store/ip_pool.go
git commit -m "feat: transact ipam target bindings"
```

### 任务 4：扩展 IPAM HTTP 契约

**文件：**

- 新增：`internal/server_ipam_relations.go`
- 新增：`internal/server_ipam_relations_test.go`
- 修改：`internal/server_ip_pool.go`
- 修改：`internal/server.go`
- 修改：`integrations/netcatty/cmdb/api.js`

- [ ] **步骤 1：编写接口测试**

```text
GET    /api/ip_pool/{id}/relations
POST   /api/ip_pool/allocate
DELETE /api/ip_pool/{id}/relations/{relation_type}/{relation_id}
```

项目缺失、跨项目 ID、无效目标类型、冲突设备、无效端口和多关系旧释放均返回 `4xx` 及具体中文错误。

- [ ] **步骤 2：运行测试确认失败**

```powershell
go test ./internal -run 'TestIPAMRelationAPI|TestIPAMAllocateAPI|TestIPAMProjectIsolation' -count=1
```

- [ ] **步骤 3：实现处理器和稳定 JSON**

```json
{"id":12,"ip":"10.20.30.12","display_state":"mixed","device_count":1,"application_count":2}
```

详情返回设备和应用关系数组；逐项解除必须重新确认关系属于当前 IP 和项目。汇总和可视化返回互斥计数、主机位、最终状态和关系数量。

- [ ] **步骤 4：接入 API 客户端**

```javascript
ipRelations: (id) => req(`/api/ip_pool/${id}/relations`),
allocateIPTarget: (body) => post('/api/ip_pool/allocate', body),
removeIPRelation: (ipId, type, relationId) => del(`/api/ip_pool/${ipId}/relations/${type}/${relationId}`),
```

- [ ] **步骤 5：运行测试并提交**

```powershell
go test ./internal -run 'TestIPAM' -count=1
git add internal/server_ipam_relations.go internal/server_ipam_relations_test.go internal/server_ip_pool.go internal/server.go integrations/netcatty/cmdb/api.js
git commit -m "feat: expose ipam relation api"
```

### 任务 5：建立原生界面状态契约

**文件：**

- 新增：`integrations/netcatty/cmdb/ipamState.js`
- 新增：`integrations/netcatty/cmdb/ipamState.test.js`

- [ ] **步骤 1：编写纯函数测试**

```javascript
test('地址格只显示主机位', () => assert.equal(hostNumber('10.20.30.12'), '12'))
test('状态映射为互斥色调', () => {
  assert.equal(addressTone({ display_state: 'device' }), 'device')
  assert.equal(addressTone({ display_state: 'application' }), 'application')
  assert.equal(addressTone({ display_state: 'mixed' }), 'mixed')
  assert.equal(addressTone({ display_state: 'conflict' }), 'conflict')
  assert.equal(addressTone({ display_state: 'free' }), 'neutral')
})
```

继续覆盖设备/应用分配请求字段和多关系不可全量释放。

- [ ] **步骤 2：运行测试确认失败**

```powershell
node --test integrations/netcatty/cmdb/ipamState.test.js
```

- [ ] **步骤 3：实现最小纯函数**

```javascript
export const hostNumber = (ip = '') => ip.split('.').at(-1) || ip
export const addressTone = (row = {}) => ({
  device: 'device', application: 'application', mixed: 'mixed',
  conflict: 'conflict', reserved: 'reserved', free: 'neutral',
}[row.display_state] || 'neutral')
```

另实现 `buildAllocationPayload`、`relationLabel` 和 `canReleaseAll`。

- [ ] **步骤 4：运行测试并提交**

```powershell
node --test integrations/netcatty/cmdb/ipamState.test.js
git add integrations/netcatty/cmdb/ipamState.js integrations/netcatty/cmdb/ipamState.test.js
git commit -m "test: define ipam ui state"
```

### 任务 6：实现 A 方案原生地址网格

**文件：**

- 新增：`integrations/netcatty/cmdb/IPAMAddressGrid.jsx`
- 修改：`integrations/netcatty/cmdb/IPAM.jsx`
- 修改：`scripts/prepare-netcatty.test.mjs`

- [ ] **步骤 1：先写装配后的静态界面断言**

在 `scripts/prepare-netcatty.test.mjs` 增加针对装配产物 `src/components/cmdb/IPAMAddressGrid.jsx` 的断言：

```javascript
test('IPAM 地址网格采用 A 方案且不恢复地址图标', async () => {
  const source = await readFile(join(target, 'src/components/cmdb/IPAMAddressGrid.jsx'), 'utf8')
  assert.match(source, /grid-cols-\[repeat\(auto-fill,minmax\(60px,1fr\)\)\]/)
  assert.match(source, /h-9/)
  assert.match(source, /hostNumber\(row\.ip\)/)
  assert.doesNotMatch(source, /CheckCircle2|Lock|Unlock|Gauge/)
})
```

同时在 `IPAM.jsx` 装配断言中检查默认 `pageSize` 为 `96`，顶部存在 `IP 地址`、`VLAN`、`VXLAN` 三个分段选项。

- [ ] **步骤 2：运行测试确认失败**

```powershell
node --test scripts/prepare-netcatty.test.mjs
```

预期：`IPAMAddressGrid.jsx` 尚不存在或仍包含旧的图标式大方格。

- [ ] **步骤 3：实现无图标的紧凑数字网格**

`IPAMAddressGrid.jsx` 只接收展示数据和选择事件，不发请求：

```jsx
const tones = {
  neutral: 'border-border bg-muted/35 text-foreground',
  reserved: 'border-dashed border-border bg-muted/55 text-muted-foreground',
  device: 'border-blue-500/70 bg-blue-500/18 text-blue-950 dark:text-blue-100',
  application: 'border-violet-500/70 bg-violet-500/18 text-violet-950 dark:text-violet-100',
  mixed: 'border-amber-500/75 bg-amber-500/22 text-amber-950 dark:text-amber-100',
  conflict: 'border-red-500/80 bg-red-500/22 text-red-950 dark:text-red-100',
}

export default function IPAMAddressGrid({ rows = [], selectedIP, loading, onSelect }) {
  if (loading) return <p className="text-sm text-muted-foreground">加载中...</p>
  return <div data-ipam-address-grid className="grid grid-cols-[repeat(auto-fill,minmax(60px,1fr))] gap-1">
    {rows.map((row) => {
      const tone = addressTone(row)
      return <button
        type="button"
        key={row.id || row.ip}
        title={`${row.ip} · ${stateLabel(row.display_state)}`}
        aria-label={`${row.ip} ${stateLabel(row.display_state)}`}
        aria-pressed={selectedIP === row.ip}
        onClick={() => onSelect(row)}
        className={cn('h-9 min-w-0 rounded border px-1 font-mono text-xs', tones[tone], selectedIP === row.ip && 'ring-1 ring-primary ring-offset-1 ring-offset-background')}
      >
        {hostNumber(row.ip)}
      </button>
    })}
  </div>
}
```

图例使用 `span` 小色块和中文标签，不使用 Lucide 状态图标。完整 IP 仅出现在 CIDR 标题、`title` 和详情中。

- [ ] **步骤 4：把 IPAM 控制器改为左侧网段栏和三段视图**

`IPAM.jsx` 保留搜索、状态筛选、分页、网段 CRUD 和导出，删除旧 `SubnetOverview` 卡片网格以及内联地址格。状态改为：

```javascript
const [section, setSection] = useState('addresses')
const [pageSize, setPageSize] = useState(96)
const [selectedAddress, setSelectedAddress] = useState(null)
```

布局固定为：左侧紧凑网段列表；右侧顶部搜索与操作；其下 `IP 地址 / VLAN / VXLAN` 分段控件；地址视图显示 CIDR、互斥汇总、色块图例、筛选、网格和 `[48, 96, 192]` 分页。切换网段、状态或关键词时将页码重置为 1。

- [ ] **步骤 5：运行原生界面测试并提交**

```powershell
node --test integrations/netcatty/cmdb/ipamState.test.js scripts/prepare-netcatty.test.mjs
git add integrations/netcatty/cmdb/IPAMAddressGrid.jsx integrations/netcatty/cmdb/IPAM.jsx scripts/prepare-netcatty.test.mjs
git commit -m "feat: build compact ipam address grid"
```

### 任务 7：实现地址详情与设备/应用分配

**文件：**

- 新增：`integrations/netcatty/cmdb/IPAMDetails.jsx`
- 新增：`integrations/netcatty/cmdb/IPAMAllocationDialog.jsx`
- 修改：`integrations/netcatty/cmdb/IPAM.jsx`
- 修改：`integrations/netcatty/cmdb/api.js`
- 修改：`integrations/netcatty/cmdb/ipamState.test.js`

- [ ] **步骤 1：补齐分配载荷和状态降级测试**

```javascript
test('设备和应用分配生成不同载荷', () => {
  assert.deepEqual(buildAllocationPayload('10.20.30.12', {
    target_type: 'device', target_id: '21', interface_id: '7', ip_role: '管理 IP', vlan_id: '100', vxlan_id: '5000',
  }), { ip: '10.20.30.12', target_type: 'device', target_id: 21, interface_id: 7, ip_role: '管理 IP', vlan_id: 100, vxlan_id: 5000 })
  assert.deepEqual(buildAllocationPayload('10.20.30.12', {
    target_type: 'application', target_id: '31', purpose: '访问入口', protocol: 'https', port: '443', host_asset_id: '21',
  }), { ip: '10.20.30.12', target_type: 'application', target_id: 31, purpose: '访问入口', protocol: 'https', port: 443, host_asset_id: 21 })
})

test('共同占用必须逐项解除', () => {
  assert.equal(canReleaseAll({ device_count: 1, application_count: 1 }), false)
  assert.equal(deriveClientState({ device_count: 1, application_count: 0, reserved: false }), 'device')
  assert.equal(deriveClientState({ device_count: 0, application_count: 1, reserved: false }), 'application')
})
```

- [ ] **步骤 2：运行测试确认失败**

```powershell
node --test integrations/netcatty/cmdb/ipamState.test.js
```

- [ ] **步骤 3：实现地址详情抽屉**

`IPAMDetails.jsx` 通过 `api.ipRelations(record.id)` 加载详情，分成“网络信息”“设备占用”“应用占用”三段。设备行显示设备、资产编码、接口、IP 用途、人员和组织；应用行显示系统、用途、协议、端口、负责人和承载设备。每条关系独立提供解除按钮：

```jsx
<ActionIcon
  label={`解除${relationLabel(item)}`}
  danger
  onClick={() => onRemove(item.type, item.relation_id)}
>
  <Unlink size={15} />
</ActionIcon>
```

设备和业务系统名称调用 `onNavigate` 穿透到统一设备资产档案。空闲地址显示“分配”，占用地址显示“继续关联”；多关系地址不显示“一键释放”。

- [ ] **步骤 4：实现分配对话框及字段联动**

`IPAMAllocationDialog.jsx` 使用 Netcatty `Dialog`、`Tabs`、`Combobox`、`Input` 和已有 `Fields`，不引入新表单库。设备页签字段为设备、已有接口/自动创建默认接口、IP 用途、VLAN、VXLAN；应用页签字段为业务系统、用途、协议、端口、承载设备。切换目标类型时清理另一类型的专属字段，提交时调用：

```javascript
await api.allocateIPTarget(buildAllocationPayload(record.ip, values))
```

设备下拉读取统一 `cmdb_assets`，业务系统下拉读取 `server_apps`；VLAN/VXLAN 默认使用网段值并允许修改。

- [ ] **步骤 5：接入详情、分配、逐项解除和刷新**

`api.js` 增加：

```javascript
ipRelations: (id) => req(`/api/ip_pool/${id}/relations`),
allocateIPTarget: (body) => post('/api/ip_pool/allocate', body),
removeIPRelation: (ipId, type, relationId) => del(`/api/ip_pool/${ipId}/relations/${type}/${relationId}`),
```

`IPAM.jsx` 在分配或解除成功后同时刷新地址列表、网段统计和当前详情；后端失败保留弹窗内容并展示原始中文错误，不用本地修改行状态伪造成功。

- [ ] **步骤 6：运行测试并提交**

```powershell
node --test integrations/netcatty/cmdb/ipamState.test.js scripts/prepare-netcatty.test.mjs
git add integrations/netcatty/cmdb/IPAMDetails.jsx integrations/netcatty/cmdb/IPAMAllocationDialog.jsx integrations/netcatty/cmdb/IPAM.jsx integrations/netcatty/cmdb/api.js integrations/netcatty/cmdb/ipamState.test.js
git commit -m "feat: manage ipam address relations"
```

### 任务 8：实现 VLAN、VXLAN 和网段网络目录

**文件：**

- 新增：`internal/store/network_inventory.go`
- 新增：`internal/store/network_inventory_test.go`
- 新增：`internal/server_network_inventory.go`
- 新增：`internal/server_network_inventory_test.go`
- 新增：`integrations/netcatty/cmdb/IPAMNetworkCatalogs.jsx`
- 修改：`internal/store/ipam_schema.go`
- 修改：`internal/store/project_schema.go`
- 修改：`internal/store/project_scope_ip_subnet_store.go`
- 修改：`internal/server.go`
- 修改：`integrations/netcatty/cmdb/IPAM.jsx`
- 修改：`integrations/netcatty/cmdb/api.js`

- [ ] **步骤 1：编写目录范围、重叠和引用保护测试**

覆盖 VLAN `1-4094`、VNI `1-16777215`、同项目编号唯一、不同项目可复用、CIDR 不可重叠、被网段或接口引用时不可删除、停用后不可新分配但旧关系仍可读取。

```go
func TestNetworkInventoryRangesAndProjectIsolation(t *testing.T)
func TestSubnetCIDROverlapIsRejected(t *testing.T)
func TestDeleteNetworkInventoryReturnsReferenceCounts(t *testing.T)
func TestDisabledNetworkInventoryCannotBeAllocated(t *testing.T)
```

- [ ] **步骤 2：运行测试确认失败**

```powershell
go test ./internal/store -run 'TestNetworkInventory|TestSubnetCIDR|TestDeleteNetwork|TestDisabledNetwork' -count=1
```

- [ ] **步骤 3：实现网络目录模型和项目隔离 CRUD**

```go
type VLAN struct {
    ID, ProjectID, VLANID int64
    SyncID, Name, NetworkType, Purpose, Status, CreatedAt, UpdatedAt string
    Revision int64
}

type VXLAN struct {
    ID, ProjectID, VNI, VLANID int64
    SyncID, Name, Purpose, Status, CreatedAt, UpdatedAt string
    Revision int64
}
```

`cmdb_vlans` 和 `cmdb_vxlans` 使用 `project_id`、`sync_id`、`revision`、时间戳和 `deleted_at`，并加入 `projectScopedTables`。所有增改停用操作递增 `revision`；关系保存使用本地 ID，项目快照使用稳定 `sync_id`。新增 `List/Create/Update/Disable/DeleteVLANForProject` 和对应 VXLAN 方法，删除前返回网段、接口、应用端点和链路的引用数量。

- [ ] **步骤 4：升级网段默认关系和 CIDR 校验**

为 `ip_subnets` 增加 `default_vlan_id`、`default_vxlan_id`、`revision`、`updated_at` 和 `deleted_at`，保留旧 `vlan` 文本字段只读兼容。创建或修改网段时用 `net.ParseCIDR` 规范化 IPv4 CIDR，查询同项目活动网段并用范围首尾地址判断重叠；网关必须落在该网段中。

- [ ] **步骤 5：实现 HTTP 契约**

```text
GET    /api/cmdb/vlans?page=1&page_size=20&keyword=&status=
POST   /api/cmdb/vlans
PUT    /api/cmdb/vlans/{id}
DELETE /api/cmdb/vlans/{id}
POST   /api/cmdb/vlans/{id}/disable
GET    /api/cmdb/vxlans?page=1&page_size=20&keyword=&status=
POST   /api/cmdb/vxlans
PUT    /api/cmdb/vxlans/{id}
DELETE /api/cmdb/vxlans/{id}
POST   /api/cmdb/vxlans/{id}/disable
```

越界、重叠和引用错误返回 `400/409` 及引用数量；跨项目 ID 返回 `404`。

- [ ] **步骤 6：实现原生紧凑目录表格**

`IPAMNetworkCatalogs.jsx` 根据 `kind` 显示 VLAN 或 VXLAN 的 `DataTable`、搜索、状态筛选、分页、新增/编辑弹窗和停用/删除确认。VLAN 列为编号、名称、网络类型、用途、关联网段、状态；VXLAN 列为 VNI、名称、用途、关联 VLAN、状态。页面使用单张紧凑表格，不使用卡片网格。

- [ ] **步骤 7：运行测试并提交**

```powershell
go test ./internal/store ./internal -run 'TestNetworkInventory|TestSubnetCIDR|TestVLAN|TestVXLAN' -count=1
node --test integrations/netcatty/cmdb/ipamState.test.js scripts/prepare-netcatty.test.mjs
git add internal/store/network_inventory.go internal/store/network_inventory_test.go internal/store/ipam_schema.go internal/store/project_schema.go internal/store/project_scope_ip_subnet_store.go internal/server_network_inventory.go internal/server_network_inventory_test.go internal/server.go integrations/netcatty/cmdb/IPAMNetworkCatalogs.jsx integrations/netcatty/cmdb/IPAM.jsx integrations/netcatty/cmdb/api.js
git commit -m "feat: manage vlan and vxlan inventory"
```

### 任务 9：实现 IPAM 导入预览与全量筛选导出

**文件：**

- 新增：`internal/store/ipam_io.go`
- 新增：`internal/store/ipam_io_test.go`
- 新增：`internal/server_ipam_io.go`
- 新增：`internal/server_ipam_io_test.go`
- 修改：`internal/server.go`
- 修改：`integrations/netcatty/cmdb/IPAM.jsx`
- 修改：`integrations/netcatty/cmdb/IPAMNetworkCatalogs.jsx`
- 修改：`integrations/netcatty/cmdb/api.js`

- [ ] **步骤 1：编写 XLSX 往返和事务回滚测试**

测试工作簿固定包含 `网段`、`IP地址`、`VLAN`、`VXLAN` 四个工作表。覆盖模板表头、合法预览不写库、重复 IP/CIDR 重叠/VLAN 越界/未知对象给出行号、确认导入任一行失败整批回滚，以及导出忽略当前页但保留网段、状态、占用来源和关键词筛选。

```go
func TestIPAMImportPreviewDoesNotWrite(t *testing.T)
func TestIPAMImportCommitRollsBackAllSheets(t *testing.T)
func TestIPAMExportUsesFiltersNotPagination(t *testing.T)
func TestIPAMExportContainsOccupancySources(t *testing.T)
```

- [ ] **步骤 2：运行测试确认失败**

```powershell
go test ./internal/store ./internal -run 'TestIPAMImport|TestIPAMExport' -count=1
```

- [ ] **步骤 3：实现解析、预览和单事务提交**

```go
type IPAMImportResult struct {
    Total   int               `json:"total"`
    Valid   int               `json:"valid"`
    Created int               `json:"created"`
    Updated int               `json:"updated"`
    Errors  []IPAMImportError `json:"errors"`
    Token   string            `json:"token,omitempty"`
}

type IPAMImportError struct {
    Sheet   string `json:"sheet"`
    Row     int    `json:"row"`
    Field   string `json:"field"`
    Message string `json:"message"`
}

func (s *Store) PreviewIPAMImportForProject(scope ProjectScope, r io.Reader) (*IPAMImportResult, error)
func (s *Store) CommitIPAMImportForProject(scope ProjectScope, r io.Reader) (*IPAMImportResult, error)
```

预览按 VLAN、VXLAN、网段、地址和关系的依赖顺序校验，但不写数据库。提交重新解析和校验文件，并在一个 `sql.Tx` 内按同一顺序写入；任何工作表任一行失败均回滚。设备和应用关系只接受资产编码/系统编码的明确匹配，不按名称猜测。

- [ ] **步骤 4：实现模板、预览、提交和导出接口**

```text
GET  /api/ipam/template
POST /api/ipam/import?commit=false
POST /api/ipam/import?commit=true
GET  /api/ipam/export?subnet=&state=&source=&keyword=
```

导出 `IP地址` 工作表包含完整 IP、网段、最终状态、设备名称与资产编码、应用名称与系统编码、VLAN、VXLAN 和备注；查询使用全部匹配记录，不读取 `page` 和 `page_size`。

- [ ] **步骤 5：接入原生文件桥和预览界面**

`api.js` 增加：

```javascript
downloadIPAMTemplate: () => exportFile('/api/ipam/template', 'ipam-template.xlsx'),
importIPAM: (options) => importFile('/api/ipam/import', options),
exportIPAM: (filters) => exportFile(`/api/ipam/export?${query(filters)}`, 'ipam.xlsx'),
```

`IPAM.jsx` 的导入按钮使用现有 `ImportDialog`；地址、VLAN 和 VXLAN 导出均传递当前筛选条件。导入成功后刷新网段、地址、汇总和网络目录。

- [ ] **步骤 6：运行测试并提交**

```powershell
go test ./internal/store ./internal -run 'TestIPAMImport|TestIPAMExport' -count=1
node --test integrations/netcatty/cmdb/state.test.js scripts/prepare-netcatty.test.mjs
git add internal/store/ipam_io.go internal/store/ipam_io_test.go internal/server_ipam_io.go internal/server_ipam_io_test.go internal/server.go integrations/netcatty/cmdb/IPAM.jsx integrations/netcatty/cmdb/IPAMNetworkCatalogs.jsx integrations/netcatty/cmdb/api.js
git commit -m "feat: add ipam data exchange"
```

### 任务 10：完成同步契约、全量回归和使用文档

**文件：**

- 修改：`internal/store/cmdb_snapshot.go`
- 修改：`internal/store/cmdb_snapshot_test.go`
- 修改：`scripts/prepare-netcatty.test.mjs`
- 修改：`使用说明.md`
- 修改：`AGENTS.md`

- [ ] **步骤 1：把新增关系纳入项目规范快照测试**

在已有项目快照测试中创建 VLAN、VXLAN、网段默认关系、设备接口 IP 关系和应用端点，导出后断言集合使用稳定 `sync_id` 引用而不是本地自增 ID；在空库应用快照后再次导出，两份规范数据去除生成时间后相同。

```go
func TestProjectSnapshotRoundTripsIPAMRelations(t *testing.T)
func TestProjectSnapshotRejectsConflictingDeviceIP(t *testing.T)
```

冲突快照必须在预检阶段返回具体 IP 和两个设备编码，应用失败时整个项目事务回滚。若 `cmdb_snapshot.go` 尚未由项目同步计划创建，则先完成 `docs/superpowers/plans/2026-09-17-netcatty-cmdb-project-sync-implementation.md` 的任务 13，再执行本步骤；不得用上传 SQLite 文件代替。

- [ ] **步骤 2：运行同步契约测试**

```powershell
go test ./internal/store -run 'TestProjectSnapshot.*IPAM|TestProjectSnapshotRejectsConflictingDeviceIP' -count=1
```

预期：同项目关系完整往返，跨项目引用和双设备冲突被拒绝，失败不产生部分数据。

- [ ] **步骤 3：完成静态装配和正式数据检查**

`scripts/prepare-netcatty.test.mjs` 断言装配后的 Cmdb 可达源码不包含 `antd`、`@mui`，IP 地址格不包含状态图标，正式源和发布资源不包含原型示例网段 `10.20.30.0/24`。原型仅保留在 `.superpowers/`，不得加入发布装配或提交。

- [ ] **步骤 4：运行全部自动化验证**

```powershell
go test ./...
node --test integrations/netcatty/cmdb/*.test.js scripts/prepare-netcatty.test.mjs
node scripts/prepare-netcatty.mjs --target build/netcatty
npm --prefix build/netcatty run lint
npm --prefix build/netcatty run build
```

任何命令失败都先修复对应任务范围内的问题并重新运行该命令；不得把失败项记录为通过。

- [ ] **步骤 5：在 Netcatty 桌面端完成手测**

使用临时 `NETCATTY_CMDB_DB_PATH` 启动装配后的桌面端，按以下顺序验收并记录截图或日志路径：

1. 新增 `/24` 网段后默认每页 96 个地址，常见桌面宽度约 12 列、块高 36px、格内只有主机位数字。
2. 分别建立设备、应用、共同占用和双设备冲突，确认蓝、紫、金、红状态；空闲和保留保持中性。
3. 共同占用逐项解除后依次降级为设备或应用占用，最后恢复空闲。
4. VLAN/VXLAN 新增、编辑、停用、分页和引用保护可用；重叠网段保存失败且错误明确。
5. 导入先显示预览，错误文件不写库；导出包含全部筛选结果且不受当前页限制。
6. 从地址详情进入设备和业务系统档案；亮色、深色和窄窗口下无重叠、横向溢出或不可达操作。

- [ ] **步骤 6：更新文档和项目硬约束**

`使用说明.md` 的 IPAM/IP 小节写明六种状态、12 列主机位网格、设备/应用明确关系、逐项解除、VLAN/VXLAN 和导入导出。`AGENTS.md` 增加已确认的 A 方案和“地址格不得显示图标、完整 IP、对象名称或第二行文字”约束，避免后续回退旧设计。

- [ ] **步骤 7：检查差异并提交**

```powershell
git diff --check
git status --short
git add internal/store/cmdb_snapshot.go internal/store/cmdb_snapshot_test.go scripts/prepare-netcatty.test.mjs 使用说明.md AGENTS.md
git commit -m "test: verify ipam workspace delivery"
```

提交前确认暂存区只包含本任务文件；若某文件已有用户改动，逐块暂存本任务差异，不覆盖或混入无关内容。

---

## 三、完成定义

只有同时满足以下条件，才能把 IPAM/IP 工作区标记为完成：

- 设计文档 AC-01 至 AC-15 均有对应自动化测试或桌面手测证据。
- 地址占用来自设备接口和应用端点明确关系，前端不推断最终状态。
- A 方案在装配后的 Netcatty 桌面端生效，不只存在于原型文件。
- 查询、筛选、分页、网段 CRUD、分配、逐项解除、VLAN/VXLAN、导入导出均可闭环。
- 所有写入按项目隔离，新增实体具备稳定同步元数据；正式包不含演示业务数据。
- 后端全量测试、原生界面测试、装配测试、lint 和 build 全部通过。

完整云端加密、对象存储和多设备合并仍由项目同步实施计划负责；本计划负责把 IPAM 新增实体、关系和冲突规则接入其规范快照契约，不能据此单独宣称云同步整体验收完成。

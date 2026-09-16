# nettopo CMDB P0-1 阶段 A 实施计划

> **给执行者：** 本计划按任务逐条执行，每个任务以「写失败测试 → 跑测试确认失败 → 最小实现 → 跑测试确认通过 → 提交」的节奏推进。任务之间不得跳步。
>
> **需求依据：** `docs/nettopo-cmdb-复刻需求清单.md`（全部为登录后实测证据，原始截图与 DOM 清单在 `docs/evidence/nettopo/`）

**目标（阶段 A）：** 让 CMDB 模块长出真实可用的资产台账骨架 —— 独立数据模型落地、旧台账数据可映射进来、30 列资源列表可查可分页可筛选排序。

**架构：** 新增独立的 `cmdb_*` 数据表承载 nettopo 通用资产模型，**现有 5 张表与全部现有页面、接口一律不动**；旧 `assets`/`servers` 数据通过幂等映射单向灌入 CMDB 表。后端沿用 `net/http` + 原生 SQL（不引入 ORM），前端沿用 React 18 + Ant Design 5（不引入状态管理库、不引入路由库）。

**技术栈：** Go（标准库 `net/http`、`database/sql`、`modernc.org/sqlite`）+ SQLite；React 18 + Ant Design 5 + Vite。

**交付边界：** 阶段 A 只做「看得见、查得动」，**不含任何写操作**（新增/编辑/删除/导入/导出留给阶段 B、C）。写完阶段 A 停下来验收，确认后再出阶段 B 计划。

---

## 0. 开工前置确认（三项，必须先有结论）

| 编号 | 决策 | 本计划采用 | 说明 |
| --- | --- | --- | --- |
| D1 | 导航框架 | **方案乙**：左侧导航保留，CMDB 模块内部显示顶部 7 项导航 | 不动「左侧导航 + 全局查询默认首页」的已确认框架，符合 AGENTS.md 第 2、3 条 |
| D2 | 数据模型 | **方案甲**：新增 `cmdb_*` 表，现有 `assets`/`servers` 保留不动，单向映射 | 现有页面与接口零改动，可整体回滚 |
| D3 | 新增数据表 | **需要你一句话确认** | AGENTS.md 第 3 条禁止新增关系表。阶段 A 要新增 6 张 `cmdb_*` 表，这一条不解除则无法开工 |

> D1、D2 均不触碰已确认能力，我按推荐方案写进计划；D3 需要你明确回复「解除新增表限制」后才能动手。

---

## 1. 全局约束（每个任务都适用）

- 中文文件统一 UTF-8 读写；发现乱码先判断是读取方式还是文件损坏。
- 后端不引入 ORM、FTS、缓存；前端不引入路由库、状态管理库、新 UI 框架。
- 新接口沿用现有 JSON 风格：成功返回数据对象，失败返回 `{"error": "中文原因"}`，分页统一返回 `list` / `total` / `page` / `page_size`。
- 错误必须显式返回，禁止吞异常、伪造成功、用空结果掩盖失败。
- **不得修改**：`assets`、`asset_logs`、`ip_pool`、`servers`、`server_apps` 五张表的表结构与现有 26 个接口的行为。
- **不得删除**：现有 `web/src/CMDBResources.jsx` 与左侧 `cmdb` 菜单入口。阶段 A 期间新旧入口并存，何时合并等阶段 D 完成后再由用户决定。
- 所有新增 SQL 必须使用占位符参数，禁止字符串拼接用户输入。
- 排序字段必须走白名单映射，禁止把前端传入的字符串直接拼进 `ORDER BY`。
- 每个任务结束必须提交；提交信息使用 `feat(cmdb): ...` / `test(cmdb): ...` 格式。

---

## 2. 文件结构（阶段 A 结束时的形态）

**后端新增：**

| 文件 | 职责 |
| --- | --- |
| `internal/store/cmdb_schema.go` | 6 张 `cmdb_*` 表的建表 DDL 与 `InitCmdbSchema` |
| `internal/store/cmdb_store.go` | `CmdbAsset` 结构体、`CmdbAssetQuery`、分页查询、按 ID 查询 |
| `internal/store/cmdb_meta.go` | 组织 / 分组 / 设备分类 / 设备模型 的查询 |
| `internal/store/cmdb_sync.go` | 旧 `assets`/`servers` → `cmdb_assets` 幂等映射 |
| `internal/server_cmdb.go` | CMDB 的 HTTP handler |
| `internal/store/cmdb_schema_test.go` | 建表测试 |
| `internal/store/cmdb_store_test.go` | 查询与筛选分页测试 |
| `internal/store/cmdb_sync_test.go` | 映射幂等性测试 |
| `internal/server_cmdb_test.go` | 接口层测试 |

**后端修改：**

| 文件 | 改动 |
| --- | --- |
| `internal/store/store.go:250-251` | `InitSchema` 末尾追加 `InitCmdbSchema` 调用（3 行） |
| `internal/server.go:652` | `RegisterRoutes` 末尾追加 CMDB 路由（4 行） |

**前端新增：**

| 文件 | 职责 |
| --- | --- |
| `web/src/cmdb/cmdbApi.js` | CMDB 接口封装 |
| `web/src/cmdb/CmdbLayout.jsx` | CMDB 模块壳 + 顶部 7 项导航 |
| `web/src/cmdb/CmdbResources.jsx` | 资源列表页（30 列 + 检索 + 分页） |
| `web/src/cmdb/CmdbSideTree.jsx` | 左侧组织 / 分组 / 类型三维度面板 |
| `web/src/cmdb/columns.js` | 30 列表格定义（独立文件，避免页面文件过长） |
| `web/src/cmdb/cmdb.css` | CMDB 模块样式 |

**前端修改：**

| 文件 | 改动 |
| --- | --- |
| `web/src/App.jsx:56-95` | 菜单项新增一项 `cmdb_center`；内容区新增渲染分支（2 处，各 1 行） |

> 说明：`web/src/CMDBResources.jsx` 已接近 1900 行，本阶段**不动它**；新模块拆到 `web/src/cmdb/` 目录，单文件控制在 400 行内。

---

## 3. 数据模型（DDL 全文）

在 `internal/store/cmdb_schema.go` 中定义，全部 `IF NOT EXISTS`，可重复执行。

```sql
-- 组织架构（对应 nettopo 左侧「组织」维度）
CREATE TABLE IF NOT EXISTS cmdb_orgs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    parent_id INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT,
    updated_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cmdb_orgs_parent_name ON cmdb_orgs(parent_id, name);

-- 业务分组（对应「分组」维度）
CREATE TABLE IF NOT EXISTS cmdb_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    parent_id INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT,
    updated_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cmdb_groups_parent_name ON cmdb_groups(parent_id, name);

-- 设备分类（对应「类型」维度，表单中「设备分类 *」的取值来源）
CREATE TABLE IF NOT EXISTS cmdb_device_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    parent_id INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT,
    updated_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cmdb_categories_parent_name ON cmdb_device_categories(parent_id, name);

-- 设备模型库（对应「配置中心 → 设备模型库」表格列）
CREATE TABLE IF NOT EXISTS cmdb_device_models (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vendor TEXT,
    model TEXT,
    height_u INTEGER NOT NULL DEFAULT 1,
    rated_power_w INTEGER NOT NULL DEFAULT 0,
    max_power_w INTEGER NOT NULL DEFAULT 0,
    weight_kg REAL NOT NULL DEFAULT 0,
    depth_mm INTEGER NOT NULL DEFAULT 0,
    created_at TEXT,
    updated_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cmdb_models_vendor_model ON cmdb_device_models(vendor, model);

-- CMDB 资产主表（字段严格对应实测的 30 列表格 + 54 字段表单）
CREATE TABLE IF NOT EXISTS cmdb_assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_code TEXT,                          -- 资产编号，系统自动生成
    name TEXT NOT NULL,                       -- 设备名称
    status TEXT NOT NULL DEFAULT '在库',       -- 在线/在库/报废/维护中/离线/故障
    asset_class TEXT NOT NULL DEFAULT 'physical', -- physical / virtual
    category_id INTEGER NOT NULL DEFAULT 0,   -- 设备分类
    model_id INTEGER NOT NULL DEFAULT 0,      -- 设备模型
    sn TEXT,
    vendor TEXT,
    model TEXT,
    tags TEXT,                                -- JSON 对象，键值对标签
    org_id INTEGER NOT NULL DEFAULT 0,
    group_id INTEGER NOT NULL DEFAULT 0,
    department TEXT,
    owner TEXT,
    data_center TEXT,
    floor TEXT,
    cabinet_name TEXT,
    cabinet_row TEXT,
    cabinet_col INTEGER NOT NULL DEFAULT 0,
    start_u INTEGER NOT NULL DEFAULT 0,
    height_u INTEGER NOT NULL DEFAULT 1,
    province TEXT,
    city TEXT,
    district TEXT,
    longitude REAL,
    latitude REAL,
    address TEXT,
    mgmt_ip TEXT,
    mac TEXT,
    port_count INTEGER NOT NULL DEFAULT 0,
    rated_power_w INTEGER NOT NULL DEFAULT 0,
    max_power_w INTEGER NOT NULL DEFAULT 0,
    power_type TEXT,
    redundant_power INTEGER NOT NULL DEFAULT 0,
    weight_kg REAL NOT NULL DEFAULT 0,
    os_type TEXT,
    os_version TEXT,
    install_date TEXT,
    warranty_date TEXT,
    remark TEXT,
    source_type TEXT NOT NULL DEFAULT 'manual', -- manual / legacy_asset / legacy_server
    source_id INTEGER NOT NULL DEFAULT 0,       -- 映射来源主键，与 source_type 组成幂等键
    created_at TEXT,
    updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_cmdb_assets_code ON cmdb_assets(asset_code);
CREATE INDEX IF NOT EXISTS idx_cmdb_assets_name ON cmdb_assets(name);
CREATE INDEX IF NOT EXISTS idx_cmdb_assets_sn ON cmdb_assets(sn);
CREATE INDEX IF NOT EXISTS idx_cmdb_assets_mgmt_ip ON cmdb_assets(mgmt_ip);
CREATE INDEX IF NOT EXISTS idx_cmdb_assets_category ON cmdb_assets(category_id);
CREATE INDEX IF NOT EXISTS idx_cmdb_assets_org ON cmdb_assets(org_id);
CREATE INDEX IF NOT EXISTS idx_cmdb_assets_status ON cmdb_assets(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cmdb_assets_source ON cmdb_assets(source_type, source_id) WHERE source_id > 0;

-- 资产网络接口（对应表单「网络配置（多网卡）」与详情面板「端口与链路」）
CREATE TABLE IF NOT EXISTS cmdb_asset_interfaces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id INTEGER NOT NULL,
    is_primary INTEGER NOT NULL DEFAULT 0,
    if_name TEXT,
    ip TEXT,
    mask TEXT,
    gateway TEXT,
    mac TEXT,
    net_zone TEXT,                            -- 管理网/业务网/外部子系统/内部网络/带外(OOB)/未分类
    remark TEXT,
    created_at TEXT,
    updated_at TEXT,
    FOREIGN KEY(asset_id) REFERENCES cmdb_assets(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_cmdb_iface_asset ON cmdb_asset_interfaces(asset_id);
```

**状态取值白名单（实测）**：`在线`、`在库`、`报废`、`维护中`、`离线`、`故障`
**网络分区白名单（实测）**：`管理网`、`业务网`、`外部子系统`、`内部网络`、`带外 (OOB)`、`未分类`

---

## 4. 阶段 A 任务清单

### Task 1：CMDB 建表与迁移

**文件：**
- 新增：`internal/store/cmdb_schema.go`
- 修改：`internal/store/store.go:250-251`
- 测试：`internal/store/cmdb_schema_test.go`

**接口：**
- 产出：`func (s *Store) InitCmdbSchema() error`；`Store.InitSchema()` 调用它

- [ ] **步骤 1：写失败测试**

```go
package store

import (
	"path/filepath"
	"testing"
)

func TestInitCmdbSchemaCreatesAllTables(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "cmdb_schema_test.db")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("打开数据库失败: %v", err)
	}
	defer s.Close()

	want := []string{
		"cmdb_orgs", "cmdb_groups", "cmdb_device_categories",
		"cmdb_device_models", "cmdb_assets", "cmdb_asset_interfaces",
	}
	for _, table := range want {
		var name string
		err := s.db.QueryRow(
			`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, table,
		).Scan(&name)
		if err != nil {
			t.Fatalf("表 %s 未创建: %v", table, err)
		}
	}
}

func TestInitCmdbSchemaIsIdempotent(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "cmdb_schema_twice.db")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("打开数据库失败: %v", err)
	}
	defer s.Close()

	if err := s.InitCmdbSchema(); err != nil {
		t.Fatalf("重复执行建表应当成功，实际失败: %v", err)
	}
}
```

- [ ] **步骤 2：跑测试确认失败**

```powershell
go test ./internal/store/ -run TestInitCmdbSchema -v
```

预期：编译失败，报 `s.InitCmdbSchema undefined`。

- [ ] **步骤 3：写最小实现**

新建 `internal/store/cmdb_schema.go`，包名 `store`，内容为第 3 节的 DDL 全文加下面的入口：

```go
package store

const cmdbSchema = `...（第 3 节 DDL 全文，原样粘贴）...`

// InitCmdbSchema 幂等创建 CMDB 相关表，可重复调用。
func (s *Store) InitCmdbSchema() error {
	if _, err := s.db.Exec(cmdbSchema); err != nil {
		return err
	}
	return nil
}
```

修改 `internal/store/store.go` 的 `InitSchema` 结尾：

```go
	if _, err := s.db.Exec(schema); err != nil {
		return err
	}
	return s.InitCmdbSchema()
}
```

- [ ] **步骤 4：跑测试确认通过**

```powershell
go test ./internal/store/ -run TestInitCmdbSchema -v
```

预期：`PASS`，两个用例均通过。

- [ ] **步骤 5：提交**

```powershell
git add internal/store/cmdb_schema.go internal/store/cmdb_schema_test.go internal/store/store.go
git commit -m "feat(cmdb): 新增 CMDB 六张基础表与幂等迁移"
```

---

### Task 2：CMDB 资产模型与分页查询

**文件：**
- 新增：`internal/store/cmdb_store.go`
- 测试：`internal/store/cmdb_store_test.go`

**接口：**
- 产出：
  - `type CmdbAsset struct { ... }`（JSON tag 与小写蛇形一致）
  - `type CmdbAssetQuery struct { Keyword string; CategoryID, OrgID, GroupID int64; Status string; Page, PageSize int; SortBy, SortOrder string }`
  - `func (s *Store) QueryCmdbAssets(q CmdbAssetQuery) ([]CmdbAsset, int, error)`
  - `func (s *Store) GetCmdbAsset(id int64) (*CmdbAsset, []CmdbAssetInterface, error)`
  - 内部：`var cmdbSortWhitelist = map[string]string{...}`

- [ ] **步骤 1：写失败测试**

```go
package store

import (
	"path/filepath"
	"testing"
)

func newCmdbTestStore(t *testing.T) *Store {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "cmdb_store_test.db"))
	if err != nil {
		t.Fatalf("打开数据库失败: %v", err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func insertCmdbAsset(t *testing.T, s *Store, a CmdbAsset) int64 {
	t.Helper()
	id, err := s.InsertCmdbAsset(&a)
	if err != nil {
		t.Fatalf("插入测试资产失败: %v", err)
	}
	return id
}

func TestQueryCmdbAssetsFiltersAndPaginates(t *testing.T) {
	s := newCmdbTestStore(t)
	insertCmdbAsset(t, s, CmdbAsset{Name: "1U交换机-5141", AssetCode: "ZC202508140001", Status: "在线", CategoryID: 1})
	insertCmdbAsset(t, s, CmdbAsset{Name: "2U交换机-8037", AssetCode: "ZC202508140002", Status: "在线", CategoryID: 1})
	insertCmdbAsset(t, s, CmdbAsset{Name: "1U配线架-7467", AssetCode: "ZC202508140003", Status: "在库", CategoryID: 2})

	list, total, err := s.QueryCmdbAssets(CmdbAssetQuery{Page: 1, PageSize: 2})
	if err != nil {
		t.Fatalf("查询失败: %v", err)
	}
	if total != 3 {
		t.Fatalf("总数应为 3，实际 %d", total)
	}
	if len(list) != 2 {
		t.Fatalf("第一页应返回 2 条，实际 %d", len(list))
	}

	list, total, err = s.QueryCmdbAssets(CmdbAssetQuery{Keyword: "配线架", Page: 1, PageSize: 10})
	if err != nil {
		t.Fatalf("关键词查询失败: %v", err)
	}
	if total != 1 || list[0].Name != "1U配线架-7467" {
		t.Fatalf("关键词过滤结果错误: total=%d list=%+v", total, list)
	}

	list, total, err = s.QueryCmdbAssets(CmdbAssetQuery{CategoryID: 1, Page: 1, PageSize: 10})
	if err != nil {
		t.Fatalf("分类过滤失败: %v", err)
	}
	if total != 2 {
		t.Fatalf("分类过滤应返回 2 条，实际 %d", total)
	}

	list, _, err = s.QueryCmdbAssets(CmdbAssetQuery{Status: "在库", Page: 1, PageSize: 10})
	if err != nil {
		t.Fatalf("状态过滤失败: %v", err)
	}
	if len(list) != 1 || list[0].Status != "在库" {
		t.Fatalf("状态过滤结果错误: %+v", list)
	}
}

func TestQueryCmdbAssetsSortWhitelistRejectsUnknownField(t *testing.T) {
	s := newCmdbTestStore(t)
	insertCmdbAsset(t, s, CmdbAsset{Name: "A", AssetCode: "ZC1", Status: "在线"})

	// 非白名单字段必须回退到默认排序，而不是拼接进 SQL
	if _, _, err := s.QueryCmdbAssets(CmdbAssetQuery{SortBy: "name; DROP TABLE cmdb_assets", Page: 1, PageSize: 10}); err != nil {
		t.Fatalf("非法排序字段应回退默认排序而非报错: %v", err)
	}
	var cnt int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM cmdb_assets`).Scan(&cnt); err != nil {
		t.Fatalf("表应当仍然存在: %v", err)
	}
	if cnt != 1 {
		t.Fatalf("数据不应被破坏，实际 %d 行", cnt)
	}
}
```

- [ ] **步骤 2：跑测试确认失败**

```powershell
go test ./internal/store/ -run TestQueryCmdbAssets -v
```

预期：编译失败，报 `s.InsertCmdbAsset undefined`。

- [ ] **步骤 3：写最小实现**

`internal/store/cmdb_store.go`：

```go
package store

import (
	"fmt"
	"strings"
	"time"
)

// CmdbAsset 对应 cmdb_assets 表，JSON 字段与前端 30 列表格一一对应。
type CmdbAsset struct {
	ID             int64   `json:"id"`
	AssetCode      string  `json:"asset_code"`
	Name           string  `json:"name"`
	Status         string  `json:"status"`
	AssetClass     string  `json:"asset_class"`
	CategoryID     int64   `json:"category_id"`
	CategoryName   string  `json:"category_name"`
	ModelID        int64   `json:"model_id"`
	SN             string  `json:"sn"`
	Vendor         string  `json:"vendor"`
	Model          string  `json:"model"`
	Tags           string  `json:"tags"`
	OrgID          int64   `json:"org_id"`
	OrgName        string  `json:"org_name"`
	GroupID        int64   `json:"group_id"`
	GroupName      string  `json:"group_name"`
	Department     string  `json:"department"`
	Owner          string  `json:"owner"`
	DataCenter     string  `json:"data_center"`
	Floor          string  `json:"floor"`
	CabinetName    string  `json:"cabinet_name"`
	CabinetRow     string  `json:"cabinet_row"`
	CabinetCol     int64   `json:"cabinet_col"`
	StartU         int64   `json:"start_u"`
	HeightU        int64   `json:"height_u"`
	Province       string  `json:"province"`
	City           string  `json:"city"`
	District       string  `json:"district"`
	Longitude      float64 `json:"longitude"`
	Latitude       float64 `json:"latitude"`
	Address        string  `json:"address"`
	MgmtIP         string  `json:"mgmt_ip"`
	MAC            string  `json:"mac"`
	PortCount      int64   `json:"port_count"`
	RatedPowerW    int64   `json:"rated_power_w"`
	MaxPowerW      int64   `json:"max_power_w"`
	PowerType      string  `json:"power_type"`
	RedundantPower int64   `json:"redundant_power"`
	WeightKG       float64 `json:"weight_kg"`
	OSType         string  `json:"os_type"`
	OSVersion      string  `json:"os_version"`
	InstallDate    string  `json:"install_date"`
	WarrantyDate   string  `json:"warranty_date"`
	Remark         string  `json:"remark"`
	SourceType     string  `json:"source_type"`
	SourceID       int64   `json:"source_id"`
	CreatedAt      string  `json:"created_at"`
	UpdatedAt      string  `json:"updated_at"`
}

// CmdbAssetInterface 对应 cmdb_asset_interfaces 表。
type CmdbAssetInterface struct {
	ID        int64  `json:"id"`
	AssetID   int64  `json:"asset_id"`
	IsPrimary int64  `json:"is_primary"`
	IfName    string `json:"if_name"`
	IP        string `json:"ip"`
	Mask      string `json:"mask"`
	Gateway   string `json:"gateway"`
	MAC       string `json:"mac"`
	NetZone   string `json:"net_zone"`
	Remark    string `json:"remark"`
}

// CmdbAssetQuery 是资源列表的查询条件。
type CmdbAssetQuery struct {
	Keyword    string
	CategoryID int64
	OrgID      int64
	GroupID    int64
	Status     string
	Page       int
	PageSize   int
	SortBy     string
	SortOrder  string
}

// 只有白名单内的字段允许出现在 ORDER BY 中，防止 SQL 注入。
var cmdbSortWhitelist = map[string]string{
	"asset_code":   "a.asset_code",
	"name":         "a.name",
	"status":       "a.status",
	"category":     "a.category_id",
	"org":          "a.org_id",
	"os_type":      "a.os_type",
	"os_version":   "a.os_version",
	"mgmt_ip":      "a.mgmt_ip",
	"install_date": "a.install_date",
	"warranty_date": "a.warranty_date",
	"updated_at":   "a.updated_at",
}

const cmdbAssetSelect = `
SELECT a.id, IFNULL(a.asset_code,''), a.name, a.status, a.asset_class,
       a.category_id, IFNULL(c.name,''), a.model_id, IFNULL(a.sn,''), IFNULL(a.vendor,''),
       IFNULL(a.model,''), IFNULL(a.tags,''), a.org_id, IFNULL(o.name,''), a.group_id,
       IFNULL(g.name,''), IFNULL(a.department,''), IFNULL(a.owner,''), IFNULL(a.data_center,''),
       IFNULL(a.floor,''), IFNULL(a.cabinet_name,''), IFNULL(a.cabinet_row,''), a.cabinet_col,
       a.start_u, a.height_u, IFNULL(a.province,''), IFNULL(a.city,''), IFNULL(a.district,''),
       IFNULL(a.longitude,0), IFNULL(a.latitude,0), IFNULL(a.address,''), IFNULL(a.mgmt_ip,''),
       IFNULL(a.mac,''), a.port_count, a.rated_power_w, a.max_power_w, IFNULL(a.power_type,''),
       a.redundant_power, IFNULL(a.weight_kg,0), IFNULL(a.os_type,''), IFNULL(a.os_version,''),
       IFNULL(a.install_date,''), IFNULL(a.warranty_date,''), IFNULL(a.remark,''),
       a.source_type, a.source_id, IFNULL(a.created_at,''), IFNULL(a.updated_at,'')
FROM cmdb_assets a
LEFT JOIN cmdb_orgs o ON o.id = a.org_id
LEFT JOIN cmdb_groups g ON g.id = a.group_id
LEFT JOIN cmdb_device_categories c ON c.id = a.category_id`

func scanCmdbAsset(rows interface {
	Scan(dest ...interface{}) error
}) (CmdbAsset, error) {
	var a CmdbAsset
	err := rows.Scan(
		&a.ID, &a.AssetCode, &a.Name, &a.Status, &a.AssetClass,
		&a.CategoryID, &a.CategoryName, &a.ModelID, &a.SN, &a.Vendor,
		&a.Model, &a.Tags, &a.OrgID, &a.OrgName, &a.GroupID,
		&a.GroupName, &a.Department, &a.Owner, &a.DataCenter,
		&a.Floor, &a.CabinetName, &a.CabinetRow, &a.CabinetCol,
		&a.StartU, &a.HeightU, &a.Province, &a.City, &a.District,
		&a.Longitude, &a.Latitude, &a.Address, &a.MgmtIP,
		&a.MAC, &a.PortCount, &a.RatedPowerW, &a.MaxPowerW, &a.PowerType,
		&a.RedundantPower, &a.WeightKG, &a.OSType, &a.OSVersion,
		&a.InstallDate, &a.WarrantyDate, &a.Remark,
		&a.SourceType, &a.SourceID, &a.CreatedAt, &a.UpdatedAt,
	)
	return a, err
}

func (s *Store) buildCmdbWhere(q CmdbAssetQuery) (string, []interface{}) {
	var where []string
	var args []interface{}

	if kw := strings.TrimSpace(q.Keyword); kw != "" {
		pat := "%" + kw + "%"
		where = append(where, `(a.name LIKE ? OR a.asset_code LIKE ? OR a.sn LIKE ?
			OR a.mgmt_ip LIKE ? OR a.model LIKE ? OR a.owner LIKE ? OR a.department LIKE ?)`)
		args = append(args, pat, pat, pat, pat, pat, pat, pat)
	}
	if q.CategoryID > 0 {
		where = append(where, "a.category_id = ?")
		args = append(args, q.CategoryID)
	}
	if q.OrgID > 0 {
		where = append(where, "a.org_id = ?")
		args = append(args, q.OrgID)
	}
	if q.GroupID > 0 {
		where = append(where, "a.group_id = ?")
		args = append(args, q.GroupID)
	}
	if st := strings.TrimSpace(q.Status); st != "" && st != "全部" {
		where = append(where, "a.status = ?")
		args = append(args, st)
	}

	clause := ""
	if len(where) > 0 {
		clause = " WHERE " + strings.Join(where, " AND ")
	}
	return clause, args
}

// QueryCmdbAssets 按条件分页查询 CMDB 资产，返回当前页数据与满足条件的总数。
func (s *Store) QueryCmdbAssets(q CmdbAssetQuery) ([]CmdbAsset, int, error) {
	if q.Page < 1 {
		q.Page = 1
	}
	if q.PageSize < 1 || q.PageSize > 500 {
		q.PageSize = 10
	}

	whereClause, args := s.buildCmdbWhere(q)

	var total int
	if err := s.db.QueryRow("SELECT COUNT(*) FROM cmdb_assets a"+whereClause, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	orderCol, ok := cmdbSortWhitelist[q.SortBy]
	if !ok {
		orderCol = "a.id"
	}
	direction := "ASC"
	if strings.EqualFold(q.SortOrder, "desc") {
		direction = "DESC"
	}

	query := cmdbAssetSelect + whereClause +
		fmt.Sprintf(" ORDER BY %s %s LIMIT ? OFFSET ?", orderCol, direction)
	queryArgs := append(append([]interface{}{}, args...), q.PageSize, (q.Page-1)*q.PageSize)

	rows, err := s.db.Query(query, queryArgs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	list := make([]CmdbAsset, 0, q.PageSize)
	for rows.Next() {
		item, err := scanCmdbAsset(rows)
		if err != nil {
			return nil, 0, err
		}
		list = append(list, item)
	}
	return list, total, rows.Err()
}

// GetCmdbAsset 读取单个资产及其网络接口。
func (s *Store) GetCmdbAsset(id int64) (*CmdbAsset, []CmdbAssetInterface, error) {
	row := s.db.QueryRow(cmdbAssetSelect+" WHERE a.id = ?", id)
	asset, err := scanCmdbAsset(row)
	if err != nil {
		return nil, nil, err
	}

	rows, err := s.db.Query(`SELECT id, asset_id, is_primary, IFNULL(if_name,''), IFNULL(ip,''),
		IFNULL(mask,''), IFNULL(gateway,''), IFNULL(mac,''), IFNULL(net_zone,''), IFNULL(remark,'')
		FROM cmdb_asset_interfaces WHERE asset_id = ? ORDER BY is_primary DESC, id ASC`, id)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()

	ifaces := make([]CmdbAssetInterface, 0, 4)
	for rows.Next() {
		var it CmdbAssetInterface
		if err := rows.Scan(&it.ID, &it.AssetID, &it.IsPrimary, &it.IfName, &it.IP,
			&it.Mask, &it.Gateway, &it.MAC, &it.NetZone, &it.Remark); err != nil {
			return nil, nil, err
		}
		ifaces = append(ifaces, it)
	}
	return &asset, ifaces, rows.Err()
}

// InsertCmdbAsset 仅用于测试与映射同步，阶段 A 不对外暴露写接口。
func (s *Store) InsertCmdbAsset(a *CmdbAsset) (int64, error) {
	now := time.Now().Format("2006-01-02 15:04:05")
	if a.Status == "" {
		a.Status = "在库"
	}
	if a.AssetClass == "" {
		a.AssetClass = "physical"
	}
	if a.SourceType == "" {
		a.SourceType = "manual"
	}
	if a.HeightU == 0 {
		a.HeightU = 1
	}
	res, err := s.db.Exec(`
		INSERT INTO cmdb_assets (
			asset_code, name, status, asset_class, category_id, model_id, sn, vendor, model, tags,
			org_id, group_id, department, owner, data_center, floor, cabinet_name, cabinet_row,
			cabinet_col, start_u, height_u, province, city, district, longitude, latitude, address,
			mgmt_ip, mac, port_count, rated_power_w, max_power_w, power_type, redundant_power,
			weight_kg, os_type, os_version, install_date, warranty_date, remark, source_type, source_id,
			created_at, updated_at)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		a.AssetCode, a.Name, a.Status, a.AssetClass, a.CategoryID, a.ModelID, a.SN, a.Vendor, a.Model, a.Tags,
		a.OrgID, a.GroupID, a.Department, a.Owner, a.DataCenter, a.Floor, a.CabinetName, a.CabinetRow,
		a.CabinetCol, a.StartU, a.HeightU, a.Province, a.City, a.District, a.Longitude, a.Latitude, a.Address,
		a.MgmtIP, a.MAC, a.PortCount, a.RatedPowerW, a.MaxPowerW, a.PowerType, a.RedundantPower,
		a.WeightKG, a.OSType, a.OSVersion, a.InstallDate, a.WarrantyDate, a.Remark, a.SourceType, a.SourceID,
		now, now)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}
```

- [ ] **步骤 4：跑测试确认通过**

```powershell
go test ./internal/store/ -run TestQueryCmdbAssets -v
```

预期：`PASS`。

- [ ] **步骤 5：提交**

```powershell
git add internal/store/cmdb_store.go internal/store/cmdb_store_test.go
git commit -m "feat(cmdb): 新增 CMDB 资产模型与分页查询"
```

---

### Task 3：CMDB 维度元数据查询

**文件：**
- 新增：`internal/store/cmdb_meta.go`
- 测试：`internal/store/cmdb_meta_test.go`

**接口：**
- 产出：
  - `type CmdbOrg struct { ID int64; Name string; ParentID int64; SortOrder int64 }`（JSON 蛇形）
  - `func (s *Store) ListCmdbOrgs() ([]CmdbOrg, error)`
  - `func (s *Store) ListCmdbGroups() ([]CmdbGroup, error)`
  - `func (s *Store) ListCmdbCategories() ([]CmdbCategory, error)`
  - `func (s *Store) ListCmdbModels() ([]CmdbDeviceModel, error)`
  - `func (s *Store) SeedCmdbOrgsFromDepartments(departments []string) (int, error)`
  - 常量：`var CmdbAssetStatuses = []string{"在线", "在库", "报废", "维护中", "离线", "故障"}`、`var CmdbNetZones = []string{"管理网", "业务网", "外部子系统", "内部网络", "带外 (OOB)", "未分类"}`

- [ ] **步骤 1：写失败测试**

```go
package store

import "testing"

func TestListCmdbOrgsSortedAndSeedableFromDepartments(t *testing.T) {
	s := newCmdbTestStore(t)

	inserted, err := s.SeedCmdbOrgsFromDepartments([]string{"立案庭", "执行局", "立案庭"})
	if err != nil {
		t.Fatalf("写入组织失败: %v", err)
	}
	if inserted != 2 {
		t.Fatalf("重复科室只应写入 1 次，期望新增 2 条，实际 %d", inserted)
	}

	// 再次执行必须幂等
	if _, err := s.SeedCmdbOrgsFromDepartments([]string{"立案庭"}); err != nil {
		t.Fatalf("重复写入应当幂等: %v", err)
	}

	orgs, err := s.ListCmdbOrgs()
	if err != nil {
		t.Fatalf("查询组织失败: %v", err)
	}
	if len(orgs) != 2 {
		t.Fatalf("组织数应为 2，实际 %d", len(orgs))
	}
}

func TestCmdbWhitelistsMatchNettopoEvidence(t *testing.T) {
	want := []string{"在线", "在库", "报废", "维护中", "离线", "故障"}
	if len(CmdbAssetStatuses) != len(want) {
		t.Fatalf("状态白名单长度不符: %v", CmdbAssetStatuses)
	}
	for i, v := range want {
		if CmdbAssetStatuses[i] != v {
			t.Fatalf("状态白名单第 %d 项应为 %s，实际 %s", i, v, CmdbAssetStatuses[i])
		}
	}
}
```

- [ ] **步骤 2：跑测试确认失败**

```powershell
go test ./internal/store/ -run "TestListCmdbOrgs|TestCmdbWhitelists" -v
```

预期：编译失败，报 `s.SeedCmdbOrgsFromDepartments undefined`。

- [ ] **步骤 3：写最小实现**

`internal/store/cmdb_meta.go` 中实现四个 `List*`（均按 `sort_order, id` 排序）、`SeedCmdbOrgsFromDepartments`（用 `INSERT OR IGNORE` 配合 `parent_id=0` 上的唯一索引实现幂等，返回实际新增条数，`sort_order` 取索引值）、以及两个白名单变量。实现要点：

```go
// SeedCmdbOrgsFromDepartments 把现有台账里的科室名灌入 CMDB 组织表，已存在的不重复写入。
func (s *Store) SeedCmdbOrgsFromDepartments(departments []string) (int, error) {
	now := time.Now().Format("2006-01-02 15:04:05")
	added := 0
	for idx, name := range departments {
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		res, err := s.db.Exec(`INSERT OR IGNORE INTO cmdb_orgs (name, parent_id, sort_order, created_at, updated_at)
			VALUES (?, 0, ?, ?, ?)`, name, idx, now, now)
		if err != nil {
			return added, err
		}
		if n, _ := res.RowsAffected(); n > 0 {
			added++
		}
	}
	return added, nil
}
```

- [ ] **步骤 4：跑测试确认通过**

```powershell
go test ./internal/store/ -v
```

预期：全部 `PASS`。

- [ ] **步骤 5：提交**

```powershell
git add internal/store/cmdb_meta.go internal/store/cmdb_meta_test.go
git commit -m "feat(cmdb): 新增组织/分组/分类/模型元数据查询与组织种子"
```

---

### Task 4：旧台账映射同步

**文件：**
- 新增：`internal/store/cmdb_sync.go`
- 测试：`internal/store/cmdb_sync_test.go`

**接口：**
- 消耗：`InsertCmdbAsset`（Task 2）、`SeedCmdbOrgsFromDepartments`（Task 3）
- 产出：`func (s *Store) SyncLegacyToCmdb() (*CmdbSyncResult, error)`，`type CmdbSyncResult struct { OrgInserted int; AssetInserted int; ServerInserted int; Skipped int }`

- [ ] **步骤 1：写失败测试**

```go
package store

import (
	"path/filepath"
	"testing"
)

func TestSyncLegacyToCmdbIsIdempotent(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "cmdb_sync_test.db"))
	if err != nil {
		t.Fatalf("打开数据库失败: %v", err)
	}
	defer s.Close()

	if _, err := s.CreateAsset(&Asset{
		AssetCode: "ZC-2026-001", UserName: "张三", Department: "立案庭",
		Room: "302", IP: "172.16.7.10", Status: "在用",
	}, "测试"); err != nil {
		t.Fatalf("准备旧资产数据失败: %v", err)
	}
	if _, err := s.CreateServer(&PhysicalServer{
		DeviceName: "CZFY-DB-SRV-01", AssetCode: "SRV-2026-001",
		BizIP: "172.16.7.21", Status: "运行中", Location: "中心机房",
	}, "测试"); err != nil {
		t.Fatalf("准备旧服务器数据失败: %v", err)
	}

	first, err := s.SyncLegacyToCmdb()
	if err != nil {
		t.Fatalf("首次同步失败: %v", err)
	}
	if first.AssetInserted != 1 || first.ServerInserted != 1 {
		t.Fatalf("首次同步应各写入 1 条，实际 %+v", first)
	}

	second, err := s.SyncLegacyToCmdb()
	if err != nil {
		t.Fatalf("二次同步失败: %v", err)
	}
	if second.AssetInserted != 0 || second.ServerInserted != 0 {
		t.Fatalf("二次同步应全部跳过，实际 %+v", second)
	}

	_, total, err := s.QueryCmdbAssets(CmdbAssetQuery{Page: 1, PageSize: 50})
	if err != nil {
		t.Fatalf("查询失败: %v", err)
	}
	if total != 2 {
		t.Fatalf("重复同步不应产生重复数据，实际 %d 条", total)
	}
}
```

- [ ] **步骤 2：跑测试确认失败**

```powershell
go test ./internal/store/ -run TestSyncLegacyToCmdb -v
```

预期：编译失败，报 `s.SyncLegacyToCmdb undefined`。

- [ ] **步骤 3：写最小实现**

`internal/store/cmdb_sync.go`：读取全部 `assets` 与 `servers`，先 `SeedCmdbOrgsFromDepartments` 灌入科室，再按映射表写入 `cmdb_assets`，映射规则如下（严格按现有字段语义，不确定的留空，不编造）：

| cmdb_assets 字段 | 来自 assets | 来自 servers |
| --- | --- | --- |
| asset_code | `asset_code` | `asset_code` |
| name | `user_name` 非空时 `"{user_name} 的云桌面"`，否则 `"公用云桌面"` | `device_name` |
| status | `在用`→`在线`，`闲置`/`仓库备用`→`在库`，`维修中`→`维护中`，`待报废`/`已报废`→`报废` | `运行中`→`在线`，`已停机`→`离线`，`维护中`→`维护中`，`备用`→`在库` |
| asset_class | `physical` | `physical` |
| sn | `box_sn` | `serial_number` |
| vendor / model | 留空 | `brand_model` 整体写入 `model`，`vendor` 留空 |
| org_id | 按 `department` 匹配组织 ID，匹配不到填 0 | 0 |
| department / owner | `department` / 空 | 空 / `admin_user` |
| cabinet_name | 空 | `location` |
| mgmt_ip / mac | `terminal_ip` / 空 | `mgmt_ip` / 空 |
| os_type | 空 | `os_type` |
| install_date / warranty_date | 空 | `purchase_date` / `warranty_date` |
| mgmt_ip（业务 IP 不覆盖管理 IP） | `ip` 写入接口表主接口 | `biz_ip` 写入接口表主接口 |
| source_type / source_id | `legacy_asset` / `assets.id` | `legacy_server` / `servers.id` |

幂等实现：写入前先用 `SELECT id FROM cmdb_assets WHERE source_type=? AND source_id=?` 判断，存在则 `Skipped++` 跳过。

- [ ] **步骤 4：跑测试确认通过**

```powershell
go test ./internal/store/ -v
```

预期：全部 `PASS`。

- [ ] **步骤 5：提交**

```powershell
git add internal/store/cmdb_sync.go internal/store/cmdb_sync_test.go
git commit -m "feat(cmdb): 旧终端与服务器台账幂等映射进 CMDB 主表"
```

---

### Task 5：CMDB HTTP 接口层

**文件：**
- 新增：`internal/server_cmdb.go`
- 修改：`internal/server.go:652`
- 测试：`internal/server_cmdb_test.go`

**接口：**
- 消耗：Task 2、3、4 的存储层方法
- 产出（4 个接口，全部为 `GET`/`POST` 只读语义）：

| 方法与路径 | 参数 | 返回 |
| --- | --- | --- |
| `GET /api/cmdb/meta` | 无 | `{"orgs":[],"groups":[],"categories":[],"models":[],"statuses":[],"net_zones":[]}` |
| `GET /api/cmdb/assets` | `keyword`、`category_id`、`org_id`、`group_id`、`status`、`page`、`page_size`、`sort_by`、`sort_order` | `{"list":[],"total":0,"page":1,"page_size":10}` |
| `GET /api/cmdb/assets/{id}` | 路径参数 | `{"asset":{},"interfaces":[]}` |
| `POST /api/cmdb/sync/legacy` | 无 | `CmdbSyncResult` |

- [ ] **步骤 1：写失败测试**

```go
package internal

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"czfy-assets/internal/store"
)

func newCmdbTestServer(t *testing.T) *Server {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "server_cmdb_test.db"))
	if err != nil {
		t.Fatalf("打开数据库失败: %v", err)
	}
	t.Cleanup(func() { st.Close() })
	if _, err := st.SyncLegacyToCmdb(); err != nil {
		t.Fatalf("映射同步失败: %v", err)
	}
	return &Server{Store: st}
}

func TestHandleCmdbAssetsReturnsPagedList(t *testing.T) {
	s := newCmdbTestServer(t)
	mux := http.NewServeMux()
	s.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/api/cmdb/assets?page=1&page_size=5", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("状态码应为 200，实际 %d，响应 %s", rec.Code, rec.Body.String())
	}
	var body struct {
		List     []store.CmdbAsset `json:"list"`
		Total    int               `json:"total"`
		Page     int               `json:"page"`
		PageSize int               `json:"page_size"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("响应不是合法 JSON: %v", err)
	}
	if body.Page != 1 || body.PageSize != 5 {
		t.Fatalf("分页回显错误: %+v", body)
	}
}

func TestHandleCmdbAssetNotFoundReturnsExplicitError(t *testing.T) {
	s := newCmdbTestServer(t)
	mux := http.NewServeMux()
	s.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/api/cmdb/assets/999999", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("不存在资产应返回 404，实际 %d", rec.Code)
	}
	var body map[string]string
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	if body["error"] == "" {
		t.Fatalf("404 必须带明确 error 说明，实际响应 %s", rec.Body.String())
	}
}
```

- [ ] **步骤 2：跑测试确认失败**

```powershell
go test ./internal/ -run TestHandleCmdb -v
```

预期：编译失败或 404（路由未注册）。

- [ ] **步骤 3：写最小实现**

新建 `internal/server_cmdb.go`，四个 handler 复用现有 `writeJSON` / `writeErr`，参数解析沿用 `handleListAssets` 的写法（`strconv.Atoi` + `r.URL.Query().Get`）。`category_id` / `org_id` / `group_id` 解析失败时按 0 处理（表示不过滤），不返回错误。

在 `internal/server.go` 的 `RegisterRoutes` 末尾（`handleDownloadTemplate` 那行之后）追加：

```go
	// CMDB 资源管理
	mux.HandleFunc("GET /api/cmdb/meta", s.handleCmdbMeta)
	mux.HandleFunc("GET /api/cmdb/assets", s.handleListCmdbAssets)
	mux.HandleFunc("GET /api/cmdb/assets/{id}", s.handleGetCmdbAsset)
	mux.HandleFunc("POST /api/cmdb/sync/legacy", s.handleCmdbSyncLegacy)
```

- [ ] **步骤 4：跑测试确认通过**

```powershell
go test ./... 
```

预期：全部 `PASS`。

- [ ] **步骤 5：提交**

```powershell
git add internal/server_cmdb.go internal/server_cmdb_test.go internal/server.go
git commit -m "feat(cmdb): 新增 CMDB 元数据、资源列表与详情接口"
```

---

### Task 6：前端 CMDB 接口封装

**文件：**
- 新增：`web/src/cmdb/cmdbApi.js`

**接口：**
- 产出：`cmdbApi.meta()`、`cmdbApi.listAssets(params)`、`cmdbApi.getAsset(id)`、`cmdbApi.syncLegacy()`

- [ ] **步骤 1：写实现**

复用 `web/src/api.js` 里的 `req` 模式（复制该函数，CMDB 模块自带一份，避免改动现有文件）：

```js
const BASE = ''

async function req(url, opts = {}) {
  const r = await fetch(BASE + url, {
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  })
  if (!r.ok) {
    let msg = `HTTP ${r.status}`
    try {
      const j = await r.json()
      if (j.error) msg = j.error
    } catch (_) {}
    throw new Error(msg)
  }
  return r.json()
}

function toQuery(params = {}) {
  const sp = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') sp.set(k, v)
  })
  return sp.toString()
}

export const cmdbApi = {
  meta: () => req('/api/cmdb/meta'),
  listAssets: (params = {}) => req(`/api/cmdb/assets?${toQuery(params)}`),
  getAsset: (id) => req(`/api/cmdb/assets/${id}`),
  syncLegacy: () => req('/api/cmdb/sync/legacy', { method: 'POST' }),
}
```

- [ ] **步骤 2：验证**

```powershell
cd web; npm run build
```

预期：构建成功，无 ESLint 报错。

- [ ] **步骤 3：提交**

```powershell
git add web/src/cmdb/cmdbApi.js
git commit -m "feat(cmdb): 新增前端 CMDB 接口封装"
```

---

### Task 7：CMDB 模块壳与顶部导航

**文件：**
- 新增：`web/src/cmdb/CmdbLayout.jsx`、`web/src/cmdb/cmdb.css`

**接口：**
- 消耗：无
- 产出：`export default function CmdbLayout({ meta, children })` —— 顶部渲染 7 项导航（仪表盘 / 资源管理 / 编码与标签 / 工单管理 / 资产盘点 / 凭证中心 / 配置中心），当前项高亮；阶段 A 只有「资源管理」可点，其余项点击提示「该模块尚未实现」，**不得做假页面**

- [ ] **步骤 1：写实现**

导航项与真实路由用常量表固定，禁止硬编码散落在 JSX 里：

```jsx
export const CMDB_NAV = [
  { key: 'dashboard', label: '仪表盘', path: '/cmdb/dashboard', ready: false },
  { key: 'resources', label: '资源管理', path: '/cmdb/resources', ready: true },
  { key: 'labels', label: '编码与标签', path: '/cmdb/labels', ready: false },
  { key: 'work-orders', label: '工单管理', path: '/cmdb/work-orders', ready: false },
  { key: 'inventory', label: '资产盘点', path: '/cmdb/inventory', ready: false },
  { key: 'credentials', label: '凭证中心', path: '/cmdb/credentials', ready: false },
  { key: 'config', label: '配置中心', path: '/cmdb/config', ready: false },
]
```

`ready: false` 的项点击后调用 antd `message.info('该模块尚未实现，将在后续阶段交付')`，不跳转、不渲染占位页面。

- [ ] **步骤 2：验证**

```powershell
cd web; npm run build
```

- [ ] **步骤 3：提交**

```powershell
git add web/src/cmdb/CmdbLayout.jsx web/src/cmdb/cmdb.css
git commit -m "feat(cmdb): 新增 CMDB 模块壳与顶部七项导航"
```

---

### Task 8：30 列资源表格定义

**文件：**
- 新增：`web/src/cmdb/columns.js`

**接口：**
- 产出：`export function buildCmdbColumns({ onOpenDetail })`，返回 antd Table 的 `columns` 数组，**列顺序严格等于实测顺序**

- [ ] **步骤 1：写实现**

30 列顺序（与 `docs/evidence/nettopo/cmdb-resources.json` 的 `tableHeaders` 逐字一致）：

```js
export const CMDB_COLUMNS = [
  { title: '资产编号', dataIndex: 'asset_code', width: 150, fixed: 'left', sorter: true },
  { title: '设备名称', dataIndex: 'name', width: 160, sorter: true },
  { title: '状态', dataIndex: 'status', width: 90 },
  { title: '设备分类', dataIndex: 'category_name', width: 110 },
  { title: '操作系统类型', dataIndex: 'os_type', width: 120 },
  { title: '操作系统版本', dataIndex: 'os_version', width: 120 },
  { title: '管理IP', dataIndex: 'mgmt_ip', width: 130 },
  { title: '业务监控', dataIndex: 'monitor_status', width: 100 },
  { title: '所属组织', dataIndex: 'org_name', width: 130, sorter: true },
  { title: '所属分组', dataIndex: 'group_name', width: 120 },
  { title: '所属部门', dataIndex: 'department', width: 130 },
  { title: '负责人', dataIndex: 'owner', width: 100 },
  { title: '序列号', dataIndex: 'sn', width: 150 },
  { title: 'MAC地址', dataIndex: 'mac', width: 150 },
  { title: '厂商', dataIndex: 'vendor', width: 100 },
  { title: '型号', dataIndex: 'model', width: 140 },
  { title: '所属区域', dataIndex: 'data_center', width: 120 },
  { title: '楼层', dataIndex: 'floor', width: 80 },
  { title: '机柜名称', dataIndex: 'cabinet_name', width: 110 },
  { title: '位置标识', dataIndex: 'cabinet_position', width: 110 },
  { title: '高度', dataIndex: 'height_u', width: 80 },
  { title: '起始U位', dataIndex: 'start_u', width: 90 },
  { title: '端口数量', dataIndex: 'port_count', width: 90 },
  { title: '电源类型', dataIndex: 'power_type', width: 100 },
  { title: '冗余电源', dataIndex: 'redundant_power', width: 90 },
  { title: '安装日期', dataIndex: 'install_date', width: 110, sorter: true },
  { title: '保修到期', dataIndex: 'warranty_date', width: 110, sorter: true },
  { title: '额定功耗', dataIndex: 'rated_power_w', width: 100 },
  { title: '重量', dataIndex: 'weight_kg', width: 90 },
  { title: '操作', key: 'action', width: 140, fixed: 'right' },
]
```

空值统一渲染 `-`（与 nettopo 一致），`冗余电源` 渲染 `是/否`，`状态` 渲染彩色 Tag（在线=success、在库=processing、维护中=warning、报废/离线/故障=error）。

- [ ] **步骤 2：验证**

```powershell
cd web; npm run build
```

- [ ] **步骤 3：提交**

```powershell
git add web/src/cmdb/columns.js
git commit -m "feat(cmdb): 新增 30 列资源表格定义"
```

---

### Task 9：资源列表页（检索 + 分页 + 排序）

**文件：**
- 新增：`web/src/cmdb/CmdbResources.jsx`

**接口：**
- 消耗：`cmdbApi`（Task 6）、`CMDB_COLUMNS`（Task 8）
- 产出：`export default function CmdbResources({ meta })`

- [ ] **步骤 1：写实现**

要点（每条都必须实现）：

1. 顶部工具栏顺序固定：`组织` / `分组` / `类型` 三个维度标签、搜索框（占位符 `搜索资产 (名称, SN, IP...)`）、`搜索` 按钮。
2. 状态筛选下拉，选项取 `/api/cmdb/meta` 的 `statuses`。
3. 表格用 `CMDB_COLUMNS`，`scroll={{ x: 3200 }}`，`rowKey="id"`，`size="small"`。
4. 服务端分页：`pagination` 手动构造，文案 `共 N 条记录`、`当前 x-y`、`每页 10 条`（可选 10/50/100/300），并提供 `跳至 __ 页` 输入框 + `跳转` 按钮。
5. 排序：表格 `onChange` 取 `sorter.field` / `sorter.order`，映射为 `sort_by` / `sort_order=asc|desc`，字段名不在后端白名单内的不发送。
6. 加载失败必须 `message.error('加载 CMDB 资源失败：' + e.message)`，不得静默吞掉。
7. 页面首次挂载时若 `total === 0`，显示一条可点击的提示条「检测到尚未同步旧台账数据，点击同步」，调用 `cmdbApi.syncLegacy()` 后刷新列表。

- [ ] **步骤 2：验证**

```powershell
cd web; npm run build
```

- [ ] **步骤 3：提交**

```powershell
git add web/src/cmdb/CmdbResources.jsx
git commit -m "feat(cmdb): 新增 CMDB 资源列表页含服务端分页与排序"
```

---

### Task 10：左侧组织 / 分组 / 类型三维度面板

**文件：**
- 新增：`web/src/cmdb/CmdbSideTree.jsx`

**接口：**
- 产出：`export default function CmdbSideTree({ mode, data, selectedId, onSelect })`；`mode` 取 `'org' | 'group' | 'category'`

- [ ] **步骤 1：写实现**

- 三个维度各自渲染一棵扁平的树（阶段 A 只做一级，`parent_id` 层级留到阶段 D）。
- 首项固定为 `全部组织` / `全部分组` / `全部分类`，`id = 0`。
- 选中项高亮（浅蓝底），点击回调把 ID 传给列表页过滤条件。
- 数据为空时显示 `暂无数据，可在后续阶段的分类管理中维护`，**不显示假数据**。

- [ ] **步骤 2：验证**

```powershell
cd web; npm run build
```

- [ ] **步骤 3：提交**

```powershell
git add web/src/cmdb/CmdbSideTree.jsx
git commit -m "feat(cmdb): 新增组织分组类型三维度侧栏"
```

---

### Task 11：接入 App.jsx 与样式

**文件：**
- 修改：`web/src/App.jsx:56-95`（菜单项）、`web/src/App.jsx:181-187`（内容区分支）
- 修改：`web/src/app.css`（如需要）

**接口：**
- 消耗：`CmdbLayout`（Task 7）、`CmdbResources`（Task 9）

- [ ] **步骤 1：写实现**

1. `menuItems` 增加一项，**放在现有 `cmdb_group` 之前**，key 为 `cmdb_center`，label 为 `CMDB 资源管理（新）`，图标复用 `ClusterOutlined`。
2. 内容区新增一行：`{currentMenu === 'cmdb_center' && <CmdbLayout meta={meta}><CmdbResources meta={meta} /></CmdbLayout>}`。
3. **不改动**默认首页（仍为 `search`），**不删** 现有 `cmdb` 菜单项与 `CMDBResources.jsx`。

- [ ] **步骤 2：验证**

```powershell
cd web; npm run build
```

预期：构建成功。

- [ ] **步骤 3：提交**

```powershell
git add web/src/App.jsx web/src/app.css
git commit -m "feat(cmdb): 左侧导航接入 CMDB 资源管理入口"
```

---

### Task 12：端到端验收

**文件：** 无新增，产出验收记录

- [ ] **步骤 1：后端全量测试**

```powershell
go test ./...
```

预期：全部 `PASS`。若失败，记录命令与错误，**不得跳过**。

- [ ] **步骤 2：前端构建**

```powershell
cd web; npm run build
```

预期：构建成功，无报错。

- [ ] **步骤 3：启动本地服务并手工核对**

```powershell
go run . -port 18099 -no-browser
```

逐项核对，每项记录结论：

| 核对项 | 依据 |
| --- | --- |
| 默认首页仍是全局查询 | AGENTS.md 第 2 条 |
| 左侧出现「CMDB 资源管理（新）」入口 | Task 11 |
| 进入后顶部显示 7 项导航，未实现项点击提示而非假页面 | Task 7 |
| 旧台账数据已同步进 CMDB 列表（终端 + 服务器条数与旧模块一致） | Task 4 |
| 表格列顺序与 `docs/evidence/nettopo/cmdb-resources.png` 一致（30 列） | Task 8 |
| 搜索框文案为 `搜索资产 (名称, SN, IP...)` | 实测证据 |
| 分页文案为 `共 N 条记录 / 当前 x-y / 每页 N 条 / 跳至 __ 页 / 跳转` | 实测证据 |
| 组织维度过滤生效 | Task 10 |
| 列头排序生效且非法字段不报错 | Task 2、9 |
| 旧 CMDB 入口 `/web/src/CMDBResources.jsx` 仍可正常使用 | AGENTS.md 不得删减能力 |

- [ ] **步骤 4：提交验收记录**

在 `docs/` 下新增验收记录文件，写明实际执行的命令、输出结论、未通过项与未验证范围。**未实际运行的验证不得写成已通过。**

```powershell
git add docs/
git commit -m "docs(cmdb): 记录 P0-1 阶段 A 验收结果"
```

---

## 5. 阶段 A 之后的路线（不在本计划内，各自单独出计划）

| 阶段 | 内容 | 预估 |
| --- | --- | --- |
| B | 新增/编辑资产表单（8 分区 54 字段、多网卡、标签、地理位置），含写接口与校验 | 6-8 人天 |
| C | 资产详情面板 10 页签（阶段 C 先做「信息」页全部字段 + 「端口与链路」，其余页签留空并明确标注依赖采集端） | 6-8 人天 |
| D | 组织 / 分组 / 类型的增删改维护（对应 nettopo 的「分类管理」） | 4-5 人天 |
| E | 编码与标签、配置中心、工单管理、资产盘点、凭证中心 | 21-29 人天 |

**新旧入口合并时机**：阶段 B、C、D 完成后，新模块将具备与旧 `CMDBResources.jsx` 等价的台账能力；届时再评估是否下线旧入口，**需要你明确同意后才动**。

---

## 6. 风险与回滚

| 风险 | 影响 | 处置 |
| --- | --- | --- |
| 双份台账数据（旧表 + `cmdb_assets`） | 旧模块写的数据不会自动出现在 CMDB 列表 | 阶段 A 采用单向映射；后续如需双向同步，必须先定同步规则再动手，不得默认加触发器 |
| 30 列宽表在小屏显示 | 横向滚动，操作列被挤出 | `操作` 列 `fixed: 'right'`，`scroll.x` 设 3200 |
| 排序字段注入 | SQL 注入 | 后端白名单 + 参数占位符，已在 Task 2 加测试 |
| 文件过大 | 难审查、易出错 | 新模块拆成 6 个文件，单文件不超 400 行；旧 `CMDBResources.jsx` 本阶段不动 |
| 回滚 | 需要整体撤销阶段 A | 新增表与新增文件均可删除；`store.go` 与 `server.go` 各只多 3-4 行，删掉即恢复原状。**旧 5 张表结构零变更，回滚不影响既有数据** |

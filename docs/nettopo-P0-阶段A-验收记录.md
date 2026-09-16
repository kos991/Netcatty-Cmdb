# nettopo CMDB P0-1 阶段 A 验收记录

- 验收日期：2026-09-14
- 验收范围：`docs/nettopo-P0-实施计划.md` 阶段 A（Task 1 ~ Task 12）
- 前置授权：用户已明确回复「A」，即解除 `AGENTS.md` 第 3 条的「不得新增表」限制，同意新增 6 张 `cmdb_*` 表
- 验收环境：Windows PowerShell / Go 1.25.11 / Node 24 / SQLite（modernc.org/sqlite）

---

## 1. 交付文件清单

### 后端新增
| 文件 | 职责 |
| --- | --- |
| `internal/store/cmdb_schema.go` | 6 张 `cmdb_*` 表 DDL + `InitCmdbSchema` |
| `internal/store/cmdb_store.go` | `CmdbAsset` 模型、分页查询、排序白名单、详情 |
| `internal/store/cmdb_meta.go` | 组织/分组/分类/模型查询、组织种子、状态与网络分区白名单 |
| `internal/store/cmdb_sync.go` | 旧台账幂等映射、`AllServers`（无上限读取） |
| `internal/server_cmdb.go` | 4 个 CMDB HTTP handler |
| `internal/store/cmdb_schema_test.go` | 建表与幂等测试（2 例） |
| `internal/store/cmdb_store_test.go` | 筛选分页与排序注入测试（2 例） |
| `internal/store/cmdb_meta_test.go` | 组织种子幂等与白名单测试（2 例） |
| `internal/store/cmdb_sync_test.go` | 映射幂等测试（1 例） |
| `internal/server_cmdb_test.go` | 接口层测试（2 例） |

### 后端修改
| 文件 | 改动 |
| --- | --- |
| `internal/store/store.go:250` | `InitSchema` 末尾追加 `return s.InitCmdbSchema()` |
| `internal/server.go:652` | `RegisterRoutes` 末尾追加 4 条 CMDB 路由 |

### 前端新增
| 文件 | 职责 |
| --- | --- |
| `web/src/cmdb/cmdbApi.js` | CMDB 接口封装 |
| `web/src/cmdb/CmdbLayout.jsx` | 模块壳 + 顶部 7 项导航 |
| `web/src/cmdb/columns.js` | 30 列表格定义 + 排序字段映射 |
| `web/src/cmdb/CmdbResources.jsx` | 资源列表页（检索 / 分页 / 排序 / 同步提示） |
| `web/src/cmdb/CmdbSideTree.jsx` | 组织 / 分组 / 类型三维度侧栏 |
| `web/src/cmdb/cmdb.css` | 模块样式 |

### 前端修改
| 文件 | 改动 |
| --- | --- |
| `web/src/App.jsx` | 新增菜单项 `cmdb_center`、内容区分支、标题分支、2 行 import |

**未改动**：`assets` / `asset_logs` / `ip_pool` / `servers` / `server_apps` 五张表结构与既有 26 个接口；旧 `web/src/CMDBResources.jsx` 与旧 `cmdb` 菜单入口保持可用。

---

## 2. 实际执行的命令与结论

### 2.1 后端测试（已运行）

```powershell
go test ./...
```

结论：**全部通过**

```
?   	czfy-assets	[no test files]
ok  	czfy-assets/internal	0.814s
ok  	czfy-assets/internal/store	0.614s
?  	czfy-assets/tools/extract	[no test files]
```

```powershell
go vet ./...
```

结论：无告警（无输出）。

### 2.2 前端构建（已运行）

```powershell
cd web; npm.cmd run build
```

结论：**构建成功**

```
dist/index.html                     0.40 kB
dist/assets/index-DAc8rgyY.css     20.17 kB
dist/assets/index-1ZtuxL-F.js   1,360.61 kB
✓ built in 6.80s
```

> 注：本机 PowerShell 执行策略禁用 `npm.ps1`，故使用 `npm.cmd`。

### 2.3 端到端手工核对（已运行）

启动方式（等价于计划中的 `go run . -port 18099 -no-browser`，为便于停止改为先构建再启动）：

```powershell
go build -o $env:TEMP\czfy-accept\app.exe .
app.exe --no-browser --port 18099 --db $env:TEMP\czfy-accept\assets.db
```

> **重要**：本次验收使用 `assets.db` 的**副本**，工作区真实数据库未被改动。

| # | 核对项 | 依据 | 实测结果 | 结论 |
| --- | --- | --- | --- | --- |
| 1 | 旧台账基数 | Task 4 | `assets` 683 条、`servers` 3 条 | ✅ |
| 2 | 同步前 CMDB 列表为空 | Task 9 同步提示条件 | `total=0` | ✅ |
| 3 | 维度元数据接口 | Task 3 / 5 | `statuses=在线/在库/报废/维护中/离线/故障`；`net_zones=管理网/业务网/外部子系统/内部网络/带外 (OOB)/未分类` | ✅ |
| 4 | 旧台账映射同步 | Task 4 | `org_inserted=17, asset_inserted=683, server_inserted=3, skipped=0` | ✅ |
| 5 | 同步后数量一致 | Task 4 | CMDB `total=686`，期望 `683+3=686` | ✅ |
| 6 | 二次同步幂等 | Task 4 | `asset_inserted=0, server_inserted=0, skipped=686`，`total` 仍为 686 | ✅ |
| 7 | 组织维度过滤生效 | Task 10 | 17 个组织各自返回过滤结果：法庭 71、速裁 34、民四 21、民一 20、审监 18、民五 16、民二 16… | ✅ |
| 8 | 关键字检索 | Task 2 / 9 | `邹婷婷`→1、`71W5270114`→1、`192.168.34.75`→1 | ✅ |
| 9 | 状态过滤 | Task 2 | `status=在线` → `total=514` | ✅ |
| 10 | 列头排序生效 | Task 2 / 9 | `sort_by=name&sort_order=asc` 返回 `1007会议室 的云桌面 / 222室专案 的云桌面 / 31法庭书记员2 的云桌面` | ✅ |
| 11 | 非法排序字段不报错、不破坏数据 | Task 2 | `sort_by=evil_col` → 200 且 `total=686`；`sort_by=name; DROP TABLE cmdb_assets` → 200 且 `total=686` | ✅ |
| 12 | 资产详情接口 | Task 5 | `GET /api/cmdb/assets/1` → `name=邹婷婷 的云桌面, status=在线, interfaces=1` | ✅ |
| 13 | 详情不存在时明确报错 | Task 5 | `GET /api/cmdb/assets/999999` → HTTP 404，`{"error":"未找到该资产"}` | ✅ |
| 14 | 旧接口未受影响 | AGENTS.md 不得删减能力 | `/api/meta` 正常，`departments=17, rooms=227` | ✅ |
| 15 | 前端页面可服务 | Task 11 | `GET /` → 200 且含 `id="root"` | ✅ |
| 16 | 前端 bundle 含新模块 | Task 7 ~ 11 | 见 2.4 字符串核对，全部为 True | ✅ |

### 2.4 前端构建产物字符串核对（已运行）

对 `web/dist/assets/index-1ZtuxL-F.js` 与 `.css` 按 UTF-8 读取后核对：

| 字符串 | 存在 |
| --- | --- |
| `CMDB 资源管理（新）` | ✅ |
| `起始U位`（30 列表头之一） | ✅ |
| `搜索资产 (名称, SN, IP...)` | ✅ |
| `该模块尚未实现，将在后续阶段交付` | ✅ |
| `资产详情面板将在阶段 C 交付` | ✅ |
| `全部组织` | ✅ |
| `冗余电源` | ✅ |
| `共 ` / `跳转` | ✅ |
| `仪表盘` / `编码与标签` / `凭证中心`（7 项导航） | ✅ |
| CSS `cmdb-shell` / `cmdb-side-item` | ✅ |
| `sorter:!0` 标记数 = 5（对应 5 个可排序列） | ✅ |

---

## 3. 未通过项

**无。** 上述 16 项手工核对全部通过。过程中出现过一次核对脚本自身缺陷：第 7 项首次执行时误用了同步前读取的元数据（当时 `orgs=0`），导致 `org_id` 传空等同于不过滤；重新读取同步后元数据后确认过滤生效（见 2.3 第 7 项）。此为验收脚本问题，非被验收代码缺陷。

---

## 4. 未验证范围（不得视为已通过）

本轮**没有浏览器级可视化验证手段**，以下项目仅通过源码与构建产物字符串核对，**未经真实渲染页面观察**：

1. 顶部 7 项导航的实际渲染与高亮效果，以及未实现项点击弹出 `message.info` 的真实交互。
2. 组织 / 分组 / 类型三个标签页切换与左侧面板联动。
3. 分页区 `共 N 条记录 / 当前 x-y / 每页 N 条 / 跳至 __ 页 / 跳转` 的**实际排版与文案渲染**（仅确认字符串存在于 bundle）。
4. 30 列的**实际列顺序与列宽**是否与 `docs/evidence/nettopo/cmdb-resources.png` 逐列一致（仅确认列定义代码顺序与证据一致）。
5. 状态彩色 Tag 的实际配色、空值 `-` 的实际渲染、`冗余电源` 的「是/否」渲染。
6. 「检测到尚未同步旧台账数据，点击同步」提示条的实际显示与点击同步流程（接口侧已单独验证通过）。
7. 横向滚动 `scroll.x=3200` 与小屏表现。
8. 旧 CMDB 入口（`web/src/CMDBResources.jsx`）在**浏览器中的**实际可用性（仅确认其源码未被修改、相关接口未改动）。

建议后续用浏览器打开 `http://127.0.0.1:18099` 逐条补验后再判定阶段 A 整体验收通过。

---

## 5. 计划外调整（均已说明理由）

| 调整 | 原因 |
| --- | --- |
| **跳过全部 git 提交步骤** | 本目录**不是 git 仓库**（`git status` 报 `not a git repository`），计划中 Task 1~12 的 `git commit` 步骤无法执行；未擅自 `git init`。 |
| `columns.js` 用 `React.createElement` 而非 JSX | Vite 明确拒绝在 `.js` 中使用 JSX（报 `invalid JS syntax. If you are using JSX, make sure to name the file with the .jsx or .tsx extension`）。为保留计划指定的文件名 `columns.js`，改用 `React.createElement`。 |
| 新增 `AllServers()`（`internal/store/cmdb_sync.go`） | 现有 `QueryServers` 的 `pageSize` 上限硬编码为 500，超出即回退为 20；映射同步要求「读取全部 servers」，直接传大值会**静默漏数据**，故单独提供无上限读取。 |
| 新增 `CMDB_SORT_FIELD_MAP`（`web/src/cmdb/columns.js`） | 后端排序白名单键为 `org` / `category`，而表格列 `dataIndex` 为 `org_name` / `category_name`；不做映射则「所属组织」排序会被静默丢弃。映射后排序正常，且仍满足「白名单外字段不发送」的约束。 |
| 先写 Task 10（`CmdbSideTree.jsx`）再写 Task 9（`CmdbResources.jsx`） | Task 9 的页面需 `import` Task 10 的组件，按原顺序会中途出现无法构建的状态；调整后每次构建均为绿色。 |
| `App.jsx` 额外增加 `getTitle` 分支 | 计划只要求改菜单项与内容分支 2 处；不加标题分支时页头会回落为通用文案「资产管理系统」，为保持界面一致补了 1 个 case。 |
| 「操作」列「详情」按钮提示「阶段 C 交付」 | 阶段 A 交付边界明确不含详情面板（阶段 C 为 10 页签详情），遵循计划「不得做假页面」的约定，仅提示、不渲染占位页。详情接口已可用但本轮前端不消费。 |

---

## 6. 已知限制

1. **业务 IP 无法在列表关键字中检索**：列表关键字仅覆盖 `cmdb_assets` 的名称/编号/SN/管理IP/型号/负责人/部门；旧台账的业务 IP 写入 `cmdb_asset_interfaces` 接口表，故检索不到（实测：业务 IP `138.64.8.129` → `total=0`，管理 IP `192.168.34.75` → `total=1`）。此行为与计划第 4 节 Task 2 的检索字段清单一致，但界面占位符含「IP」，用户可能预期可搜业务 IP。
2. **`业务监控`（`monitor_status`）与 `位置标识`（`cabinet_position`）两列无数据来源**：阶段 A 未落地监控与机柜位置字段，这两列恒渲染 `-`。列本身按实测 30 列保留。
3. **单向映射**：阶段 A 为旧表 → `cmdb_assets` 单向映射。在旧模块（云桌面终端台账 / 物理服务器）中新增或修改的数据，**不会自动出现在 CMDB 列表**，需再次触发同步。
4. **`orgs` 为空需先同步**：组织表在同步过程中由旧台账科室灌入，未同步前 `GET /api/cmdb/meta` 的 `orgs/groups/categories/models` 均为空数组（前端左侧面板会显示「暂无数据」文案）。
5. **`exe` 未重新打包**：工作区 `常州中院资产与服务器全景管理.exe` 仍为 2026-09-12 22:00 构建，**不包含本轮阶段 A 的任何改动**。需 `npm.cmd run build` + `go build` 后才能双击看到阶段 A 成果。

---

## 7. 结论

阶段 A 的**后端与前端代码实现已完成并通过全部自动化测试（9 个 Go 用例全绿）与接口级端到端核对（16 项全通过）**；旧台账 686 条记录（683 终端 + 3 服务器）成功幂等映射进 CMDB，重复同步不产生重复数据，组织维度过滤、关键字检索、状态过滤、列头排序、非法排序防护、详情与 404 语义均符合预期，既有 5 张表与 26 个接口零改动。

**但阶段 A 尚未完成浏览器级可视化验收**（见第 4 节 8 项未验证内容），且 exe 未重新打包。建议在浏览器中补验第 4 节各项后再正式判定阶段 A 通过，随后再出阶段 B 计划。

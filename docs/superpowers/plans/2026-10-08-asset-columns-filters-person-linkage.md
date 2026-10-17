# 三类资产列分组、实际筛选与人员联动实施计划

## 最新纠正：补齐基础设施位置整条链路

本节优先于下文旧列组描述。基础设施固定列顺序纠正为：`资产名称｜设备类型｜品牌 / 型号｜操作系统｜负责人 / 部门｜位置｜管理 IP / 网络｜设备状态｜操作`。

- [x] 位置列组合展示房间、机房/区域、楼层、机柜、排/列和 U 位，并兼容 `area`、`cabinet_pos`、`u_start`、`u_height` 旧字段。
- [x] 虚拟机无实体位置时显示“无实体位置”，实体设备空位置显示“未配置位置”。
- [x] 位置加入用户可选筛选项；具体值可匹配任一真实位置字段，“未配置”要求所有位置字段均为空。
- [x] 列表和导出共用 `location` 查询参数；导出“位置标识”输出真实位置摘要。
- [x] 全量 `go test ./...`、相关前端测试、装配后 lint/build 均通过；隔离 Netcatty 测试机已验证位置列、位置摘要、位置筛选、列表/导出一致性及 1536 宽布局。证据见 [位置页面截图](../../../build/native-asset-columns-preview/infrastructure-location.png) 与 [页面验收记录](../../../build/native-asset-columns-preview/asset-types-verification.json)。

## 最新确认变更：三类资产同步移除资产分组

本节优先于下文原方案中的资产分组要求；下文保留先前实施和验收记录。

- **必须保留：** 三类资产独立页面、设备/系统类型及动态字段、名称、人员部门、网络标识、凭证中心、快速连接、分页、导入导出、详情联动、维修调换和归档能力。组织架构中的人员分组继续保留。
- **本轮调整：** 终端与基础设施的第二列为“设备类型”，业务系统第二列为“系统类型”；配置中心只维护三套类型目录。具体设备类型优先于宽泛分类展示。
- **明确移除：** 三类资产分组的列表列、筛选与显隐选项、新增编辑、详情和批量编辑入口；设备资产工具栏的“分类与分组管理”；配置中心的资产分组目录。
- **待确认：** 无；按用户“终端资产、基础资产、业务资产都需要连着改动”直接实施。

影响页面为 `TerminalAssets.jsx`、`Infrastructure.jsx`、`InfrastructureEditor.jsx`、`DeviceOwnershipBar.jsx`、`Systems.jsx`、`DeviceAssets.jsx`、`ConfigCenter.jsx` 和 `Taxonomy.jsx`；列顺序与类型展示沿用 `assetTableModel.js`、`deviceWorkspaceModel.js`。数据库、接口和旧格式导入导出保留 `group_id/group_name` 兼容，编辑已有记录继续携带原值，不进行数据迁移或清空。

实际页面检查发现：基础设施选择“交换机”会漏掉已有分类的交换机。同步调整 `state.js` 的类型选项和 `internal/store/cmdb_store.go` 的类型条件：设备类型按实际字段匹配全部项目内资产，只有旧记录缺少类型时才回退到分类名称；显式分类 ID 仍精确匹配。列表和导出共用条件，不变更数据库结构。

验收清单：

- [x] 三类资产及配置中心统一移除资产分组入口，保留设备/系统类型。
- [x] 更新项目规则和使用说明，防止后续恢复旧分组界面。
- [x] 运行列模型、设备类型、状态及装配测试。
- [x] 装配到隔离 Netcatty 测试机，检查三类列表、筛选、新增编辑、终端详情和批量修改，以及三类资产编辑后的历史分组保留。

本轮实际验证：装配后的 70 项相关前端测试通过，修改文件 lint 通过，Netcatty 界面构建通过，`go test ./...` 通过；基础设施类型回归同时覆盖列表和导出。隔离测试机已加载 `build/cmdb-server-asset-types.exe` 与更新后的界面，API 端口 `18084`，DevTools 端口 `9240`。页面操作验证记录为 [asset-types-verification.json](../../../build/native-asset-columns-preview/asset-types-verification.json)，包含三类旧资产保存后历史分组保留、交换机筛选、新增表单、终端详情/批量修改和配置中心弹窗；截图为 [终端资产](../../../build/native-asset-columns-preview/terminal-types.png)、[基础设施](../../../build/native-asset-columns-preview/infrastructure-types.png)、[业务系统](../../../build/native-asset-columns-preview/system-types.png)、[配置中心](../../../build/native-asset-columns-preview/config-types.png)。

本轮没有连接真实 SSH/Telnet/SNMP 设备，也没有操作原生导出文件选择对话框；这些能力的完整实机流程未在本轮重新验收。导出筛选的一致性由后端回归测试验证。未改动版本号、正式安装程序、正式数据库或远程仓库。

不修改版本号，不提交、推送或发布，不操作正式安装目录和正式数据库。

> **执行要求：** 按任务顺序执行；每项先写失败测试并确认按预期失败，再写最小实现。当前工作区已有用户改动，本轮不提交、不发布、不升级版本，只保留可审查的工作区变更。

**目标：** 将终端资产、基础设施和业务系统的列表列组、筛选来源、网络标识及人员部门联动改为符合当前项目实际数据的实现，并把终端资产名称贯通保存、查询和导入导出。

**架构：** 保留三类资产独立页面和现有 Go + SQLite 调用链。终端资产继续使用 `assets`，基础设施继续使用 `cmdb_assets`，业务系统继续使用 `server_apps`；不合并表，不新增状态管理框架。列表展示规则提取为可测试的纯函数，查询条件由页面传到既有接口，后端按项目范围和实际记录执行精确筛选。

**技术栈：** Go、SQLite、React、Netcatty `components/ui`、Tailwind、Radix UI、Lucide、Node.js `node:test`。

---

## 本轮需求清单

### 必须保留

- 设备资产中的终端资产、基础设施、业务系统三个独立子页面。
- 三类资产现有搜索、分页、新增、编辑、详情、导入导出和关联穿透能力。
- 终端资产的调换使用人、维修换件、履历、注销归档、系统自动识别和 Netcatty 连接。
- 基础设施的批量编辑、克隆、注销归档、设备工作区、快速连接、接口地址和类型专属字段。
- 业务系统关联承载服务器、业务 IP、供应商和凭证中心。
- 用户自定义每个页面显示多少个筛选项；导出使用全部当前筛选条件且不受分页限制。
- 云桌面专属字段只在云桌面、云盒或盒子类终端显示。

### 本轮新增

- 终端资产增加独立的“资产名称”，贯通数据库、模型、接口、搜索、表单、详情、导入模板和导出。
- 终端列表列顺序固定为：`资产名称｜分类 / 资产分组｜使用人 / 部门｜房间 / 位置｜IP / 网络｜资产编码 / SN｜操作系统｜设备状态｜操作`。
- 基础设施列表列顺序固定为：`资产名称｜分类 / 资产分组｜品牌 / 型号｜操作系统｜负责人 / 部门｜管理 IP / 网络｜状态｜操作`。
- 业务系统列表列顺序固定为：`系统名称 / 版本｜分类 / 资产分组｜供应商｜负责人｜业务 IP / 网络｜承载服务器｜状态｜操作`。
- 分类、资产分组、组织归属和网络类型保持四套独立含义，不互相代替。
- 终端支持分类、资产分组、部门、使用人、位置、网络类型、操作系统、设备状态和归档状态筛选。
- 基础设施支持分类、资产分组、负责人、部门、品牌、型号、操作系统、网络类型、设备状态和归档状态筛选。
- 业务系统支持系统分类、资产分组、供应商、负责人、承载服务器、是否关联服务器、网络类型和系统状态筛选。
- “未分类”“未分组”“未配置”是明确可查询条件；多个筛选条件取交集。
- 编辑人员组织归属时，组织、部门、分组级联正确回填；保存后已明确关联的资产同步负责人部门。
- 网络标识跟随具体 IP；没有可靠来源时显示“未配置”，不得猜成专网或复制管理网络。

### 明确移除

- 终端列表中的“使用人 / 房间号”和“部门 / 分组”错误组合。
- 基础设施列表中的“品牌 / 型号 / 系统”错误组合。
- 业务系统列表中的独立版本列、独立端口列及含义不清的“IP”列。
- 终端网络类型空值时默认显示“专网”的推断。
- 自定义分类与设备类型使用 `OR` 造成跨分类混入的筛选语义。

### 待确认

- 无。本轮按用户确认方案直接实施；云桌面两个 IP 目前只有一个终端网络类型字段，分别的网络标识优先读取 IPAM，无法确认时显示“未配置”，不在本轮虚构第二个网络字段。

## 文件职责与回滚边界

- `internal/store/store.go`、`internal/store/cmdb_migrate.go`：增加 `assets.asset_name` 并兼容已有数据库。
- `internal/store/legacy_models.go`、`internal/store/legacy_store.go`：终端名称、精确筛选和业务系统网络筛选的数据契约。
- `internal/store/cmdb_store.go`：基础设施分类交集、实际字段和网络筛选。
- `internal/server.go`：解析新增查询参数，并同步导入模板、导出列及导出筛选。
- `integrations/netcatty/cmdb/api.js`：继续复用查询参数序列化，不新增请求框架。
- `integrations/netcatty/cmdb/assetTableModel.js`：三类列表的纯展示和筛选模型。
- `integrations/netcatty/cmdb/TerminalAssets.jsx`、`Infrastructure.jsx`、`Systems.jsx`：应用确认后的列顺序和筛选控件。
- `integrations/netcatty/cmdb/People.jsx`、`organizationEditorModel.js`：人员组织级联统一使用数值 ID。
- `scripts/prepare-netcatty.mjs`、`scripts/prepare-netcatty.test.mjs`：装配新增模型并验证正式产物。

回滚时可按上述文件恢复本轮增量；数据库新增列为向后兼容字段，旧版本忽略该列，不删除用户数据。

---

### 任务 1：建立三类资产展示与筛选契约

**文件：**

- 新建：`integrations/netcatty/cmdb/assetTableModel.js`
- 新建：`integrations/netcatty/cmdb/assetTableModel.test.js`
- 修改：`scripts/prepare-netcatty.mjs`

- [x] **步骤 1：编写失败测试**

测试必须断言：终端、基础设施、业务系统的列键顺序分别等于本计划确认顺序；空网络不推断；云桌面两个地址分别按 IPAM 匹配；人员级联 ID 统一转为数值；筛选参数保留 `-1` 的未分组语义。

- [x] **步骤 2：确认测试按预期失败**

运行：

```powershell
node --test integrations/netcatty/cmdb/assetTableModel.test.js
```

预期：失败，提示 `assetTableModel.js` 不存在。

- [x] **步骤 3：实现纯模型**

导出以下稳定接口：

```js
export const TERMINAL_COLUMN_KEYS = ['asset_name', 'category_group', 'owner_department', 'room', 'network', 'code_serial', 'operating_system', 'status', 'actions']
export const INFRASTRUCTURE_COLUMN_KEYS = ['name', 'category_group', 'vendor_model', 'operating_system', 'owner_department', 'network', 'status', 'actions']
export const SYSTEM_COLUMN_KEYS = ['name_version', 'category_group', 'provider', 'owner', 'network', 'host', 'status', 'actions']
export function terminalNetworkRows(asset, ipamEntries) {}
export function applicationNetworkPresentation(app) {}
export function numericOrganizationPath(record) {}
```

网络函数只返回真实字段或 IPAM 匹配结果；不存在时返回“未配置”。

- [x] **步骤 4：运行测试确认通过**

运行：`node --test integrations/netcatty/cmdb/assetTableModel.test.js`

预期：全部通过。

### 任务 2：贯通终端资产名称和实际筛选

**文件：**

- 修改：`internal/store/store.go`
- 修改：`internal/store/cmdb_migrate.go`
- 修改：`internal/store/legacy_models.go`
- 修改：`internal/store/legacy_store.go`
- 修改：`internal/store/legacy_asset_store_test.go`
- 修改：`internal/server.go`
- 修改：相关终端导入测试文件
- 修改：`integrations/netcatty/cmdb/TerminalAssets.jsx`

- [x] **步骤 1：编写失败测试**

Go 测试覆盖：旧数据库自动增加 `asset_name`；创建、更新、读取保留名称；关键字可命中名称；`group_id=-1` 只返回未分组；使用人、位置、网络类型和操作系统筛选取交集；导出值第一项业务字段包含名称；普通终端不输出云桌面专属字段。

- [x] **步骤 2：确认测试失败**

运行：

```powershell
go test ./internal/store -run 'Test.*Asset.*(Name|Filter|Migration)' -count=1
go test ./internal -run 'Test.*Asset.*(Export|Template|Import)' -count=1
```

预期：失败原因是模型、列或筛选参数尚不存在。

- [x] **步骤 3：实现数据库和后端契约**

`Asset` 增加 `AssetName string 'json:"asset_name"'`。新库在 `assets` 表创建 `asset_name TEXT NOT NULL DEFAULT ''`；已有库通过现有列迁移函数增加同名列。所有 `SELECT/INSERT/UPDATE` 的字段与 `Scan` 顺序同步修改。

把终端筛选收敛为查询对象，字段为：

```go
type AssetQuery struct {
    Keyword, DeviceType, Department, UserName, Room, NetType, OSType, Status string
    GroupID int64
    IncludeArchived bool
    Page, PageSize int
}
```

关键字包含 `asset_name`；`GroupID == -1` 匹配 `group_id=0`；其他非空字段做精确匹配；所有条件使用 AND。

- [x] **步骤 4：同步模板、导入和导出**

模板、导入和导出增加“资产名称”，并保持现有云桌面字段判定。列表导出复用与列表完全相同的查询对象，只取消分页限制。

- [x] **步骤 5：更新原生终端页面**

表单第一项为资产名称且必填；详情标题优先名称。列表按确认的九组列渲染，使用人和部门同组、房间独立、分类和资产分组同组、每个 IP 与其真实网络同组、编码与 SN 同组、系统图标与版本同组。筛选项从当前项目目录和实际记录构建，并保留筛选项显隐偏好。

- [x] **步骤 6：运行终端相关测试**

运行：

```powershell
go test ./internal/store -count=1
go test ./internal -count=1
node --test integrations/netcatty/cmdb/assetTableModel.test.js
```

预期：全部通过。

### 任务 3：修复人员组织级联和资产部门同步

**文件：**

- 修改：`integrations/netcatty/cmdb/organizationEditorModel.js`
- 修改：`integrations/netcatty/cmdb/organizationEditorModel.test.js`
- 修改：`integrations/netcatty/cmdb/People.jsx`
- 修改：`internal/store/person_store_test.go`（仅在现有覆盖不足时补充）

- [x] **步骤 1：编写失败测试**

测试使用字符串和数值混合 ID 的人员记录，断言编辑时组织、部门、分组均能在树中定位并回填；更换组织清空部门和分组，更换部门只清空分组。Go 测试继续断言人员部门变更会在同一事务同步明确关联的 `cmdb_assets` 和终端 `assets`。

- [x] **步骤 2：确认前端测试失败**

运行：`node --test integrations/netcatty/cmdb/organizationEditorModel.test.js`

预期：混合 ID 场景失败。

- [x] **步骤 3：实现数值 ID 归一化**

编辑人员时通过纯函数生成 `{ org_id, department_id, group_id }` 数值路径；树查找统一使用 `Number(node.id) === Number(selectedID)`。保存仍由后端解析真实组织名称，不允许页面提交旧部门文案覆盖组织树。

- [x] **步骤 4：验证人员和资产同步**

运行：

```powershell
node --test integrations/netcatty/cmdb/organizationEditorModel.test.js
go test ./internal/store -run 'TestUpdatePersonOrganizationMovesOwnedAssets' -count=1
```

预期：全部通过。

### 任务 4：修正基础设施分类筛选和列表列组

**文件：**

- 修改：`internal/store/cmdb_store.go`
- 修改：相关 `cmdb_store` 测试文件
- 修改：`integrations/netcatty/cmdb/state.js`
- 修改：`integrations/netcatty/cmdb/infrastructureTableModel.js`
- 修改：`integrations/netcatty/cmdb/infrastructureTableModel.test.js`
- 修改：`integrations/netcatty/cmdb/Infrastructure.jsx`

- [x] **步骤 1：编写失败测试**

测试覆盖：选择具体分类只匹配 `category_id`；设备类型兼容项仅查询未分类旧记录；分类与其他筛选条件取交集；未分组可查；网络类型匹配管理字段或真实接口网络；列表把品牌/型号与操作系统拆开；紧凑布局不丢失负责人和网络，只允许单元格紧凑呈现或横向滚动。

- [x] **步骤 2：确认测试失败**

运行：

```powershell
go test ./internal/store -run 'Test.*Cmdb.*Filter' -count=1
node --test integrations/netcatty/cmdb/infrastructureTableModel.test.js
```

预期：分类 `OR` 语义和旧列组合导致断言失败。

- [x] **步骤 3：实现精确筛选**

`CategoryID > 0` 单独生成 `a.category_id = ?`；只有没有分类 ID 且显式选择设备类型时才匹配类型别名。增加负责人、部门、品牌、型号、网络类型和归档状态参数，网络类型通过 `a.net_type` 或同项目接口的 `network_zone/net_zone` 匹配。

- [x] **步骤 4：应用确认列组**

名称单元格不再重复分类/分组。品牌图标、品牌和型号保持一组；操作系统使用 `OperatingSystemCell` 独立成列；负责人和部门同组；管理 IP、网络标识和快速连接同组。交换机、路由器、安全设备不补造不适用的 CPU、内存、硬盘或操作系统。

- [x] **步骤 5：验证基础设施**

运行：

```powershell
go test ./internal/store -count=1
node --test integrations/netcatty/cmdb/infrastructureTableModel.test.js integrations/netcatty/cmdb/assetTableModel.test.js
```

预期：全部通过。

### 任务 5：补齐业务系统实际筛选和业务 IP 网络标识

**文件：**

- 修改：`internal/store/legacy_models.go`
- 修改：`internal/store/legacy_store.go`
- 修改：相关业务系统存储测试文件
- 修改：`internal/server.go`
- 修改：`integrations/netcatty/cmdb/Systems.jsx`

- [x] **步骤 1：编写失败测试**

测试覆盖：业务系统列表返回自身 `service_ip`；网络类型从相同项目、相同 IP 的 IPAM 网段/地址元数据取得；没有匹配时为空；未分组可查；供应商、负责人、承载服务器、是否关联服务器、网络类型和状态筛选取交集；导出使用相同筛选。

- [x] **步骤 2：确认测试失败**

运行：`go test ./internal/store -run 'Test.*App.*(Filter|Network)' -count=1`

预期：新增网络字段或筛选尚不存在。

- [x] **步骤 3：实现查询对象和列表数据**

新增业务系统查询对象，避免继续扩展位置参数：

```go
type ServerAppQuery struct {
    Keyword, AppType, Status, Provider, Owner, NetworkType string
    GroupID, HostID int64
    HostLinked string
    Page, PageSize int
}
```

`ServerApp` 增加只读 `NetworkType`。列表查询通过项目内 `service_ip` 匹配 IPAM 网络定义；没有匹配时返回空。`HostLinked=linked/unlinked` 分别匹配存在或不存在 `cmdb_asset_id/server_id`。

- [x] **步骤 4：应用确认列组**

名称与版本同组；分类与资产分组同组；供应商、负责人各自独立；业务 IP、网络标识和端口同组；承载服务器独立且可穿透；不把承载服务器管理 IP冒充业务 IP。

- [x] **步骤 5：验证业务系统**

运行：

```powershell
go test ./internal/store -count=1
go test ./internal -count=1
node --test integrations/netcatty/cmdb/assetTableModel.test.js
```

预期：全部通过。

### 任务 6：装配、回归和 Netcatty 测试机验收

**文件：**

- 修改：`scripts/prepare-netcatty.test.mjs`
- 修改：`使用说明.md`
- 修改：本计划文件中的复选状态

- [x] **步骤 1：增加装配失败断言**

断言装配产物包含新模型、终端资产名称、三套确认列组、实际筛选参数和人员数值级联；断言旧错误列名不再出现。

- [x] **步骤 2：运行装配测试并修复到通过**

运行：

```powershell
node --test integrations/netcatty/cmdb/*.test.js
node --test scripts/prepare-netcatty.test.mjs
```

- [x] **步骤 3：运行全量后端测试**

运行：`go test ./...`

预期：全部通过。

- [x] **步骤 4：启动隔离 Netcatty 测试机**

使用 `scripts/start-native-preview.cjs` 和 `build/native-asset-layout-preview/assets.db`，不得连接正式数据库。

- [x] **步骤 5：手工验收**

逐项检查：

1. 三类列表的列顺序、字号、行高和滚动均符合确认方案。
2. 终端名称可新增、修改、搜索、导入和导出。
3. “未分组”及多个筛选条件能正确联动，导出结果与列表条件一致。
4. 编辑人员时组织、部门、分组回填；修改部门后明确关联资产同步。
5. 基础设施分类不混入其他分类；管理 IP 保留快速连接并显示真实网络。
6. 业务系统显示自身业务 IP 和真实网络，可穿透承载服务器。
7. 亮色、暗色和窄窗口下无重叠，操作按钮可达。

- [x] **步骤 6：同步文档并停止**

只更新实际完成和已验证能力；未验证项明确保留为未验证。不创建发布、不修改版本、不推送远程仓库。

## 隔离测试机验收记录（2026-10-08）

- 测试机：Netcatty `build/netcatty-asset-columns`，Cmdb API `http://127.0.0.1:18084`，DevTools `9240`。
- 测试数据：组织树“常州中院 / 信息技术处 / 基础运维组”；人员“张工 / 李工”；专网、内网、外网各一个 `/24` 网段；终端、云桌面、服务器、交换机、安全设备和业务系统演示记录。
- 三类资产页面：终端列组显示资产名称、分类/分组、使用人/部门、房间/位置、IP/网络、资产编码/SN、操作系统、状态；基础设施列组显示品牌/型号与操作系统分列、管理 IP/网络；业务系统显示自身业务 IP/网络并可穿透承载服务器。
- 联动结果：终端云桌面同时显示业务/虚拟机 IP与终端物理 IP；普通终端不显示云桌面专属字段；业务系统 `172.20.10.20` 从 IPAM 网段显示为外网；IPAM 页面显示 VLAN/VNI、使用率和占用数量；组织树与人员归属正常展示。
- 页面结果：通过 CDP 检查终端、基础设施、业务系统、组织架构、IPAM/IP 和工单与统计入口；当前未发现控制台错误，窄窗口检查未发现页面整体横向溢出。
- 数据边界：演示数据只写入 `build/native-asset-columns-preview/assets.db`；正式安装版、正式数据库和远程仓库未操作。

# Netcatty Cmdb 组织架构工作区实施计划

> **面向执行代理：** 必须使用 `subagent-driven-development`（推荐）或 `executing-plans`，逐任务执行并用复选框追踪。每次提交只暂存本任务涉及的文件，不得混入工作树中的既有修改。

**目标：** 在 Netcatty 原生 Cmdb 中交付机关单位任意层级组织树、自定义节点类型和人员状态、人员唯一正式归属、人员拖拽调动以及管理员确认资源是否跟随的完整闭环。

**架构：** 将现有 `cmdb_org_nodes` 从固定三级类型升级为通用树节点，通过项目级节点类型目录表达“部门、科室、办事处”等含义；人员使用唯一 `primary_org_node_id` 建立正式归属。拖拽确认由单一事务服务同时更新人员和选定资源，并写入人员调动履历与资源归属事件。

**技术栈：** Go 1.25、SQLite、React、Netcatty `components/ui`、Tailwind、Radix UI、Lucide、HTML5 Drag and Drop、Node.js 原生测试。

---

## 一、文件职责

### 后端新增文件

- `internal/store/organization_schema.go`：节点类型、人员状态、调动履历及兼容补列迁移。
- `internal/store/organization_types.go`：节点类型和人员状态目录 CRUD。
- `internal/store/organization_tree.go`：任意层级组织树、根节点和移动/停用规则。
- `internal/store/person_transfer.go`：人员批量调动、资源选择和事务履历。
- `internal/store/organization_io.go`：组织与人员导入预览、提交和导出。
- `internal/server_organization.go`：组织树、目录和调动 HTTP 接口。
- `internal/server_organization_io.go`：组织与人员导入导出接口。

### 原生界面新增文件

- `integrations/netcatty/cmdb/OrganizationTree.jsx`：任意层级组织树及节点菜单。
- `integrations/netcatty/cmdb/OrganizationNodeEditor.jsx`：新增、编辑、移动和停用节点弹窗。
- `integrations/netcatty/cmdb/OrganizationCatalogs.jsx`：节点类型和人员状态管理。
- `integrations/netcatty/cmdb/PersonTransferDialog.jsx`：资源跟随确认。
- `integrations/netcatty/cmdb/organizationState.js`：树查询、拖拽载荷和资源选择纯函数。

### 主要修改文件

- `internal/store/store.go`：接入组织迁移。
- `internal/store/project_schema.go`：新表纳入项目隔离和同步元数据。
- `internal/store/config_store.go`：移除新写路径对固定组织类型的依赖。
- `internal/store/person_store.go`：使用唯一主归属、编号生成和状态规则。
- `internal/server_cmdb_person_custom.go`：人员请求和详情兼容新模型。
- `internal/server.go`：注册新接口。
- `integrations/netcatty/cmdb/People.jsx`：重构为组织树和人员表格工作区。
- `integrations/netcatty/cmdb/api.js`：组织目录、移动、停用、拖拽调动和数据交换 API。
- `scripts/prepare-netcatty.test.mjs`：原生装配断言。
- `AGENTS.md`、`使用说明.md`：最终验收后同步产品规则。

---

## 二、实施任务

### 任务 1：新增组织工作区数据库结构

**文件：**

- 新增：`internal/store/organization_schema.go`
- 新增：`internal/store/organization_schema_test.go`
- 修改：`internal/store/store.go`
- 修改：`internal/store/project_schema.go`
- 修改：`internal/store/project_schema_test.go`

- [ ] **步骤 1：编写旧库升级测试**

断言新增表：

```go
var organizationTables = []string{
	"cmdb_org_node_types",
	"cmdb_person_statuses",
	"cmdb_person_transfers",
	"cmdb_person_transfer_items",
}
```

断言 `cmdb_org_nodes` 新增 `node_type_id`、`status`，`cmdb_persons` 新增 `primary_org_node_id`、`person_status_id`；全部新表具备 `project_id`、`sync_id`、`revision`、`updated_at`、`deleted_at`。

- [ ] **步骤 2：运行迁移测试确认失败**

```powershell
go test ./internal/store -run 'TestOrganizationWorkspaceMigration|TestProjectMigrationAddsSyncColumns' -count=1
```

预期：新表或新列不存在。

- [ ] **步骤 3：实现幂等迁移**

唯一索引必须按项目隔离：

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_org_node_types_project_name
ON cmdb_org_node_types(project_id, name) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_person_statuses_project_name
ON cmdb_person_statuses(project_id, name) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_persons_project_code
ON cmdb_persons(project_id, person_code)
WHERE deleted_at IS NULL AND TRIM(person_code) <> '';
```

- [ ] **步骤 4：接入迁移顺序和项目元数据**

在 `store.Open` 中于配置表建立后、`MigrateProjectSchema` 前执行 `MigrateOrganizationSchema`。将四张新表加入 `projectScopedTables`，并补齐项目迁移测试夹具的插入分支。

- [ ] **步骤 5：运行空库、旧库、幂等测试并提交**

```powershell
go test ./internal/store -run 'TestOrganizationWorkspaceMigration|TestProjectMigration' -count=1
git add internal/store/organization_schema.go internal/store/organization_schema_test.go internal/store/store.go internal/store/project_schema.go internal/store/project_schema_test.go
git commit -m "feat: add organization workspace schema"
```

### 任务 2：迁移旧三级组织与人员归属

**文件：**

- 修改：`internal/store/organization_schema.go`
- 修改：`internal/store/organization_schema_test.go`
- 修改：`internal/store/config_store.go`

- [ ] **步骤 1：编写兼容迁移测试**

构造 organization、department、group 三级节点和以下人员：

```go
[]Person{
	{Name: "甲", OrgID: 1, DepartmentID: 2, GroupID: 3},
	{Name: "乙", OrgID: 1, DepartmentID: 2},
	{Name: "丙", OrgName: "同名部门", Department: "同名科室"},
}
```

断言甲的主归属为 group 节点、乙为 department 节点、丙进入未归属；不得只按名称自动匹配丙。

- [ ] **步骤 2：建立默认目录**

新项目只插入目录配置，不插入人员或业务数据：

```go
var DefaultOrgNodeTypes = []string{"机关单位", "内设机构", "部门", "科室", "派出机构", "办事处", "其他", "待确认类型"}
var DefaultPersonStatuses = []PersonStatusSeed{
	{Name: "在岗", Assignable: true},
	{Name: "借调", Assignable: true},
	{Name: "挂职", Assignable: true},
	{Name: "退休", Departed: true},
	{Name: "离职", Departed: true},
	{Name: "停用", Departed: true},
}
```

- [ ] **步骤 3：实现确定性迁移规则**

- `organization` 映射“机关单位”。
- `department` 映射“部门”。
- `group` 映射“待确认类型”。
- 人员按 `group_id > department_id > org_id` 选择最深有效节点。
- 只有文本、无有效 ID 的人员保持 `primary_org_node_id=0`，由“未归属”展示。
- 旧 `org_id/department_id/group_id` 不删除。

- [ ] **步骤 4：保证重复打开不改写已人工修正类型**

迁移只处理 `node_type_id=0` 或 `primary_org_node_id=0` 的旧行；管理员后续修改不能被再次打开数据库覆盖。

- [ ] **步骤 5：运行迁移测试并提交**

```powershell
go test ./internal/store -run 'TestOrganizationLegacyMigration|TestOrganizationWorkspaceMigration' -count=1
git add internal/store/organization_schema.go internal/store/organization_schema_test.go internal/store/config_store.go
git commit -m "feat: migrate legacy organization hierarchy"
```

### 任务 3：实现节点类型与人员状态目录

**文件：**

- 新增：`internal/store/organization_types.go`
- 新增：`internal/store/organization_types_test.go`
- 新增：`internal/server_organization.go`
- 新增：`internal/server_organization_test.go`
- 修改：`internal/server.go`

- [ ] **步骤 1：编写项目隔离、停用和引用保护测试**

测试同名类型可以存在于不同项目；被节点或人员引用时归档接口返回包含引用数量的错误；已归档目录项不能用于新记录。

- [ ] **步骤 2：实现目录结构与 CRUD**

```go
type OrgNodeType struct {
	ID int64 `json:"id"`
	Name string `json:"name"`
	Icon string `json:"icon"`
	SortOrder int64 `json:"sort_order"`
	Status string `json:"status"`
}

type PersonStatus struct {
	ID int64 `json:"id"`
	Name string `json:"name"`
	Assignable bool `json:"assignable"`
	Departed bool `json:"departed"`
	SortOrder int64 `json:"sort_order"`
	Status string `json:"status"`
}
```

- [ ] **步骤 3：注册目录接口**

```text
GET/POST       /api/cmdb/org-node-types
PUT            /api/cmdb/org-node-types/{id}
POST           /api/cmdb/org-node-types/{id}/archive
GET/POST       /api/cmdb/person-statuses
PUT            /api/cmdb/person-statuses/{id}
POST           /api/cmdb/person-statuses/{id}/archive
```

- [ ] **步骤 4：验证停用项不出现在可选列表**

列表接口使用 `include_archived=1` 时供管理页显示历史项；默认只返回启用项。人员和节点表单必须使用默认结果。

- [ ] **步骤 5：运行测试并提交**

```powershell
go test ./internal/store -run 'TestOrgNodeType|TestPersonStatus' -count=1
go test ./internal -run 'TestOrgNodeType|TestPersonStatus' -count=1
git add internal/store/organization_types.go internal/store/organization_types_test.go internal/server_organization.go internal/server_organization_test.go internal/server.go
git commit -m "feat: manage organization catalogs"
```

### 任务 4：实现任意层级组织树

**文件：**

- 新增：`internal/store/organization_tree.go`
- 新增：`internal/store/organization_tree_test.go`
- 修改：`internal/server_organization.go`
- 修改：`internal/server_organization_test.go`
- 修改：`internal/server.go`

- [ ] **步骤 1：编写根节点、移动防环和停用测试**

覆盖：每项目只允许一个根节点；根节点不能移动、归档；普通节点可挂到任意启用节点；节点不能移动到自身或后代；停用中节点不能接收人员、资源或新下级。

- [ ] **步骤 2：实现通用树节点**

```go
type OrganizationNode struct {
	ID int64 `json:"id"`
	ParentID int64 `json:"parent_id"`
	NodeTypeID int64 `json:"node_type_id"`
	NodeTypeName string `json:"node_type_name"`
	Name string `json:"name"`
	Status string `json:"status"`
	SortOrder int64 `json:"sort_order"`
	DirectPersonCount int `json:"direct_person_count"`
	TotalPersonCount int `json:"total_person_count"`
	Children []OrganizationNode `json:"children"`
}
```

- [ ] **步骤 3：实现移动与归档事务**

```go
func (s *Store) MoveOrganizationNodeForProject(scope ProjectScope, id, parentID int64, sortOrder int) error
func (s *Store) ArchiveOrganizationNodeForProject(scope ProjectScope, id int64) error
```

移动只更新节点关系和修订号；人员路径查询实时计算，不批量重写文本路径。

- [ ] **步骤 4：注册组织节点接口**

```text
GET    /api/cmdb/org-tree
POST   /api/cmdb/org-nodes
PUT    /api/cmdb/org-nodes/{id}
POST   /api/cmdb/org-nodes/{id}/move
POST   /api/cmdb/org-nodes/{id}/archive
```

- [ ] **步骤 5：运行测试并提交**

```powershell
go test ./internal/store -run TestOrganizationTree -count=1
go test ./internal -run TestOrganizationTree -count=1
git add internal/store/organization_tree.go internal/store/organization_tree_test.go internal/server_organization.go internal/server_organization_test.go internal/server.go
git commit -m "feat: support arbitrary organization hierarchy"
```

### 任务 5：升级人员唯一归属和编号规则

**文件：**

- 修改：`internal/store/person_store.go`
- 修改：`internal/store/person_store_test.go`
- 修改：`internal/server_cmdb_person_custom.go`
- 修改：`internal/server_cmdb_person_custom_test.go`

- [ ] **步骤 1：编写编号、归属和离岗状态测试**

断言人员编号手填值在项目内唯一；空编号自动生成 `RY-000001`；并发生成不会重复；主归属必填且节点必须启用；离岗状态人员不能接收新资产。

- [ ] **步骤 2：扩展人员契约**

```go
type Person struct {
	// 保留既有兼容字段
	PrimaryOrgNodeID int64 `json:"primary_org_node_id"`
	PrimaryOrgPath string `json:"primary_org_path"`
	PersonStatusID int64 `json:"person_status_id"`
}
```

新写路径不再接收 `group_id/group_name`，邮箱字段只保留数据库兼容，不出现在新 API 响应的编辑字段集合中。

- [ ] **步骤 3：实现事务内编号生成**

```go
func nextPersonCode(tx *sql.Tx, projectID int64) (string, error) {
	// 查询当前项目 RY- 数字最大值，加一并用六位补零；唯一索引处理并发冲突。
}
```

唯一索引冲突返回“人员编号已存在”，不得改用姓名匹配。

- [ ] **步骤 4：更新人员查询**

组织筛选改用 `primary_org_node_id` 及其后代 ID；返回实时完整路径和统一资产工作区统计的资源总数。保留分页和姓名、编号、岗位、电话搜索。

- [ ] **步骤 5：运行测试并提交**

```powershell
go test ./internal/store -run TestPerson -count=1
go test ./internal -run TestPerson -count=1
git add internal/store/person_store.go internal/store/person_store_test.go internal/server_cmdb_person_custom.go internal/server_cmdb_person_custom_test.go
git commit -m "feat: enforce single person organization"
```

### 任务 6：实现人员拖拽调动事务

**文件：**

- 新增：`internal/store/person_transfer.go`
- 新增：`internal/store/person_transfer_test.go`
- 修改：`internal/server_organization.go`
- 修改：`internal/server_organization_test.go`
- 修改：`internal/server.go`

- [ ] **步骤 1：编写三种资源处理模式测试**

```go
const (
	TransferResourcesAll = "all"
	TransferResourcesNone = "none"
	TransferResourcesSelected = "selected"
)
```

测试单人和多人调动；`all` 更新全部责任资源，`none` 不更新资源，`selected` 只更新给定复合引用。任一资源失效或跨项目时，人员和资源全部保持原值。

- [ ] **步骤 2：定义请求和预览契约**

```go
type PersonTransferRequest struct {
	PersonIDs []int64 `json:"person_ids"`
	TargetOrgNodeID int64 `json:"target_org_node_id"`
	ResourceMode string `json:"resource_mode"`
	ResourceRefs []string `json:"resource_refs"`
	Operator string `json:"operator"`
	Remark string `json:"remark"`
}
```

预览接口返回人员原路径、目标路径以及来自统一资产查询的责任资源列表。

- [ ] **步骤 3：实现原子调动**

```go
func (s *Store) TransferPersonsForProject(scope ProjectScope, req PersonTransferRequest) (*PersonTransferResult, error)
```

事务内重新读取目标节点、人员和资源；更新人员主归属；按模式更新资源组织节点；写 `cmdb_person_transfers`、`cmdb_person_transfer_items` 和统一资产事件。

- [ ] **步骤 4：注册预览和提交接口**

```text
POST /api/cmdb/persons/transfer-preview
POST /api/cmdb/persons/transfer
```

普通用户返回 403；本轮不创建审批记录或待办。

- [ ] **步骤 5：运行事务和权限测试并提交**

```powershell
go test ./internal/store -run TestPersonTransfer -count=1
go test ./internal -run TestPersonTransfer -count=1
git add internal/store/person_transfer.go internal/store/person_transfer_test.go internal/server_organization.go internal/server_organization_test.go internal/server.go
git commit -m "feat: transfer people and owned resources"
```

### 任务 7：实现组织与人员导入导出

**文件：**

- 新增：`internal/store/organization_io.go`
- 新增：`internal/store/organization_io_test.go`
- 新增：`internal/server_organization_io.go`
- 新增：`internal/server_organization_io_test.go`
- 修改：`internal/server.go`

- [ ] **步骤 1：编写模板和预览校验测试**

组织模板列：

```go
[]string{"节点名称", "节点类型", "完整上级路径", "排序", "状态"}
```

人员模板列：

```go
[]string{"人员编号", "姓名", "主要归属完整路径", "职务 / 岗位", "联系电话", "人员状态", "备注"}
```

断言模板没有邮箱、工作组、所属分组。

- [ ] **步骤 2：实现精确路径解析**

路径使用 `/` 分隔并按完整父链精确匹配；同名叶节点不能模糊选择。预览报告根冲突、父路径不存在、同级重名、停用类型、人员编号冲突和停用状态。

- [ ] **步骤 3：实现预览令牌与事务提交**

人员编号为空时在预览中确定生成值并写入令牌数据；提交必须使用同一值。组织按路径深度排序后写入，任一行失败整批回滚。

- [ ] **步骤 4：实现全量筛选导出**

人员导出复用列表筛选但不带分页；组织导出按完整路径排序。不得导出历史兼容邮箱和 group 字段。

- [ ] **步骤 5：注册接口、运行测试并提交**

```text
GET  /api/cmdb/organizations/template
POST /api/cmdb/organizations/import
GET  /api/cmdb/organizations/export
GET  /api/cmdb/persons/template
POST /api/cmdb/persons/import
GET  /api/cmdb/persons/export
```

```powershell
go test ./internal/store -run TestOrganizationIO -count=1
go test ./internal -run TestOrganizationIO -count=1
git add internal/store/organization_io.go internal/store/organization_io_test.go internal/server_organization_io.go internal/server_organization_io_test.go internal/server.go
git commit -m "feat: import and export organizations and people"
```

### 任务 8：实现原生组织树与节点管理

**文件：**

- 新增：`integrations/netcatty/cmdb/OrganizationTree.jsx`
- 新增：`integrations/netcatty/cmdb/OrganizationNodeEditor.jsx`
- 新增：`integrations/netcatty/cmdb/OrganizationCatalogs.jsx`
- 新增：`integrations/netcatty/cmdb/organizationState.js`
- 新增：`integrations/netcatty/cmdb/organizationState.test.js`
- 修改：`integrations/netcatty/cmdb/api.js`
- 修改：`integrations/netcatty/cmdb/People.jsx`
- 修改：`scripts/prepare-netcatty.test.mjs`

- [ ] **步骤 1：编写树和节点可接收规则测试**

```javascript
test('停用和虚拟节点不能接收人员', () => {
  assert.equal(canDropPerson({ status: 'archived' }), false)
  assert.equal(canDropPerson({ virtual: true }), false)
  assert.equal(canDropPerson({ status: 'active' }), true)
})
```

同时测试完整路径、后代 ID 展开和节点搜索。

- [ ] **步骤 2：更新装配测试表达新结构**

断言 `People.jsx` 使用 `OrganizationTree`，不再导入 `Organizations` 通用表格；断言出现节点菜单、新增人员、人员导入导出和虚拟“未归属”；不得出现“工作组”“所属分组”和邮箱。

- [ ] **步骤 3：实现左树右表布局**

左树宽约 260-286px，支持展开、搜索、人数、目标高亮和节点菜单。右侧人员表保留搜索、状态筛选、分页、资源数和原生详情抽屉。

- [ ] **步骤 4：实现节点菜单与目录管理**

节点只通过菜单新增下级、编辑、移动、停用；移动使用上级选择弹窗。根节点隐藏移动和停用操作。节点类型和人员状态管理放在组织页面右上角设置菜单中。

- [ ] **步骤 5：运行纯函数和装配测试并提交**

```powershell
node --test integrations/netcatty/cmdb/organizationState.test.js scripts/prepare-netcatty.test.mjs
git add integrations/netcatty/cmdb/OrganizationTree.jsx integrations/netcatty/cmdb/OrganizationNodeEditor.jsx integrations/netcatty/cmdb/OrganizationCatalogs.jsx integrations/netcatty/cmdb/organizationState.js integrations/netcatty/cmdb/organizationState.test.js integrations/netcatty/cmdb/api.js integrations/netcatty/cmdb/People.jsx scripts/prepare-netcatty.test.mjs
git commit -m "feat: add native organization tree"
```

### 任务 9：实现人员拖拽和资源确认界面

**文件：**

- 新增：`integrations/netcatty/cmdb/PersonTransferDialog.jsx`
- 修改：`integrations/netcatty/cmdb/OrganizationTree.jsx`
- 修改：`integrations/netcatty/cmdb/People.jsx`
- 修改：`integrations/netcatty/cmdb/organizationState.js`
- 修改：`integrations/netcatty/cmdb/organizationState.test.js`
- 修改：`scripts/prepare-netcatty.test.mjs`

- [ ] **步骤 1：编写拖拽载荷和资源模式测试**

```javascript
test('拖动已选人员时使用整个选择集', () => {
  assert.deepEqual(resolveDraggedPersonIds(2, new Set([2, 3])), [2, 3])
  assert.deepEqual(resolveDraggedPersonIds(2, new Set([3])), [2])
})

test('逐项模式只提交勾选资源', () => {
  assert.deepEqual(buildTransferResources('selected', ['assets:1']), ['assets:1'])
  assert.deepEqual(buildTransferResources('none', ['assets:1']), [])
})
```

- [ ] **步骤 2：实现单人和批量拖拽**

人员行只在拖拽手柄按下时设置 `draggable`；拖到可接收节点时高亮并显示目标路径；放置后先调用预览接口，不直接写入。

- [ ] **步骤 3：实现资源确认窗口**

窗口固定提供“全部跟随、全部保留、逐项选择”分段控件。逐项模式按设备资源、业务系统和软件许可分组显示名称、编码、当前归属；后端预览错误直接展示。

- [ ] **步骤 4：提交后刷新所有关联视图**

成功后刷新组织人数、人员列表、人员详情和统一资产查询缓存；失败保持原选择和弹窗内容，不能显示伪成功。

- [ ] **步骤 5：运行测试并提交**

```powershell
node --test integrations/netcatty/cmdb/organizationState.test.js scripts/prepare-netcatty.test.mjs
git add integrations/netcatty/cmdb/PersonTransferDialog.jsx integrations/netcatty/cmdb/OrganizationTree.jsx integrations/netcatty/cmdb/People.jsx integrations/netcatty/cmdb/organizationState.js integrations/netcatty/cmdb/organizationState.test.js scripts/prepare-netcatty.test.mjs
git commit -m "feat: drag people between organization nodes"
```

### 任务 10：更新人员表单、详情与数据交换入口

**文件：**

- 修改：`integrations/netcatty/cmdb/People.jsx`
- 修改：`integrations/netcatty/cmdb/ImportDialog.jsx`
- 修改：`integrations/netcatty/cmdb/api.js`
- 修改：`scripts/prepare-netcatty.test.mjs`

- [ ] **步骤 1：更新新增编辑表单**

字段只保留人员编号、姓名、主要归属、职务/岗位、联系电话、人员状态和备注。人员编号提供“自动生成”开关；归属选择显示完整路径；邮箱和工作组不得渲染。

- [ ] **步骤 2：更新人员详情抽屉**

详情展示基础信息、完整路径、名下统一资产、调动履历和资源交接入口。资源名称点击后继续打开统一资产档案。

- [ ] **步骤 3：接入组织和人员导入导出**

导入必须先预览错误和自动生成编号，再确认提交；导出使用当前节点、关键词和状态筛选，不传当前页。

- [ ] **步骤 4：更新装配断言**

断言页面存在拖拽手柄、节点目标高亮、三种资源模式、人员编号自动生成、组织和人员导入导出；断言不存在邮箱和所属分组。

- [ ] **步骤 5：运行测试并提交**

```powershell
node --test integrations/netcatty/cmdb/*.test.js scripts/prepare-netcatty.test.mjs
git add integrations/netcatty/cmdb/People.jsx integrations/netcatty/cmdb/ImportDialog.jsx integrations/netcatty/cmdb/api.js scripts/prepare-netcatty.test.mjs
git commit -m "feat: complete organization people workflows"
```

### 任务 11：全链路验证与文档同步

**文件：**

- 修改：`AGENTS.md`
- 修改：`使用说明.md`
- 修改：`integrations/netcatty/README.md`

- [ ] **步骤 1：运行 Go 全量测试**

```powershell
go test -count=1 ./...
```

预期：组织迁移、项目隔离、人员调动、资产归属、导入回滚和既有接口测试全部通过。

- [ ] **步骤 2：运行原生集成测试**

```powershell
node --test integrations/netcatty/cmdb/*.test.js scripts/prepare-netcatty.test.mjs integrations/netcatty/electron/cmdbBridge.test.cjs
```

预期：全部通过，装配产物不包含 Ant Design、MUI、工作组或邮箱界面。

- [ ] **步骤 3：装配 Netcatty 并执行上游检查**

```powershell
node scripts/prepare-netcatty.mjs --target build/netcatty
```

在 `build/netcatty` 先运行 `npm run` 查看真实脚本，再执行 Cmdb 相关测试、lint 和完整构建。

- [ ] **步骤 4：使用临时数据库手测**

```powershell
$env:NETCATTY_CMDB_DB_PATH = Join-Path $env:TEMP 'netcatty-cmdb-organization-test.db'
node scripts/start-native-preview.cjs
```

手测：创建根单位、任意层级办事处、类型停用、节点移动防环、单人拖拽、批量拖拽、三种资源跟随模式、离岗限制、未归属补录、导入预览和全量导出。

- [ ] **步骤 5：同步文档**

将固定“组织、部门、分组”三级规则更新为任意层级正式节点；删除正式产品描述中的工作组、所属分组和人员邮箱；保留兼容迁移说明。

- [ ] **步骤 6：检查版本与发布数据**

```powershell
git status --short
node scripts/check-release-data.mjs
```

确认没有原型、临时数据库、真实人员或演示数据进入发布；用户未要求 bump 时不修改版本号。

- [ ] **步骤 7：提交文档**

```powershell
git add AGENTS.md 使用说明.md integrations/netcatty/README.md
git commit -m "docs: document organization workspace"
```

---

## 三、阶段验收和回滚

| 阶段 | 任务 | 验收结果 | 回滚边界 |
| --- | --- | --- | --- |
| 1 | 1-2 | 新结构和旧数据兼容迁移完成 | 保留新表列，旧页面仍可读取兼容字段 |
| 2 | 3-5 | 目录、任意层级树和人员唯一归属可用 | 关闭新接口，不删除目录和迁移结果 |
| 3 | 6-7 | 调动事务及组织人员数据交换可用 | 关闭拖拽入口，人员 CRUD 继续可用 |
| 4 | 8-10 | 原生组织树、拖拽和资源确认完整可用 | 恢复旧人员入口但禁止写入工作组 |
| 5 | 11 | 自动化和原生手测通过 | 不发布，保留上一安装包 |

## 四、完成标准

- 设计文档 AC-01 至 AC-15 均有自动化测试或明确手测证据。
- 每项目一个根机关单位，组织树支持任意层级和自定义节点类型。
- 人员只有一个正式归属，不出现工作组、多部门任职和邮箱字段。
- 人员编号项目内唯一，支持手填和自动生成。
- 单人和批量人员拖拽均先预览资源，再由管理员一次确认。
- 三种资源跟随模式在同一事务中执行，失败整体回滚。
- 组织和人员数据均支持导入预览、事务提交和筛选全量导出。
- 所有新表按项目隔离并具备稳定同步元数据，不污染正式安装数据。


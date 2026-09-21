# 任务 4B1 实施报告：隔离 CMDB 核心资产与人员 Store 链路

## 状态

已完成。实现范围限定在 CMDB 核心资产、人员 Store 及其直接测试，未修改 HTTP、前端、Electron、发布配置、模块/配置元数据、导入导出、同步或唯一索引迁移。

## 实现内容

### CMDB 核心资产

- 为资产列表、详情、原始插入、批量编辑、批量归档、批量克隆、手工创建、手工更新和删除增加 `ForProject(scope, ...)` API。
- 原无 scope API 统一通过 `DefaultProjectScope()` 解析默认项目，再转调显式 API。
- 资产列表、详情、更新、删除和批量 ID 操作均加入 `project_id` 条件；详情按 `(id, project_id)` 查询。
- `CmdbAsset` 新增并扫描 `project_id`、`sync_id`；创建时显式使用 scope 的项目 ID，并读取迁移触发器生成的稳定 `sync_id`。
- 手工创建、手工更新和批量编辑校验分类、型号、组织、分组和人员关系 ID 必须属于当前项目；调用方对象中的 `ProjectID` 不覆盖 scope。
- 资产关联的网络接口写入和读取同时受 `project_id` 与资产所属项目约束。
- 网卡与 IP 池联动、旧台账写穿均增加项目条件，避免 CMDB 操作影响其他项目的 IP 或来源记录。

### 人员

- 为人员列表、详情、创建、更新、删除、人员资产和批量交接增加 `ForProject(scope, ...)` API。
- 原无 scope API 保持可用，只操作默认项目。
- `Person` 新增并扫描 `project_id`、`sync_id`；创建时由 scope 决定项目并读取生成的 `sync_id`。
- 人员详情和 CRUD 按 `(id, project_id)` 操作；人员名下资产及资产数量仅统计同项目资产。
- 删除人员只解绑同项目资产，并在同一事务内返回真实失败。
- 资产分配/解绑沿用资产手工更新或批量编辑能力，校验人员、资产以及资产现存组织/分组关系均属于 scope。
- 批量交接校验移交人、接收人、每项资产及资产关系均属于 scope；交接日志和旧台账写穿携带项目条件。

## TDD 记录

### 第一轮 RED：核心 API 与元数据缺失

命令：

```powershell
go test ./internal/store -run 'TestProjectScope(Cmdb|Person)' -count=1
```

关键输出，退出码 `1`：

```text
internal\store\project_scope_cmdb_test.go:27:23: unknown field ProjectID in struct literal of type CmdbAsset
internal\store\project_scope_cmdb_test.go:28:21: s.InsertCmdbAssetForProject undefined
internal\store\project_scope_cmdb_test.go:38:26: s.QueryCmdbAssetsForProject undefined
internal\store\project_scope_cmdb_test.go:49:20: s.GetCmdbAssetForProject undefined
FAIL czfy-assets/internal/store [build failed]
```

失败原因与预期一致：实体尚未暴露项目/同步元数据，显式项目 API 尚不存在。

### 第一轮 GREEN

命令：

```powershell
go test ./internal/store -run 'TestProjectScope(Cmdb|Person)' -count=1
```

关键输出，退出码 `0`：

```text
ok   czfy-assets/internal/store  0.603s
```

### 第二轮 RED：人员操作放过被污染的跨项目组织/分组关系

命令：

```powershell
go test ./internal/store -run TestProjectScopePersonIsolationAssignmentAndTransfer -count=1
```

关键输出，退出码 `1`：

```text
--- FAIL: TestProjectScopePersonIsolationAssignmentAndTransfer
    --- FAIL: .../拒绝跨项目组织关系
        解绑必须拒绝跨项目组织关系，err=<nil>
    --- FAIL: .../拒绝跨项目分组关系
        解绑必须拒绝跨项目分组关系，err=<nil>
FAIL
```

失败揭示现有实现只校验新 owner，未校验被操作资产上已存在的关系。随后在批量编辑和批量交接前校验有效关系集合。

### 第二轮 GREEN

命令：

```powershell
go test ./internal/store -run TestProjectScopePersonIsolationAssignmentAndTransfer -count=1
```

关键输出，退出码 `0`：

```text
ok   czfy-assets/internal/store  0.179s
```

## 最终验证

按任务简报原样执行以下命令：

```powershell
go test ./internal/store -run 'TestProjectScope(Cmdb|Person)' -count=1
go test ./internal/store -run TestProjectScope -count=1
go test -count=1 ./...
git diff --check
```

实际关键输出：

```text
ok   czfy-assets/internal/store  0.593s
ok   czfy-assets/internal/store  1.157s
ok   czfy-assets                 0.170s
ok   czfy-assets/internal        2.234s
ok   czfy-assets/internal/store  9.640s
?    czfy-assets/tools/extract   [no test files]
```

四条命令整体退出码为 `0`。`git diff --check` 无空白错误，仅输出 Windows 工作区的 LF/CRLF 转换提示。

另在修正旧测试夹具后执行：

```powershell
go test ./internal/store -count=1
```

结果：

```text
ok   czfy-assets/internal/store  9.325s
```

## 变更文件

- `internal/store/cmdb_store.go`：资产实体元数据、项目化列表/详情/原始插入和默认项目包装。
- `internal/store/cmdb_write.go`：项目化批量编辑/归档/克隆/手工增改删、关系校验、项目内接口/IP/旧台账联动。
- `internal/store/person_store.go`：人员实体元数据、项目化 CRUD/人员资产/交接和默认项目包装。
- `internal/store/project_scope_cmdb_test.go`：4B1 多项目隔离、关系拒绝、默认兼容及同步元数据测试。
- `internal/store/cmdb_write_test.go`：将原先不存在的关系 ID 测试夹具改为真实默认项目关系，以符合新校验规则。
- `.superpowers/sdd/2026-09-17-netcatty-cmdb-project-sync-implementation/task-4b1-report.md`：本报告。

## 自审

- 已逐项核对简报规定的资产和人员 API；所有新增显式方法首个业务参数均为 `ProjectScope`，并调用 `ResolveProject`。
- 已检索相关资产/人员详情、更新、删除 SQL，目标实体均同时包含 `id` 和 `project_id` 条件。
- 批量编辑使用事务；发现任一非当前项目 ID 会回滚，不会修改其他项目。
- 调用方传入的 `ProjectID` 不参与 INSERT/UPDATE 项目选择，项目归属始终来自 scope。
- 关系校验支持用本次批量变更修复分类/组织/分组/人员关系，同时拒绝未修复的跨项目关系。
- 旧 API 的默认项目行为由定向测试覆盖；HTTP 在任务 4C 前仍可继续调用旧 API。
- 未引入共享可变“当前项目”，未修改唯一索引迁移。

## 顾虑与后续边界

- `cmdb_io.go`、`cmdb_sync.go`、模块/分类/标签/自定义字段和 HTTP 项目化按简报明确留待后续任务；本次仅在核心资产写入需要时读取这些关系的 `project_id` 进行校验。
- 现有全局唯一索引尚未改为项目内唯一，本任务未修改；不同项目相同唯一业务键的迁移由 4B2 处理。本次测试使用相同资产名、资产编码和人员业务编码验证 Store 读取隔离。
- 资产分配/解绑仍沿用既有手工更新和批量编辑入口，没有新增业务语义或 HTTP 接口。
- 未修改版本文件或 README 版本号，符合用户未要求 bump 的规则。

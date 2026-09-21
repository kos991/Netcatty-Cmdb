# 任务 4 实现报告

## 状态

BLOCKED。未提交代码，未保留半成品实现。

## 已完成的理解与 RED 记录

已读取任务说明、项目规则、`使用说明.md`、迁移元数据实现和现有测试入口。实际运行：

```powershell
go test ./internal/store -run TestProjectScope -count=1
```

RED 结果：构建失败，原因是当前仓库尚不存在 `ProjectScope`、项目 CRUD、带 scope 的资产/人员写入和查询接口。实际错误包括：

- `undefined: ProjectScope`
- `s.CreateCmdbProject undefined`
- `CreateCmdbAssetManual`、`QueryCmdbAssets` 仅有无 scope 签名
- `CmdbAsset` 未暴露 `ProjectID`、`SyncID` 字段

失败测试曾写入 `internal/store/project_scope_test.go`，在发现完成范围与任务说明不一致后已撤回，避免留下无法编译的工作树。

## 阻塞原因

任务 brief 指定的改动范围仅覆盖 11 个文件，但真实仓库中“全部查询和写入”的调用链额外分散在以下文件：

- [internal/server_cmdb_io.go](../../../internal/server_cmdb_io.go)：CMDB 导入、导出和筛选
- [internal/server_cmdb_write.go](../../../internal/server_cmdb_write.go)：CMDB 资产写入、批量编辑、归档和克隆
- [internal/server_cmdb_person_custom.go](../../../internal/server_cmdb_person_custom.go)：人员、资产关联与自定义字段
- [internal/server_cmdb_taxonomy.go](../../../internal/server_cmdb_taxonomy.go)：组织、分组和分类写入
- [internal/server_ip_pool.go](../../../internal/server_ip_pool.go)：IP 与子网写入
- [internal/store/cmdb_io.go](../../../internal/store/cmdb_io.go)：CMDB 全量导出、导入与分类关联
- [internal/store/cmdb_write.go](../../../internal/store/cmdb_write.go)：CMDB 资产写入、IP 联动和源台账写穿
- [internal/store/cmdb_taxonomy.go](../../../internal/store/cmdb_taxonomy.go)：分类数据与资产引用约束
- [internal/store/custom_field_store.go](../../../internal/store/custom_field_store.go)：自定义字段 CRUD
- [internal/store/cmdb_labels.go](../../../internal/store/cmdb_labels.go)：标签读写
- [internal/store/cmdb_meta.go](../../../internal/store/cmdb_meta.go)：组织、分组、设备模型元数据
- [internal/store/cmdb_sync.go](../../../internal/store/cmdb_sync.go)：旧台账同步
- [internal/store/ip_subnet.go](../../../internal/store/ip_subnet.go)：IP 子网 CRUD
- [internal/store/sangfor_import.go](../../../internal/store/sangfor_import.go)：深信服导入

此外，现有 `Store` 方法均为无 scope 接口。为满足“所有 HTTP handler 必须使用显式 ProjectScope”且保留无 scope 默认项目包装，需要先确定正式 API 形态（例如 `QueryCmdbAssetsForProject(scope, query)` 加保留的 `QueryCmdbAssets(query)` 包装）。不应以共享的可变 Store scope 实现，因为同一服务的并发 HTTP 请求会相互串项目。

## 建议的完整实现边界

1. 新建不可变 `ProjectScope`、项目 CRUD、默认项目解析和 HTTP `X-Cmdb-Project` 校验。
2. 为全部 18 张业务表建立显式 `...ForProject` 查询、详情、写入和关联校验；无 scope 方法仅解析默认项目后转调。
3. 所有 HTTP handler 先解析 scope，再仅调用显式 scope 方法；请求体的 `project_id` 一律忽略。
4. 覆盖资产、人员、IP、服务器/应用、履历、统计、全局查询、导出、导入、同步与跨项目关联的两项目隔离测试。
5. 执行 focused `TestProjectScope`、`go test -count=1 ./...`，复核完整 diff 后提交。

## 文件清单与自审

本轮没有保留业务代码或测试文件改动；仅本报告位于忽略目录。未创建提交。

自审结论：没有把默认项目回退、请求头校验或少量资产 SQL 伪装成全系统隔离实现。当前工作树避免了无法编译测试和局部隔离导致的跨项目数据泄露风险。

## 顾虑

需要用户确认是否授权将实现范围扩展到上述真实调用链文件。若不扩展，将无法同时满足“全部查询和写入受当前项目约束”和“所有 HTTP handler 使用显式 ProjectScope”。

---

## 阶段 A：项目上下文核心与旧业务 Store 隔离（2026-09-17）

### 范围与实现

- 新增 `internal/store/project_scope.go`：不可变 `ProjectScope`、有效性校验、默认项目解析、项目列表/读取/创建/更新/软删除/解析 API；已删除项目会被 `ResolveProject` 拒绝。
- `internal/store/legacy_models.go` 为资产、服务器、应用、履历、IP 与全局查询结果暴露 `project_id`。
- `internal/store/legacy_store.go` 为旧资产、服务器、应用、履历、统计和全局查询增加 `ForProject` 显式方法；原无 scope 方法仅解析默认项目再转调。详情、列表、写入与跨项目服务器-应用关联均以 `project_id` 约束。
- `internal/store/ip_pool.go` 为 IP 列表、详情、写入、更新、分配、释放、汇总和全量导出增加 `ForProject` 显式方法；IP 与资产联动按同一项目匹配。
- 新增 `internal/store/project_scope_test.go`，覆盖双项目同名资产/服务器/IP/应用的隔离、详情隔离、请求输入 `project_id` 被 scope 覆盖、跨项目应用关联拒绝、统计/全局查询/全量 IP 导出隔离、项目 CRUD 和无效/已删除 scope。

### RED 记录

先新增聚焦测试并执行：

```powershell
go test ./internal/store -run TestProjectScope -count=1
```

预期失败，构建错误明确指出尚不存在 `ProjectScope`、项目 CRUD 与 `ForProject` Store API，且模型未暴露 `ProjectID`。

### 实际验证

```powershell
go test ./internal/store -run TestProjectScope -count=1
# ok   czfy-assets/internal/store  0.272s

go test -count=1 ./internal/store
# ok   czfy-assets/internal/store  9.388s

git diff --check
# 通过；无空白错误
```

收尾时发现全仓既有 handler 测试要求“不存在资产”维持 404。`GetAssetForProject` 的项目隔离哨兵原先没有保留 `sql.ErrNoRows`，会被旧 handler 映射为 500。现已以 `errors.Join(ErrProjectScopedNotFound, sql.ErrNoRows)` 保留两种可观察语义，并在项目隔离回归测试中同时断言两者。

```powershell
gofmt -w internal/store/project_scope.go internal/store/project_scope_test.go internal/store/legacy_models.go internal/store/legacy_store.go internal/store/ip_pool.go
go test ./internal/store -run TestProjectScope -count=1
# ok   czfy-assets/internal/store  0.257s

go test -count=1 ./...
# ok   czfy-assets                0.190s
# ok   czfy-assets/internal       2.174s
# ok   czfy-assets/internal/store 12.950s
# ?    czfy-assets/tools/extract  [no test files]

git diff --check
# 通过；无空白错误
```

### 自审与剩余阶段

- 未修改 HTTP handler、正式安装目录、前端或发布配置；Store 没有保存可变“当前项目”。
- 剩余阶段 B 需要让 HTTP `X-Cmdb-Project` 解析后只调用显式 `ForProject` API；阶段 C 继续覆盖 CMDB 主数据、导入导出、分类、自定义字段、子网和同步链路。
- 旧 IP 删除/归属查询与 IP 规范化仍保留默认项目兼容实现，待阶段 C 统一覆盖其余 Store 链路，避免在本阶段扩大到导入、子网和同步模块。

---

## 阶段 4A 修复轮 1（2026-09-17）

### 修复内容

- `DeleteAssetForProject`、`TransferUserForProject` 与 `MaintenanceForProject` 写穿 `cmdb_assets` 时均追加 `project_id=?`，避免同一 `source_id` 影响其他项目映射记录。
- 新增 `DeleteIPEntryForProject`、`IPEntryOwnerForProject`、`ipOwnerForProject`；旧无 scope 方法只解析默认项目后转调。IP 条目读取、占用资产查询和删除均使用 scope 的 `project_id`。
- `project_scope_test.go` 增加跨项目同 `source_id` 的注销、调换、维修写穿隔离测试，以及同 IP 的归属/删除隔离测试。为了复现多项目同步后同来源键的历史数据，测试临时移除不含 `project_id` 的旧唯一索引。

### TDD 与验证

先新增测试执行：

```powershell
go test ./internal/store -run 'TestProjectScope(LegacyWriteThroughDoesNotCrossProject|IPOwnerAndDeleteIsolation)' -count=1
```

RED：因 `IPEntryOwnerForProject` 与 `DeleteIPEntryForProject` 尚不存在而构建失败。补齐最小实现后，测试首次暴露旧 `idx_cmdb_assets_source` 全局唯一索引不允许相同来源键；测试中移除该旧索引以覆盖真实跨项目写穿风险。

最终实际执行：

```powershell
gofmt -w internal/store/legacy_store.go internal/store/ip_pool.go internal/store/project_scope_test.go
go test ./internal/store -run 'TestProjectScope(LegacyWriteThroughDoesNotCrossProject|IPOwnerAndDeleteIsolation)' -count=1
# ok   czfy-assets/internal/store  0.473s

go test ./internal/store -run TestProjectScope -count=1
# ok   czfy-assets/internal/store  0.694s

go test -count=1 ./...
# ok   czfy-assets                0.204s
# ok   czfy-assets/internal       2.143s
# ok   czfy-assets/internal/store 9.169s
# ?    czfy-assets/tools/extract  [no test files]

git diff --check
# 通过；无空白错误
```

### 自审与剩余范围

- 本轮只修复阶段 4A 已修改的旧业务 Store 链路，未触及阶段 B/C 的 HTTP、CMDB 新模块、导入导出、子网或同步文件。
- 全局 `idx_cmdb_assets_source` 仍是未纳入本轮的既有 schema 约束；本轮 Store 写穿已不再依赖该约束来阻止跨项目修改。

# 任务 4B2 实施报告：隔离 CMDB 模块与配置元数据 Store 链路

## 状态

已完成。实现范围限定在工单、盘点、凭据、分类、组织、分组、型号、标签、自定义字段、IP 网段及其项目内唯一索引迁移；未修改 HTTP、前端、Electron、导入导出、同步或发布配置。

## 实现内容

### 模块与配置数据

- 工单、盘点任务、凭据的查询、详情、创建、更新、删除和计数均增加显式 `ForProject(scope, ...)` API。
- 分类树的列表、创建、更新、删除、父节点校验、防环和引用保护均限定当前项目。
- 组织、分组、分类、型号的列表、种子、查询和型号 CRUD 均限定当前项目。
- 自定义字段的列表、详情、保存和删除均限定当前项目。
- IP 网段的列表、统计、未定义占位、种子、详情、创建、改名级联和删除均限定当前项目。
- 原无 scope API 保留为默认项目包装，保证 HTTP 项目透传落地前现有调用链继续工作。

### 标签与看板

- 标签列表、已打印列表、孤儿统计、编码前缀、生成、修复、状态、删除、批量打印和看板数据均增加项目范围。
- 标签编码前缀改为项目级 `_meta` 键；默认项目继续兼容旧 `cmdb_label_prefix`。
- 标签关联资产按当前项目校验；批量打印混入其他项目 ID 时整体拒绝，不发生部分更新。
- 凭据查询关联资产时同时限定资产项目，避免跨项目展示名称。

### 唯一索引和升级安全

- 将组织、分组、分类、型号、标签、资产来源、自定义字段和 IP 网段的 8 个全局唯一索引迁移为项目内唯一索引。
- `idx_cmdb_assets_project_source` 继续只约束 `source_id > 0` 且未删除记录。
- 项目 schema 版本由 `1` 提升为 `2`；v1 升 v2 会先创建可读 SQLite 备份。
- 发现旧版 `cmdb_custom_fields.field_key` 还存在列级 `UNIQUE` 自动索引，单纯删除命名索引无法解除全局唯一。迁移现仅在检测到该旧约束时，于同一事务内重建表、保留全部业务和同步元数据，再恢复索引与触发器。

## TDD 记录

### 旧库列级唯一约束失败复现

命令：

```powershell
go test ./internal/store -run TestProjectScopeCustomFieldLegacyUniqueConstraintMigrates -count=1
```

修复前关键输出，退出码 `1`：

```text
--- FAIL: TestProjectScopeCustomFieldLegacyUniqueConstraintMigrates
    旧库升级后跨项目同字段键应可保存: 字段标识 legacy_same 已存在
FAIL
```

该失败确认 SQLite 为列级 `UNIQUE` 创建的自动索引无法通过原命名索引迁移删除。

### 修复后定向验证

同一命令修复后退出码 `0`：

```text
ok   czfy-assets/internal/store  0.282s
```

测试同时断言：升级后不同项目可以使用相同字段键，同一项目仍拒绝重复字段键。

## 最终验证

实际执行：

```powershell
go test ./internal/store -run 'TestProjectScope|TestOpenCreatesBackupForProjectSchemaV1Upgrade|TestProjectMigration|TestMigrateCMDBFullSchema' -count=1 -timeout 240s
go test ./internal/store -count=1 -timeout 300s
go test -count=1 ./...
git diff --check
```

实际关键输出：

```text
ok   czfy-assets/internal/store  4.078s
ok   czfy-assets/internal/store  14.387s
ok   czfy-assets                 0.290s
ok   czfy-assets/internal        3.416s
ok   czfy-assets/internal/store  15.081s
?    czfy-assets/tools/extract   [no test files]
```

全部测试退出码为 `0`。`git diff --check` 无空白错误，仅有 Windows 工作区的 LF/CRLF 转换提示。

## 变更文件

- `internal/store/cmdb_modules.go`：模块模型项目元数据与默认项目包装。
- `internal/store/project_scope_modules_store.go`：工单、盘点、凭据项目化实现。
- `internal/store/cmdb_taxonomy.go`：分类模型项目元数据与默认项目包装。
- `internal/store/cmdb_meta.go`：组织、分组、分类、型号模型元数据与默认项目包装。
- `internal/store/project_scope_taxonomy_store.go`：分类和型号项目化实现。
- `internal/store/cmdb_labels.go`：标签、编码前缀、打印和看板项目化实现。
- `internal/store/custom_field_store.go`：自定义字段模型元数据与默认项目包装。
- `internal/store/project_scope_custom_field_store.go`：自定义字段项目化实现。
- `internal/store/ip_subnet.go`：网段模型元数据与默认项目包装。
- `internal/store/project_scope_ip_subnet_store.go`：网段项目化实现。
- `internal/store/cmdb_schema.go`、`internal/store/cmdb_migrate.go`：新库不再创建全局唯一约束。
- `internal/store/project_schema.go`：项目内唯一索引和旧自定义字段表约束迁移。
- `internal/store/database_backup.go`、`internal/store/database_backup_test.go`：schema v2 和升级前备份测试。
- `internal/store/project_scope_cmdb_config_test.go`：模块、配置、标签、网段、旧 API 和旧库升级隔离测试。
- `internal/store/project_scope_test.go`：移除已失效的旧索引夹具操作。

## 自审与后续边界

- 显式项目方法均先解析有效项目；详情、更新和删除按 `(id, project_id)` 操作，跨项目目标返回明确错误。
- 调用方对象中的 `ProjectID` 不覆盖 scope，创建归属始终由 scope 决定。
- 文件已按分类、模块、自定义字段和 IP 网段拆分，避免形成 1153 行的混合职责文件。
- `cmdb_io.go`、`cmdb_sync.go`、`sangfor_import.go` 留给任务 4B3；HTTP 请求头和项目 CRUD API 留给任务 4C。
- 本阶段不修改版本号，发布仍须等待任务 15 全量验收和任务 16 发布门禁。

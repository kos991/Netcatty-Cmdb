# 任务 4B3 实施报告：隔离 CMDB 导入导出与同步 Store 链路

## 状态

代码实现和本地定向验证已完成；全量回归按用户要求交由仓库 GitHub Actions 执行。

## 实现内容

- 资产全部匹配导出和筛选项读取增加 `ForProject(scope, ...)`，结果只来自当前项目。
- Excel 导入预览按当前项目解析分类、组织、分组名称；提交只向当前项目写入资产。
- 旧台账同步只读取当前项目的终端、服务器和组织，来源判重改为项目内 `(source_type, source_id)`。
- 旧台账同步生成的 CMDB 网络接口显式写入当前项目，并校验关联资产属于当前项目。
- 深信服预览和提交按项目查询、更新或新增服务器和应用；其他项目同名对象不会误判为更新。
- 深信服提交继续使用原有单事务，数据库查询错误不再被误当成“记录不存在”。
- 原无 scope API 全部保留为默认项目包装，现有 HTTP 在任务 4C 前继续可用。

## TDD 记录

新增双项目测试后首次运行：

```powershell
go test ./internal/store -run 'TestProjectScope(CmdbIO|LegacySync|Sangfor)' -count=1
```

退出码 `1`，关键输出为 `PreviewCmdbImportForProject undefined`、`SyncLegacyToCmdbForProject undefined`、`CommitSangforImportForProject undefined`，与预期缺失项目 API 一致。

实现后同组测试退出码 `0`：

```text
ok   czfy-assets/internal/store  0.397s
```

## 本地验证

实际执行：

```powershell
go test ./internal/store -run 'Test(ProjectScope(CmdbIO|LegacySync|Sangfor)|CmdbAssetFilterOptionsAndExportAll|CmdbImport|SyncLegacyToCmdb)' -count=1 -timeout 240s
go test -run '^$' ./...
git diff --check
```

实际结果：

```text
ok   czfy-assets/internal/store  1.066s
ok   czfy-assets                [no tests to run]
ok   czfy-assets/internal       [no tests to run]
ok   czfy-assets/internal/store [no tests to run]
?    czfy-assets/tools/extract  [no test files]
```

定向行为测试和全仓库编译退出码均为 `0`。`git diff --check` 无空白错误，仅有 Windows LF/CRLF 转换提示。

## 仓库 CI

用户要求全量测试放到仓库 CI 以节省本地时间。提交推送后通过 `workflow_dispatch` 在 `feat/cmdb-project-sync` 分支运行 `.github/workflows/ci.yml`；CI 结果在任务台账和交付回复中记录，不把未运行状态写成通过。

## 变更文件

- `internal/store/cmdb_io.go`：默认项目兼容包装。
- `internal/store/project_scope_cmdb_io_store.go`：资产导出、筛选项、导入预览与提交的项目化实现。
- `internal/store/cmdb_sync.go`：默认项目同步包装。
- `internal/store/project_scope_cmdb_sync_store.go`：旧台账同步、判重和网络接口项目化实现。
- `internal/store/sangfor_import.go`：默认项目深信服导入包装。
- `internal/store/project_scope_sangfor_import_store.go`：深信服预览与事务提交的项目化实现。
- `internal/store/project_scope_cmdb_io_sync_test.go`：三条链路的双项目隔离、幂等和默认兼容测试。

## 边界

- HTTP `X-Cmdb-Project` 解析和项目 CRUD API 留给任务 4C。
- 全模块标准模板、预检、事务导入和三种导出范围留给任务 7。
- 未修改前端、Electron、版本号、Release 或正式安装目录。

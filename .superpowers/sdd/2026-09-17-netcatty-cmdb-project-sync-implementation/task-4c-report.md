# 任务 4C 实施报告：HTTP 项目上下文与项目 CRUD API

## 状态

代码实现和本地定向验证已完成；全量回归按用户要求交由仓库 GitHub Actions 执行。

## 实现内容

### 请求项目上下文

- 新增统一 `X-Cmdb-Project` 解析中间层，业务 handler 从请求上下文读取不可变 `ProjectScope`。
- 请求头完全缺失时回落默认项目，兼容现有独立运行和旧客户端。
- 请求头存在但为空、重复、非数字、非正数、不存在或项目已删除时返回 `400`，不会回落默认项目。
- 默认项目读取或数据库访问失败返回 `500`，避免把服务端故障伪装成客户端参数错误。
- 项目归属只取请求头/默认项目；资产等请求体中的 `project_id` 不覆盖 scope。

### 项目 API

- `GET /api/cmdb/projects`
- `POST /api/cmdb/projects`
- `PUT /api/cmdb/projects/{id}`

更新时以路径 ID 为准，不接受请求体 ID 覆盖。

### 业务路由

- 旧台账资产、服务器、应用、履历、IP、统计、全局查询、导出和深信服导入全部切换到显式 `ForProject` Store API。
- CMDB 资产、工单、盘点、凭据、标签、分类、型号、人员、自定义字段、导入导出和旧台账同步全部切换到显式 `ForProject` Store API。
- 健康检查、项目 API 和纯静态模板下载不要求项目请求头。
- 路由注册统一通过 `scoped` 包装，避免各 handler 自行解析请求头产生不一致。

### 补充修复

- HTTP 贯穿检查发现 `NormalizeIPPoolIPs` 仍会扫描并修改全部项目，已新增 `NormalizeIPPoolIPsForProject` 并让旧 API 只操作默认项目。
- 增加双项目 IP 规范化回归测试，确认规范化项目 A 不会修改项目 B。

## TDD 记录

新增 HTTP 项目测试后首次运行：

```powershell
go test ./internal -run 'TestProjectHeader|TestCmdbProjectHTTPCRUD' -count=1
```

退出码 `1`，实际失败固定了四类缺失行为：项目 A/B 请求仍返回默认项目数据；非法请求头返回 `200`；请求体项目未被请求头覆盖；项目 API 返回 `404`。

完成实现后同一命令退出码 `0`：

```text
ok   czfy-assets/internal  0.498s
```

## 本地验证

实际执行：

```powershell
go test ./internal -count=1 -timeout 240s
go test ./internal/store -run TestProjectScope -count=1 -timeout 240s
go test -run '^$' ./...
git diff --check
```

实际结果：

```text
ok   czfy-assets/internal        2.193s
ok   czfy-assets/internal/store  2.097s
ok   czfy-assets                 [no tests to run]
ok   czfy-assets/internal        [no tests to run]
ok   czfy-assets/internal/store  [no tests to run]
?    czfy-assets/tools/extract   [no test files]
```

`internal` 全套、Store 项目隔离测试和全仓库编译均退出 `0`。`git diff --check` 无空白错误，仅有 Windows LF/CRLF 转换提示。

## 回归修复

首次运行 `go test ./internal -count=1` 时，三个既有数据库关闭测试发现统一中间层把 `sql: database is closed` 返回为 `400`。实现随后区分参数/项目不存在和数据库故障，再次运行 `internal` 全套后通过；没有吞掉真实失败。

## 变更文件

- `internal/server_projects.go`：项目头解析、中间层、项目列表/新增/修改 API。
- `internal/server_project_scope_test.go`：请求头、默认兼容、双项目隔离、请求体覆盖和项目 API 测试。
- `internal/server.go`：旧台账 handler 项目透传和统一路由包装。
- `internal/server_cmdb.go`、`internal/server_cmdb_write.go`、`internal/server_cmdb_io.go`：CMDB 资产、同步和交换项目透传。
- `internal/server_cmdb_modules.go`：工单、盘点、凭据、标签、看板和型号项目透传。
- `internal/server_cmdb_person_custom.go`、`internal/server_cmdb_taxonomy.go`：人员、自定义字段和分类项目透传。
- `internal/server_ip_pool.go`：IP 池、网段和导出项目透传。
- `internal/store/ip_pool.go`、`internal/store/project_scope_test.go`：IP 规范化项目隔离及回归测试。

## 边界

- 前端项目选择和 `X-Cmdb-Project` 注入留给后续配置/工作区任务。
- 本阶段没有增加项目删除 HTTP API；计划固定 API 只有列表、新增和修改。
- 未修改版本号、Release 或正式安装目录。

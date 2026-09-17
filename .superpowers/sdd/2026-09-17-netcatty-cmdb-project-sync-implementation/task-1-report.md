# 任务 1：阻断发布包携带业务数据

## 实现内容

- `main.go` 通过唯一入口 `openApplicationStore` 打开数据库；该入口只初始化结构和已有 IP 池的网段定义，不再嵌入、解析或导入业务种子数据。
- 删除 `seed/seed_v2.json`，移除正式启动对 `ImportSeedV2`、`MarkSeededV2`、`EnsureServersSeeded` 的调用。
- `main_test.go` 增加临时数据库集成测试，断言 `assets`、`asset_logs`、`ip_pool`、`servers`、`server_apps`、`cmdb_assets`、`cmdb_persons` 均为空。
- 新增 `scripts/check-release-data.mjs`，递归扫描指定文件或目录；命中种子文件标识、已登记资产编号、人员名或真实 IP 时以非零状态退出。输出仅包含规则名和文件路径，不回显受保护值。
- CI 在 CMDB 构建后扫描服务二进制；发布流程在多平台服务二进制、Windows 嵌入服务和 Portable 包构建后扫描。

## RED / GREEN 证据

### RED

命令：

```powershell
go test . -run TestOpenApplicationStoreCreatesEmptyBusinessDatabase -count=1
```

关键输出：

```text
数据导入完成: 683 条终端资产, 691 条履历流水, 1267 条IP规划, 3 台物理服务器
全新库 assets 有 683 条业务数据
FAIL
```

该失败证明新测试能捕获正式启动导入业务种子数据的回归。

### GREEN

命令：

```powershell
go test . -run TestOpenApplicationStoreCreatesEmptyBusinessDatabase -count=1
```

关键输出：

```text
ok   czfy-assets
```

## 完整测试结果

```powershell
go test -count=1 ./...
```

结果：

```text
ok   czfy-assets
ok   czfy-assets/internal
ok   czfy-assets/internal/store
?    czfy-assets/tools/extract [no test files]
```

```powershell
go build -trimpath -o build/cmdb-server.exe .
node scripts/check-release-data.mjs build/cmdb-server.exe
```

结果：`发布数据扫描通过`。

另外使用临时文件分别写入四类已登记规则值验证扫描器，结果四条规则均被拒绝，扫描日志只输出规则名和临时文件路径。

## 文件清单

- `main.go`
- `main_test.go`
- `seed/seed_v2.json`（删除）
- `scripts/check-release-data.mjs`
- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`
- `.superpowers/sdd/2026-09-17-netcatty-cmdb-project-sync-implementation/task-1-report.md`

## 自审

- 没有修改 API-only、全局查询、CRUD、调换、维修、注销和履历相关路由或存储接口。
- 未修改版本号，未实现任务 2 的项目模型。
- 数据库验证仅使用测试临时路径；构建仅输出到当前工作树的 `build/`，未接触正式安装目录或真实 `assets.db`。
- 扫描器不打印受保护值，匹配文件会使命令以状态码 1 失败。

## 顾虑

- 本任务未执行 GitHub Actions 的完整跨平台构建，也未实际执行 Windows Portable 打包；工作流已加入对应扫描步骤，服务端本地构建产物已扫描通过。

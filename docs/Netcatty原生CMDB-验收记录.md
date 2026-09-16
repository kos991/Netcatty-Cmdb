# Netcatty 原生 CMDB 验收记录

## 验收结论

CMDB 已直接集成到 Netcatty Electron 主窗口，固定根标签为 `CMDB 资产管理`，标签 ID 为 `cmdb`。界面由 Netcatty 主渲染进程直接挂载，不经过浏览器、iframe、`view.html` 或插件宿主。

CMDB 内部一级入口固定为：

`全局查询 | 终端资产 | 基础设施资源 | 业务系统 | 基础管理 | 运维分析`

组合页签为：

- 基础管理：`组织与人员 | IP 规划池`
- 运维分析：`统计概览 | 运维履历`

## 自动化验证

以下命令均在分支 `feat/netcatty-native-cmdb` 的最终代码上实际执行。

| 命令 | 结果 |
| --- | --- |
| `go test ./...` | 退出码 0；根包、`internal`、`internal/store` 全部通过 |
| `node --test integrations/netcatty/electron/cmdbService.test.cjs integrations/netcatty/electron/cmdbBridge.test.cjs web/src/cmdbTransport.test.js web/src/cmdbWorkspaceState.test.js` | 退出码 0；35 项通过，0 失败 |
| `web/` 下执行 `npm.cmd run build` | 退出码 0；Vite 转换 3064 个模块并生成 `web/dist` |
| 在全新锁定上游副本执行 `node scripts/prepare-netcatty.mjs --target build/netcatty-native-final-validation` | 退出码 0；装配成功 |
| 装配后执行 `node --test electron/cmdbService.test.cjs electron/bridges/cmdbBridge.test.cjs` | 退出码 0；16 项通过，0 失败 |
| 装配后执行 `npm.cmd run lint` | 退出码 0；无 ESLint 错误 |
| 装配后执行 `npm.cmd run build` | 退出码 0；Vite 完整构建成功 |
| `git diff --check` | 退出码 0 |
| Playwright 驱动真实 Electron 窗口执行原生写流程 | 退出码 0；6 组流程通过，页面异常 0；结果见 [原生写流程结果](acceptance/netcatty-native-cmdb/native-workflow-results.json) |

全新上游副本固定在提交 `c16f0c43d4ac8cf9377e330b8fb440cec630aeda`。装配后存在 `components/cmdb/CmdbWorkspace.jsx`、`electron/cmdbService.cjs` 和 `electron/bridges/cmdbBridge.cjs`，不存在 `examples/plugins/cmdb-netcatty`。

Netcatty 构建输出包含上游既有的 `diagnostics_channel` 浏览器兼容性提示、动态/静态导入提示和大 chunk 提示；构建最终退出码为 0。

## 原生窗口验收

使用真实 Electron 窗口和测试数据库 `.superpowers/sdd/2026-09-16-netcatty-native-cmdb/workspace-test.db` 验证，未打开独立 CMDB 浏览器页面。

| 验收项 | 结果 | 证据 |
| --- | --- | --- |
| Netcatty 顶栏固定显示 `CMDB 资产管理`，与 Vaults、SFTP 同级 | 通过 | [原生根标签与终端资产](acceptance/netcatty-native-cmdb/native-root-and-terminal.png) |
| 六个一级入口完整显示 | 通过 | [全局查询与六入口](acceptance/netcatty-native-cmdb/native-global-navigation.png) |
| 六类全局查询均返回真实结果并可进入对应对象 | 通过 | [六类查询结果](acceptance/netcatty-native-cmdb/native-global-search-six-groups.png) |
| 终端资产新增、编辑、调换、维修、详情履历、导出与注销归档 | 通过 | [终端资产写流程与履历](acceptance/netcatty-native-cmdb/native-terminal-workflow.png) |
| 基础设施资源真实台账和分页 | 通过 | [基础设施台账](acceptance/netcatty-native-cmdb/native-infrastructure.png) |
| 新增基础设施资源包含服务器、虚拟机、交换机、路由器、安全设备、存储设备 | 通过 | [资源类型下拉](acceptance/netcatty-native-cmdb/native-infrastructure-types.png) |
| 业务系统独立页面、查询和新增入口 | 通过 | [业务系统](acceptance/netcatty-native-cmdb/native-business-systems.png) |
| 基础管理固定包含组织与人员、IP 规划池 | 通过 | [组织与人员](acceptance/netcatty-native-cmdb/native-org-directory.png)、[IP 规划池](acceptance/netcatty-native-cmdb/native-ip-pool.png) |
| 人员名下资产穿透并可完整交接给另一人员 | 通过 | [人员资产交接](acceptance/netcatty-native-cmdb/native-person-transfer.png) |
| IP 补录、分配、回读与释放 | 通过 | [IP 分配](acceptance/netcatty-native-cmdb/native-ip-allocation.png)、[IP 释放](acceptance/netcatty-native-cmdb/native-ip-release.png) |
| 根标签切换后保留 IP 规划池当前子页 | 通过 | [状态保留](acceptance/netcatty-native-cmdb/native-ip-preserved.png) |
| 运维分析固定包含统计概览、运维履历 | 通过 | [统计概览](acceptance/netcatty-native-cmdb/native-operations-dashboard.png)、[运维履历](acceptance/netcatty-native-cmdb/native-operations-audit.png) |
| Netcatty 浅色、深色主题可切换，CMDB 跟随宿主主题 | 通过 | [浅色](acceptance/netcatty-native-cmdb/native-cmdb-light.png)、[深色](acceptance/netcatty-native-cmdb/native-cmdb-dark.png) |
| CMDB 服务不可用时显示错误原因和“重试”按钮 | 通过 | [服务错误页](acceptance/netcatty-native-cmdb/native-cmdb-service-error.png) |

页面状态验证过程为：在 `基础管理 > IP 规划池` 停留，切换到 Vaults，再返回 `CMDB 资产管理`；返回后仍显示 IP 规划池的网段统计、筛选和地址分配入口。

写流程验收使用从 `workspace-test.db` 复制出的独立数据库。桌面端新增两名验收人员和一台终端资产，实际提交编辑、调换使用人、维修换件、人员资产交接、IP 补录/分配/释放和注销归档，并通过 `window.netcatty` preload API 回读数据库状态。维修后确认旧件入库，注销后确认资产资料仍可读取且调换、维修、注销履历均保留。导出流程实际到达 Electron 原生保存对话框并取消，没有在测试机留下导出文件。

## 空白页问题与修复

第一次桌面验收时，CMDB 根标签存在，但主内容区为空白。根因是 Netcatty 的 AppView 工作区父节点为相对定位容器，不是给子节点分配 `flex-1` 高度的 flex 容器；原 `CmdbSurface` 高度因此坍缩。

修复把活动态 surface 从 `flex min-h-0 flex-1` 改为 `absolute inset-0 z-20 flex min-h-0`。修复后 CMDB 相对现有工作区铺满，不改变隐藏保活、IPC、Vaults 或 SFTP 行为。

修复前证据：[原生空白页](acceptance/netcatty-native-cmdb/native-cmdb-global-search.png)。

## 安装环境限制

在全新锁定上游副本执行 `npm.cmd install` 时，`node-pty` 原生模块重建失败，Visual Studio 报 `MSB8040`：缺少 Spectre 缓解库。该问题属于当前机器的 C++ 工具链组件缺失，本轮没有修改或掩盖该失败。

npm 11 还会默认阻止 Electron 安装脚本。桌面验收使用本机 Electron 42.3.3 缓存恢复运行时，并复用已存在的依赖树完成 lint、build 和原生窗口验证；未把全新安装记录为成功。

## 未执行项

- 未生成 Electron 安装包，因此只验证了 `electron-builder.config.cjs` 的 `cmdb-server` 打包配置和 Netcatty 完整前端构建，未实际解包安装包检查二进制。
- 原生写流程验收通过 IPC 创建业务系统搜索样本并确认六类全局查询真实返回；未在桌面窗口执行应用改绑。

## 版本与进程

- 项目版本保持 `1.1.0`，本轮未执行版本号升级。
- 验收结束后已停止 Netcatty 开发会话和 CMDB 子进程；端口 `5173`、`18080` 无监听。

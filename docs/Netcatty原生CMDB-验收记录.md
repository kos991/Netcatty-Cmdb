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
| 在全新 `v1.1.83` Release 副本执行 `node scripts/prepare-netcatty.mjs --target build/netcatty-native-release-v1.1.83-validation` | 退出码 0；装配成功 |
| 装配后执行 `node --test electron/cmdbService.test.cjs electron/bridges/cmdbBridge.test.cjs` | 退出码 0；16 项通过，0 失败 |
| 装配后执行 `npm.cmd run lint` | 退出码 0；无 ESLint 错误 |
| 装配后执行 `npm.cmd run build` | 退出码 0；Vite 转换 8015 个模块并完成构建 |
| `git diff --check` | 退出码 0 |
| Playwright 驱动真实 Electron 窗口执行原生写流程 | 退出码 0；6 组流程通过，页面异常 0；结果见 [原生写流程结果](acceptance/netcatty-native-cmdb/native-workflow-results.json) |
| Playwright 驱动真实 Electron 窗口执行业务系统改绑 | 退出码 0；承载服务器由 ID 4 改绑到 ID 5，IPC 回读一致，页面异常 0；结果见 [业务系统改绑结果](acceptance/netcatty-native-cmdb/native-app-rebind-results.json) |
| Electron unpacked 资源入包检查 | `release/win-unpacked/resources/cmdb/cmdb-server.exe` 已生成；与源文件长度及 SHA-256 完全一致；打包内二进制健康检查返回 `ok`，结果见 [unpacked 资源结果](acceptance/netcatty-native-cmdb/native-unpacked-resource-results.json) |

全新上游副本固定在仓库正式 Release `v1.1.83`，标签实际指向提交 `d7a0c8ed8d238dcf1c82d786da53037a1f1496b1`。装配后存在 `components/cmdb/CmdbWorkspace.jsx`、`electron/cmdbService.cjs` 和 `electron/bridges/cmdbBridge.cjs`，不存在 `examples/plugins/cmdb-netcatty`。

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
| 业务系统可在编辑弹窗改绑承载服务器并持久化 | 通过 | [业务系统改绑](acceptance/netcatty-native-cmdb/native-app-rebind.png) |
| 基础管理固定包含组织与人员、IP 规划池 | 通过 | [组织与人员](acceptance/netcatty-native-cmdb/native-org-directory.png)、[IP 规划池](acceptance/netcatty-native-cmdb/native-ip-pool.png) |
| 人员名下资产穿透并可完整交接给另一人员 | 通过 | [人员资产交接](acceptance/netcatty-native-cmdb/native-person-transfer.png) |
| IP 补录、分配、回读与释放 | 通过 | [IP 分配](acceptance/netcatty-native-cmdb/native-ip-allocation.png)、[IP 释放](acceptance/netcatty-native-cmdb/native-ip-release.png) |
| 根标签切换后保留 IP 规划池当前子页 | 通过 | [状态保留](acceptance/netcatty-native-cmdb/native-ip-preserved.png) |
| 运维分析固定包含统计概览、运维履历 | 通过 | [统计概览](acceptance/netcatty-native-cmdb/native-operations-dashboard.png)、[运维履历](acceptance/netcatty-native-cmdb/native-operations-audit.png) |
| Netcatty 浅色、深色主题可切换，CMDB 跟随宿主主题 | 通过 | [浅色](acceptance/netcatty-native-cmdb/native-cmdb-light.png)、[深色](acceptance/netcatty-native-cmdb/native-cmdb-dark.png) |
| CMDB 服务不可用时显示错误原因和“重试”按钮 | 通过 | [服务错误页](acceptance/netcatty-native-cmdb/native-cmdb-service-error.png) |

页面状态验证过程为：在 `基础管理 > IP 规划池` 停留，切换到 Vaults，再返回 `CMDB 资产管理`；返回后仍显示 IP 规划池的网段统计、筛选和地址分配入口。

写流程验收使用从 `workspace-test.db` 复制出的独立数据库。桌面端新增两名验收人员和一台终端资产，实际提交编辑、调换使用人、维修换件、人员资产交接、IP 补录/分配/释放和注销归档，并通过 `window.netcatty` preload API 回读数据库状态。维修后确认旧件入库，注销后确认资产资料仍可读取且调换、维修、注销履历均保留。导出流程实际到达 Electron 原生保存对话框并取消，没有在测试机留下导出文件。

业务系统改绑使用另一份独立数据库，并在 `v1.1.83` Release 装配副本的真实 Electron 窗口中执行：创建两台测试服务器和一个业务系统，在业务系统详情中打开编辑弹窗，将承载服务器从 ID 4 改为 ID 5，保存后通过 preload IPC 回读 `server_id=5`。测试同时确认编辑字段可见、成功提示出现且页面异常为空。

## 空白页问题与修复

第一次桌面验收时，CMDB 根标签存在，但主内容区为空白。根因是 Netcatty 的 AppView 工作区父节点为相对定位容器，不是给子节点分配 `flex-1` 高度的 flex 容器；原 `CmdbSurface` 高度因此坍缩。

修复把活动态 surface 从 `flex min-h-0 flex-1` 改为 `absolute inset-0 z-20 flex min-h-0`。修复后 CMDB 相对现有工作区铺满，不改变隐藏保活、IPC、Vaults 或 SFTP 行为。

修复前证据：[原生空白页](acceptance/netcatty-native-cmdb/native-cmdb-global-search.png)。

## 安装环境限制

在真正的短路径全新 Release 副本 `C:\Users\Administrator\AppData\Local\Temp\netcatty-v1183-cmdb-validation` 重新执行标准 `npm.cmd install` 时，`node-pty` 原生模块重建稳定失败，Visual Studio 报 `MSB8040`：缺少 Spectre 缓解库。该问题属于当前机器的 C++ 工具链组件缺失，本轮没有修改或掩盖该失败。仓库内长路径副本还会更早触发 `MSB3491`，因此短路径复测用于排除路径因素。

npm 11 还会默认阻止 Electron 安装脚本。Release 装配验证使用 `npm.cmd install --ignore-scripts` 安装依赖，并从此前已验证的本机缓存复制 Electron 42.3.3 运行时，仅用于 lint、build 和真实窗口验收；未把该过程记录为标准安装成功。安装过程另报告 50 个上游依赖审计项：10 low、11 moderate、26 high、3 critical，本轮未执行 `npm audit fix`。

同一全新装配副本执行 `npm.cmd ci` 会在安装前拒绝运行，因为装配器向 `package.json` 增加了 antd 等依赖，但锁定上游的 `package-lock.json` 尚未包含这些依赖；当前装配流程仍以计划规定的 `npm.cmd install` 为准。

`pack:dir` 首次还暴露了 Netcatty 上游 Windows Hello helper 脚本的中文路径兼容问题：脚本把含中文绝对路径以 UTF-8 无 BOM 写入临时 `.cmd`，系统默认 GBK 代码页解析后误报 `"cl.exe" is not recognized`。在已初始化的 `VsDevCmd.bat` 环境中直接执行后，helper 编译通过，证明这不是 CMDB 集成或 `cl.exe` 缺失。继续打包时，`node-pty` 重建稳定失败于上述 `MSB8040`。

## 未完成项

- 已实际执行 `npm.cmd run pack:dir`。Netcatty 完整前端构建成功，Windows Hello helper 在初始化 MSVC 环境后也编译成功，但 Electron Builder 重建 `node-pty` 时因宿主缺少 Spectre 缓解库报 `MSB8040`，标准打包仍以退出码 1 结束。
- 为单独验证 CMDB 资源配置，使用 `npmRebuild=false` 诊断覆盖继续到 unpacked 生成阶段；Electron Builder 随后的 `afterPack` 钩子仍会显式重建 `node-pty` 并以同一 `MSB8040` 退出。因此 `release/win-unpacked` 不是完整成功的正式产物，但其中 `resources/cmdb/cmdb-server.exe` 已实际生成、与源文件字节一致，并通过 API-only 健康检查。

## 版本与进程

- 项目版本保持 `1.1.0`，本轮未执行版本号升级。
- 验收结束后已停止 Netcatty 开发会话和 CMDB 子进程；端口 `5173`、`18080` 无监听。

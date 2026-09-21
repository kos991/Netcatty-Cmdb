# Netcatty Cmdb 原生界面迁移实施计划

## 目标

将 Cmdb 正式界面完整迁移到 Netcatty 原生组件体系，移除运行时 Ant Design 依赖，只保留 Netcatty 桌面客户端入口，同时保留现有业务能力和后端接口。

## 实施步骤

1. 在 `integrations/netcatty/cmdb/` 建立唯一正式界面源码和 Cmdb 领域基础组件，包括表格、分页、筛选栏、表单字段、弹层、抽屉、状态标记、加载、错误和空状态。
2. 迁移工作区壳层和设备资产统一搜索，直接使用 Netcatty `components/ui`、Tailwind、Radix UI 和 Lucide。
3. 依次迁移终端资产、基础设施、业务系统，保持查询、分页、详情联动、CRUD、导入导出、调换、维修和注销归档。
4. 迁移组织架构、IPAM/IP、统计与履历、配置中心，保持组织人员管理、IP 分配释放及配置目录管理。
5. 调整 `scripts/prepare-netcatty.mjs`，只复制 `integrations/netcatty/cmdb/`，删除 Ant 依赖注入；更新装配测试，阻止 Ant 重新进入目标工程。
6. 更新项目文档和原生验证入口，停止维护独立浏览器构建。

## 验证

1. 运行状态辅助函数、Electron bridge/service、装配脚本和 Go 全量测试。
2. 对装配后的 Netcatty 运行 lint、相关测试和生产构建。
3. 启动 Electron，以空测试库检查五个一级模块、设备资产三个子页、明暗主题、弹层、分页和核心操作。
4. 扫描装配结果，确认 Cmdb 可达源码和 `package.json` 不含 Ant Design 依赖。

## 回滚边界

- 原生界面修改集中在 `integrations/netcatty/cmdb/` 和装配脚本，不修改业务数据库格式。
- 后端 API 与数据模型保持兼容；发生界面回归时可回滚集成层，不回滚或清空用户数据。

## 实施与验收结果

- 上述六个迁移步骤已实现。正式界面直接使用宿主组件，旧 `web/` 不再装配、嵌入或发布；现有未提交的历史页面修改仍保留。
- `node --test scripts/prepare-netcatty.test.mjs integrations/netcatty/electron/cmdbBridge.test.cjs integrations/netcatty/electron/cmdbService.test.cjs integrations/netcatty/cmdb/state.test.js`：20 项通过。
- `go test -count=1 ./...`：通过，包含旧导入模板在基础设施中查询、按操作系统筛选及导出可见性的回归测试。
- 装配后的 Netcatty 全量 lint 通过；最后一次前端修改后专项 lint 与生产构建再次通过，构建包含 5016 个模块。日志：[lint](../../../build/native-ui-lint.log)、[生产构建](../../../build/native-ui-build.log)。
- 在真实 Electron 生产页面执行 30 项检查：组织/部门/分组、人员级联、设备单双 IP、软件目录、调换、维修旧件、详情关联、导出、基础设施、业务系统、IP 分配释放、注销查回、导入预览与确认、操作系统筛选、统一搜索、分页、1024 窗口和明暗主题。测试数据库为独立的 `assets-acceptance.db`，未使用正式数据。
- 客户端记录：[核心操作 20 项](../../../build/native-ui-validation/results.json)、[补充操作 10 项](../../../build/native-ui-validation/final-results.json)。文件选择对话框在自动化测试中由隔离测试入口指定路径，之后经过真实 IPC、Excel 解析和 SQLite 写入；供用户测试的启动入口保留真实系统对话框。
- 截图：[深色表单](../../../build/native-ui-validation/form-dark.png)、[1024 深色表单](../../../build/native-ui-validation/form-dark-1024.png)、[亮色资产页](../../../build/native-ui-validation/assets-light-1024.png)、[IP 占用与空闲](../../../build/native-ui-validation/ipam-dark.png)、[导入预览](../../../build/native-ui-validation/import-preview-dark.png)。
- 20 行资产页测得 915 个 Cmdb 子 DOM、0 个 Ant DOM；五模块切换自动化耗时 100–400ms（包含点击等待和绘制等待）。这些是小测试库的本机结果，不能推断大量生产数据下的性能提升比例。
- 版本仍为 `1.2.0`，版本一致性检查和后端发布数据扫描通过。尚未提交、推送或发布；远程 CI 尚未运行。
- 本地测试命令为 `node scripts/start-native-preview.cjs`，使用独立空库与端口 18082。启动方式见[集成说明](../../../integrations/netcatty/README.md)。

## 验收边界

- 本轮验证原生界面迁移及上述业务链路；未做大规模数据压测、跨平台安装包验证或云端同步端到端验收。
- 运行时已移除 Ant，但旧源码目录仍作业务迁移参考，不能将整个仓库的文本搜索结果等同于运行时依赖。
- 导入可见性修复只扩展基础设施查询范围，不更改既有记录。需要回滚时可还原查询条件，不需要回滚数据库。

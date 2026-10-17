# Netcatty 设置入口与资产网络列实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Cmdb 配置移入 Netcatty 原生设置，并修复三类资产的 IP/网络混排和终端表格过宽。

**Architecture:** 保留 Go + SQLite 数据契约和三类资产独立页面。通过现有装配脚本给 Netcatty 设置页增加 Cmdb 选项；配置组件继续复用已有 API 与原生 UI。资产列表只调整展示模型与列布局，完整值仍留在详情。设置窗口与主窗口之间使用 Netcatty 现有设置变更通知通道传递目录变更、手动和自动云同步请求。

**Tech Stack:** React、Netcatty `components/ui`、Tailwind、Lucide、Node `node:test`、Go + SQLite。

---

## 本轮需求清单

- **必须保留：** 三类资产搜索、筛选、分页、CRUD、联动、快速连接、导入导出、注销履历；三套类型目录及工单、项目、模板等已可用配置；现有数据库和 API。
- **本轮新增：** Netcatty 设置中的 Cmdb 配置入口；无 Cmdb 侧栏配置入口；配置内容可直接查看和编辑；终端、基础设施、业务系统分别显示 IP 与网络类型；长编码和 SN 不挤掉状态、操作。
- **明确移除：** 六个横向一级页签和仅显示三类数量的默认空白页；三类列表中合写的 IP/网络列。
- **待确认：** 无。现有型号和网络类型目录保留数据与功能，但不要求先配置才能录入资产。

## 任务 1：设置入口与跨窗口请求

**文件：** `integrations/netcatty/cmdb/state.js`、`integrations/netcatty/cmdb/CmdbWorkspace.jsx`、`integrations/netcatty/CmdbSurface.tsx`、`scripts/prepare-netcatty.mjs`、`scripts/netcatty-update-integration.mjs`、`integrations/netcatty/CmdbCloudSync.ts`、`scripts/prepare-netcatty.test.mjs`。

- [x] 先在装配测试断言：工作区四个入口；设置页有 Cmdb 选项和懒加载配置组件；原生设置窗口的 Cmdb IPC 可用；手动同步跨窗口传递。
- [x] 运行 `node --test scripts/prepare-netcatty.test.mjs`，确认新增断言因缺失入口失败。
- [x] 删除侧栏配置项，设置页增加原生图标与 `SettingsLazyTab value="cmdb"`，渲染原配置组件；沿用现有 API，不复制数据库。
- [x] 使用现有 `notifySettingsChanged/onSettingsChanged` 通道将设置窗口的同步请求交给主窗口，保留工作区内原事件。
- [x] 重跑装配及云同步相关测试，确认设置页可构建。

## 任务 2：配置页原生密集布局

**文件：** `integrations/netcatty/cmdb/ConfigCenter.jsx`、`integrations/netcatty/cmdb/Catalog.jsx`、`scripts/prepare-netcatty.test.mjs`。

- [x] 先增加针对默认内容与配置保存入口的失败测试；旧的三行数量摘要不满足断言。
- [x] 将配置组织为可扫描的原生设置页，默认直接展示三类类型条目及维护入口；其他现有配置用紧凑导航访问，不删真实功能。
- [x] 核对工单规则、项目、附件路径、云同步、数据维护、模板、网络类型和型号保存仍使用原 API；原生手测覆盖类型树及网络类型目录保存，其他配置保存未逐项手测。

## 任务 3：三类资产 IP/网络分列与宽度

**文件：** `integrations/netcatty/cmdb/assetTableModel.js`、`integrations/netcatty/cmdb/assetTableModel.test.js`、`integrations/netcatty/cmdb/TerminalAssets.jsx`、`integrations/netcatty/cmdb/Infrastructure.jsx`、`integrations/netcatty/cmdb/Systems.jsx`、`integrations/netcatty/cmdb/ui.jsx`。

- [x] 先更新列顺序测试并运行，确认旧 `network` 合并键失败。
- [x] 终端将编码/SN 收纳进名称摘要，IP 与网络分别成列；云桌面两个 IP 与网络按相同顺序对应，完整 SN 在详情保留。
- [x] 基础设施保留管理 IP 后的快速连接，网络类型独立列；业务系统自身业务 IP 与网络类型独立列。
- [x] 检查详情不再把 IP 与网络串成一个字段，缺失网络显示“未配置”。
- [x] 验证 1440px 和 1024px 窗口宽度下 IP、网络、状态与操作可达；窄窗口采用紧凑列组，其余字段仍在详情及宽窗口中。

## 任务 4：装配和隔离验收

- [x] 运行相关 `node --test`、装配脚本测试、装配目标 lint 和 build；后端未改也运行 `go test ./...` 做回归。全仓 `tsc --noEmit` 仍有其他模块类型错误，不能计为通过。
- [x] 使用隔离数据库和 Netcatty 测试机逐页检查设置、终端、基础设施、业务系统；截图位于 `build/native-settings-preview/`，原生验收脚本为 `scripts/verify-native-settings-asset-ui.mjs`。
- [x] 同步 `使用说明.md` 中与入口、列组冲突的说明；不修改版本号、不提交、不发布、不改正式数据库。

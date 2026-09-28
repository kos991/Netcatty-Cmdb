# Cmdb 首批 P0 界面一致性修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除配置中心重复的资产配置入口，将历史台账同步迁入项目设置，并把基础设施“型号 / 系统”压缩为符合设备类型的一行展示。

**Architecture:** 沿用现有 Netcatty 原生 React、Tailwind、Radix UI、Lucide 和 `components/ui` 组件，不新增前端框架。配置中心继续使用既有 `api.syncInfrastructure()` 和后端幂等同步接口；基础设施列表通过一个纯展示模型决定厂商、型号和操作系统是否显示，列表层只负责单行渲染。

**Tech Stack:** React、JavaScript、Node.js `node:test`、Netcatty 原生 UI、Go + SQLite 既有 API。

**执行状态（2026-09-28）：** 任务 1-5 已完成自动化、装配构建和隔离测试机验收；后端未提供的同步前数量预览按计划保留为后续项，未伪造实现。

---

## 本轮需求清单

### 必须保留

- 设备资产中的终端资产、基础设施和业务系统三个子页面。
- 设备资产页头的新增、统一搜索、分类与分组管理及唯一普通刷新按钮。
- 基础设施的筛选、分页、导入、导出、模板、批量编辑、克隆、注销归档、详情工作区和 Netcatty 快速连接。
- 配置中心的工单编号规则、工单类别、运维类型、优先级、项目资料、附件路径和 Netcatty 云同步。
- 后端 `POST /api/cmdb/sync/legacy` 的当前项目隔离和幂等语义。

### 本轮新增

- 配置中心的一级分组只保留“工单配置”和“项目设置”。
- “项目设置”增加“数据维护”分区、影响说明、二次确认和真实同步结果。
- 基础设施列表的列名改为“型号 / 系统”，厂商型号与适用的系统信息严格单行。
- 服务器、虚拟机、云主机和超融合计算类可显示系统；交换机、路由器、安全设备和存储不在列表重复显示系统。

### 明确移除

- 配置中心的“资产配置”“资产字典”“扩展字段”“位置目录”“设备状态”“厂商与型号”入口。
- 基础设施工具栏的“同步旧台账”刷新图标。
- 基础设施列表中的 CPU、内存、硬盘和端口第二行摘要。

### 本轮不实施

- 同步前的新增、更新、冲突预估：现有后端只有执行接口，没有预览接口，本轮不得伪造。
- 五模块其余重构：组织拖拽、IPAM 真实关系、工单统计等按问题台账后续批次处理。
- 提交、推送、发布、版本号修改和正式安装目录修改。

## 文件范围

- 修改：`integrations/netcatty/cmdb/ConfigCenter.jsx`，精简配置中心并新增数据维护区。
- 修改：`integrations/netcatty/cmdb/Infrastructure.jsx`，删除重复同步入口并改为单行“型号 / 系统”。
- 修改：`integrations/netcatty/cmdb/deviceWorkspaceModel.js`，提供基础设施列表展示模型。
- 修改：`integrations/netcatty/cmdb/deviceWorkspaceModel.test.js`，验证各设备类型的列表展示规则。
- 修改：`scripts/prepare-netcatty.test.mjs`，验证装配产物的配置入口、历史同步位置和基础设施工具栏。
- 修改：`docs/cmdb-ui-issue-ledger.md`，只在自动化与隔离测试机验收后更新本批状态。

### 任务 1：先建立失败的展示模型测试

- [ ] **步骤 1：修改 `deviceWorkspaceModel.test.js` 的导入**

将 `infrastructureConfigurationSummary` 替换为 `infrastructureListPresentation`。

- [ ] **步骤 2：写入按设备类型判断的测试**

测试使用手工期望值：

```js
test('基础设施列表按设备类型生成单行型号和系统展示', () => {
  assert.deepEqual(infrastructureListPresentation({
    device_type: 'server', vendor: 'Lenovo', model: 'SR650 V3', os_type: 'Rocky Linux', os_version: '9.4',
  }), { vendor: 'Lenovo', model: 'SR650 V3', showOperatingSystem: true })
  assert.deepEqual(infrastructureListPresentation({
    device_type: 'virtual_machine', provider: 'VMware', model: 'VM', os_type: 'Ubuntu', os_version: '22.04',
  }), { vendor: 'VMware', model: 'VM', showOperatingSystem: true })
  for (const device_type of ['switch', 'router', 'security_device', 'storage']) {
    assert.deepEqual(infrastructureListPresentation({
      device_type, vendor: 'H3C', model: 'S6520X', os_type: 'Comware', os_version: '7',
    }), { vendor: 'H3C', model: 'S6520X', showOperatingSystem: false })
  }
})
```

- [ ] **步骤 3：运行测试并确认正确失败**

运行：

```powershell
node --test integrations/netcatty/cmdb/deviceWorkspaceModel.test.js
```

预期：因 `infrastructureListPresentation` 尚未导出而失败。

- [ ] **步骤 4：实现最小展示模型**

在 `deviceWorkspaceModel.js` 中实现：

```js
const INFRASTRUCTURE_TYPES_WITHOUT_LIST_OS = new Set(['switch', 'router', 'security_device', 'storage'])

export function infrastructureListPresentation(asset = {}) {
  const vendor = clean(asset.vendor) || clean(asset.provider)
  const model = clean(asset.model)
  const hasOperatingSystem = Boolean(clean(asset.os_type || asset.system_type) || clean(asset.os_version || asset.system_version))
  return {
    vendor,
    model,
    showOperatingSystem: hasOperatingSystem && !INFRASTRUCTURE_TYPES_WITHOUT_LIST_OS.has(clean(asset.device_type).toLowerCase()),
  }
}
```

- [ ] **步骤 5：重跑模型测试并确认通过**

运行同一步骤 3，预期全部通过。

### 任务 2：先建立失败的 Netcatty 装配约束

- [ ] **步骤 1：更新 `prepare-netcatty.test.mjs` 的配置中心断言**

替换旧的资产配置断言，要求装配后的配置中心：

```js
for (const retainedConfig of ['工单配置', '项目设置']) assert.match(configCenter, new RegExp(retainedConfig))
for (const removedConfig of ['资产配置', '资产字典', '扩展字段']) assert.doesNotMatch(configCenter, new RegExp(removedConfig))
assert.match(configCenter, /data-section="cmdb-data-maintenance"/)
assert.match(configCenter, /同步历史台账/)
assert.match(configCenter, /api\.syncInfrastructure/)
```

- [ ] **步骤 2：增加基础设施工具栏和列表断言**

```js
assert.doesNotMatch(infrastructure, /同步旧台账|api\.syncInfrastructure/)
assert.match(infrastructure, /label: '型号 \/ 系统'/)
assert.match(infrastructure, /data-infrastructure-technical-cell/)
```

- [ ] **步骤 3：运行装配测试并确认正确失败**

运行：

```powershell
node --test scripts/prepare-netcatty.test.mjs
```

预期：当前装配产物仍含资产配置、扩展字段和基础设施同步图标，断言失败。

### 任务 3：精简配置中心并迁移历史台账同步

- [ ] **步骤 1：删除资产配置专属代码**

从 `ConfigCenter.jsx` 删除资产配置分组、资产页签、资产字典、扩展字段、厂商型号字段和对应未使用导入；`specifications` 只由工单类别、运维类型和优先级构建。

- [ ] **步骤 2：在项目设置增加数据维护区**

新增 `confirmLegacySync` 和 `legacySyncResult` 状态，数据维护区使用：

```jsx
<section className="border-t border-border/70 px-5 py-5" data-section="cmdb-data-maintenance">
  <h3 className="text-sm font-medium">数据维护</h3>
  <p className="mt-1 text-xs text-muted-foreground">将当前项目的旧终端与基础设施台账幂等写入 Cmdb；已有映射会跳过。</p>
  <Button type="button" size="sm" variant="outline" onClick={() => setConfirmLegacySync(true)}>同步历史台账</Button>
</section>
```

确认后调用真实接口并展示 `org_inserted`、`asset_inserted`、`server_inserted`、`skipped`，成功后调用 `directoryChanged()` 让业务目录刷新。失败沿用 `useAction` 的真实错误提示，不关闭确认窗口。

- [ ] **步骤 3：保留两组配置导航**

`ConfigCenter` 默认打开工单配置；一级分组只渲染 `work` 和 `project`；只有工单配置显示第二级页签。

### 任务 4：实现基础设施单行“型号 / 系统”

- [ ] **步骤 1：增加单行单元格组件**

在 `Infrastructure.jsx` 内新增小组件，调用 `infrastructureListPresentation(record)`，用 `flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap` 同行渲染：

- 厂商图标和型号；
- 适用时显示 `/` 和紧凑操作系统单元格；
- 两者都为空时显示“未录入”。

- [ ] **步骤 2：替换中等和完整密度列**

两处列名统一为 `型号 / 系统`，两处都复用同一个单行组件，不再调用 `infrastructureConfigurationSummary`。

- [ ] **步骤 3：删除重复同步入口**

删除 `Infrastructure.jsx` 工具栏中的“同步旧台账”按钮及不再使用的 `RefreshCw`、`ActionIcon` 导入；保留导出、模板和导入。

- [ ] **步骤 4：重跑两组定向测试**

```powershell
node --test integrations/netcatty/cmdb/deviceWorkspaceModel.test.js
node --test scripts/prepare-netcatty.test.mjs
```

预期：全部通过。

### 任务 5：回归、装配和隔离测试机验收

- [ ] **步骤 1：运行 Cmdb 前端模型和装配测试**

```powershell
node --test integrations/netcatty/cmdb/*.test.js scripts/prepare-netcatty.test.mjs
```

预期：零失败；若 PowerShell 不展开通配符，则使用 `Get-ChildItem` 生成明确文件列表传给 `node --test`。

- [ ] **步骤 2：运行后端测试**

```powershell
go test ./...
```

预期：零失败。

- [ ] **步骤 3：装入既有 Netcatty 隔离测试目标**

先检查 `build/native-ui-preview` 的实际装配状态和运行进程；若目标已装配，只增量复制本轮修改的 Cmdb 文件，不重复执行装配脚本。不得修改 `C:\Users\Administrator\AppData\Local\Programs\Netcatty`。

- [ ] **步骤 4：在装配目标运行 lint、测试和构建**

命令以装配目标真实 `package.json` 为准，必须记录命令和完整退出状态，不能把未运行项目写成已验证。

- [ ] **步骤 5：启动隔离测试机并实际验收**

检查：

1. 配置中心只有工单配置和项目设置。
2. 项目设置能看到数据维护与“同步历史台账”。
3. 同步必须二次确认，并显示真实新增/跳过数量。
4. 基础设施工具栏不再有第二个刷新图标。
5. 服务器和虚拟机在一行显示型号与系统。
6. 交换机、路由器、安全设备、存储只显示厂商型号。
7. 设备资产页头普通刷新、分页、筛选、导入导出、详情和连接入口仍可用。

保存隔离测试机截图并记录窗口尺寸、控制台错误和页面溢出情况。

- [ ] **步骤 6：更新问题台账**

只有完成自动化和隔离测试机验收后，才把 `UI-001`、`UI-002`、`UI-003`、`UI-004`、`CONFIG-001`、`CONFIG-002` 改为“已验证”；没有实测的项目保持“待验证”。

## 验收边界

- 本计划不包含提交步骤：用户未授权提交，本轮只保留工作树修改。
- 本计划不包含发布步骤：本地隔离测试完成前禁止发布。
- 后端未提供同步预览，界面只陈述可证实的幂等影响并显示真实执行结果。

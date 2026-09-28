# Unified Device Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Netcatty 原生 Cmdb 中交付交换机、路由器、服务器统一设备工作区，补齐资产归属并完整保留现有运维能力。

**Architecture:** 新增共享 `DeviceWorkspace` 负责数据加载、固定标题栏、资产归属、宽度模式和公共栏目；设备类型面板只负责专属内容。端口快照先经过纯函数归一化，公共关联能力从原有详情和交换机页面收敛为一个可复用组件。

**Tech Stack:** React 18、Netcatty `components/ui`、Tailwind、Radix UI、Lucide、Node test runner、Electron CDP、Go + SQLite。

---

### Task 1: 修复端口快照崩溃并建立归一化边界

**Files:**
- Modify: `integrations/netcatty/cmdb/switchPortPanel.js`
- Modify: `integrations/netcatty/cmdb/switchPortPanel.test.js`
- Modify: `integrations/netcatty/cmdb/SwitchWorkspace.jsx`

- [x] **Step 1: 写入失败测试**

新增用例，输入 `allowedVlans: {}`、字符串和未知状态，断言输出始终为数组且状态落入已知集合：

```js
test('异常快照字段会归一化而不会传入组件', () => {
  const result = buildSwitchPortPanel([
    { name: 'GE1/0/1', allowedVlans: {}, status: 'mystery' },
    { name: 'GE1/0/2', allowedVlans: '10,20 30' },
  ], [])
  assert.deepEqual(result.ports[0].allowedVlans, [])
  assert.deepEqual(result.ports[1].allowedVlans, ['10', '20', '30'])
  assert.equal(result.ports[0].state, 'enabled')
})
```

- [x] **Step 2: 验证测试先失败**

Run: `node --test integrations/netcatty/cmdb/switchPortPanel.test.js`

Expected: FAIL，`allowedVlans` 仍为对象或字符串。

- [x] **Step 3: 实现最小归一化**

在 `buildSwitchPortPanel` 映射阶段加入：

```js
function normalizeStringList(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean)
  if (typeof value === 'string') return value.split(/[\s,]+/).filter(Boolean)
  return []
}
```

将每个端口的 `allowedVlans` 设置为 `normalizeStringList(item.allowedVlans)`，组件只对归一化结果调用 `.join()`；未知状态使用 `enabled` 视觉基线。

- [x] **Step 4: 验证测试通过**

Run: `node --test integrations/netcatty/cmdb/switchPortPanel.test.js integrations/netcatty/cmdb/switchConfig.test.js`

Expected: PASS，0 failures。

### Task 2: 建立共享设备工作区视图模型

**Files:**
- Create: `integrations/netcatty/cmdb/deviceWorkspaceModel.js`
- Create: `integrations/netcatty/cmdb/deviceWorkspaceModel.test.js`
- Read: `integrations/netcatty/cmdb/state.js`

- [ ] **Step 1: 写入设备类型和资产归属测试**

覆盖交换机、路由器、服务器/虚拟机分类，以及项目、组织、分组、负责人、机房机柜和 U 位的缺失值处理：

```js
test('生成稳定的资产归属和位置文本', () => {
  const model = buildDeviceWorkspaceModel({
    project_id: 3,
    org_name: '信息化处',
    group_name: '',
    owner: '张工',
    room: '核心机房',
    cabinet_name: 'A03',
    start_u: 18,
    height_u: 3,
    device_type: 'switch',
  }, { projectName: '常州中院' })
  assert.equal(model.kind, 'switch')
  assert.equal(model.ownership.project, '常州中院')
  assert.equal(model.ownership.group, '未分配')
  assert.equal(model.ownership.location, '核心机房 · A03 · 18-20U')
})
```

- [ ] **Step 2: 验证测试先失败**

Run: `node --test integrations/netcatty/cmdb/deviceWorkspaceModel.test.js`

Expected: FAIL，模块尚不存在。

- [ ] **Step 3: 实现纯视图模型**

导出 `resolveDeviceKind(asset)`、`buildOwnership(asset, context)` 和 `buildDeviceWorkspaceModel(asset, context)`；项目名称优先取当前项目上下文，缺失时使用 `项目 #${project_id}`，不制造名称。

- [ ] **Step 4: 验证测试通过**

Run: `node --test integrations/netcatty/cmdb/deviceWorkspaceModel.test.js`

Expected: PASS。

### Task 3: 创建统一标题栏、资产归属条和宽度控制

**Files:**
- Create: `integrations/netcatty/cmdb/DeviceWorkspace.jsx`
- Create: `integrations/netcatty/cmdb/DeviceOwnershipBar.jsx`
- Modify: `integrations/netcatty/cmdb/Infrastructure.jsx`
- Modify: `integrations/netcatty/cmdb/DeviceAssets.jsx`

- [ ] **Step 1: 为装配脚本增加失败断言**

在 `scripts/prepare-netcatty.test.mjs` 断言 `DeviceWorkspace.jsx`、`DeviceOwnershipBar.jsx` 会被复制到 Netcatty 目标，并断言 `Infrastructure.jsx` 不再分别渲染 `DetailSheet` 与交换机 `AsidePanel`。

- [ ] **Step 2: 运行装配测试确认失败**

Run: `node --test scripts/prepare-netcatty.test.mjs`

Expected: FAIL，新组件尚未装配。

- [ ] **Step 3: 实现共享外壳**

`DeviceWorkspace` 统一加载 `api.infrastructureAsset(id)`，渲染：

```jsx
<DeviceWorkspaceHeader
  asset={detail.asset}
  kind={model.kind}
  expanded={expanded}
  onExpandedChange={setExpanded}
  onEdit={onEdit}
  onClone={onClone}
  onArchive={onArchive}
/>
<DeviceOwnershipBar ownership={model.ownership} asset={detail.asset} />
<DeviceWorkspaceBody detail={detail} kind={model.kind} />
```

`Infrastructure.jsx` 改为单一 `selectedDeviceID`；所有设备均打开同一个 `AsidePanel`。宽度仅由 `expanded ? 'w-full' : 'w-1/2'` 控制，左侧列表筛选和分页状态保留。

- [ ] **Step 4: 更新装配清单并验证**

Run: `node --test scripts/prepare-netcatty.test.mjs`

Expected: PASS。

### Task 4: 收敛公共关联能力

**Files:**
- Create: `integrations/netcatty/cmdb/DeviceRelations.jsx`
- Modify: `integrations/netcatty/cmdb/DeviceWorkspace.jsx`
- Modify: `integrations/netcatty/cmdb/Infrastructure.jsx`
- Reuse: `integrations/netcatty/cmdb/NetcattyLinks.jsx`

- [ ] **Step 1: 建立公共栏目行为清单**

在 CDP 验收脚本中先声明以下必须存在的 `data-section`：

```js
const required = [
  'device-network-relations',
  'device-netcatty-links',
  'device-asset-history',
  'device-asset-profile',
]
```

首次运行应报告这些区域缺失。

- [ ] **Step 2: 实现 `DeviceRelations`**

迁移且只保留一份以下逻辑：上下联链路列表、添加链路表单、删除确认、IPAM、网络接口、NetcattyLinks 和变更履历。`onOpenAsset`、`onOpenIP`、`onOpenApplication` 继续从工作区向上传递，不改现有联动协议。

- [ ] **Step 3: 验证三类设备均可到达公共栏目**

对样例交换机、路由器和服务器逐个打开，断言四个 `data-section` 均存在，链路和 IPAM 真实数据正常渲染。

### Task 5: 迁移交换机专属运维区

**Files:**
- Modify: `integrations/netcatty/cmdb/SwitchWorkspace.jsx`
- Modify: `integrations/netcatty/cmdb/DeviceWorkspace.jsx`
- Modify: `integrations/netcatty/cmdb/switchPortPanel.js`

- [ ] **Step 1: 将交换机验收条件写入 CDP 脚本**

断言配置摘要包含设备名、型号、系统版本、管理地址、读取协议、管理 VLAN、聚合组、端口统计和最后读取时间；端口面板默认可见；安全与访问可一次展开。

- [ ] **Step 2: 将 `SwitchWorkspace` 改为专属内容组件**

移除重复标题栏和公共关联逻辑，接收 `detail`、`onReadConfig`、`onAddLinkForPort`。端口选中后显示“添加链路”，调用时将 `local_port` 预填为 `selected.name`。

- [ ] **Step 3: 合并安全信息层级**

使用一个“安全与访问”可展开区域承载 ACL、设备账号、SSH/Telnet 和 SNMP；内部允许标签切换，但父级只占一个工作区入口。

- [ ] **Step 4: 验证配置读取和异常数据**

使用录制快照打开端口、切换安全栏目和读取配置；断言运行时异常为 0，原始快照不包含明文凭证。

### Task 6: 实现路由器和服务器专属模块

**Files:**
- Create: `integrations/netcatty/cmdb/RouterOperations.jsx`
- Create: `integrations/netcatty/cmdb/ServerOperations.jsx`
- Modify: `integrations/netcatty/cmdb/DeviceWorkspace.jsx`

- [ ] **Step 1: 写入纯模型测试**

为路由器接口角色分组和服务器规格格式化增加测试；未提供 WAN/LAN 角色时按网络区域和主接口展示，不猜测接口用途。

- [ ] **Step 2: 实现路由器主视图**

展示真实 `interfaces`、`ipam` 和 `links` 摘要，主操作使用 Netcatty 连接。不得出现路由表、NAT、VPN 或配置备份占位区。

- [ ] **Step 3: 实现服务器主视图**

默认展示 `related_applications`；规格区使用 `cpu_info`、`vcpu`、`memory_mb`、`disk_info`、`os_type`、`os_version`、`mgmt_url`。业务系统点击继续调用 `onOpenApplication`。

- [ ] **Step 4: 验证设备类型切换**

连续打开交换机、路由器、服务器，断言标题栏和归属条位置不变，专属主视图正确切换且临时选择状态已重置。

### Task 7: 加入局部错误边界和响应式验收

**Files:**
- Create: `integrations/netcatty/cmdb/DeviceWorkspaceErrorBoundary.jsx`
- Modify: `integrations/netcatty/cmdb/DeviceWorkspace.jsx`
- Create: `build/native-ui-preview/verify-device-workspace.cjs`

- [ ] **Step 1: 实现局部错误边界**

错误边界只包裹设备工作区内容，显示错误摘要、重试和关闭按钮；错误仍记录到控制台，不能返回伪造空数据。

- [ ] **Step 2: 编写 Electron CDP 验收脚本**

脚本需覆盖：半屏、最大化、还原、三类设备、端口点击、安全展开、公共栏目、对端设备穿透、关闭后筛选/页码保持，以及 1366x768 设备指标覆盖。

- [ ] **Step 3: 执行原生验证**

Run: `node build/native-ui-preview/verify-device-workspace.cjs`

Expected: 页面级横向溢出为 0、运行时异常为 0、所有断言为 true，并生成三类设备截图。

### Task 8: 完整回归和本地测试机交付

**Files:**
- Verify only; do not publish or modify the installed Netcatty directory.

- [ ] **Step 1: 运行前端纯函数和装配测试**

Run: `node --test integrations/netcatty/cmdb/deviceWorkspaceModel.test.js integrations/netcatty/cmdb/switchPortPanel.test.js integrations/netcatty/cmdb/switchConfig.test.js scripts/prepare-netcatty.test.mjs`

Expected: PASS，0 failures。

- [ ] **Step 2: 装配并检查代码**

Run: `node scripts/prepare-netcatty.mjs <本地Netcatty源码目录> build/netcatty-native-ui`

Run from `build/netcatty-native-ui`: `node_modules/.bin/eslint.cmd components/cmdb/DeviceWorkspace.jsx components/cmdb/DeviceOwnershipBar.jsx components/cmdb/DeviceRelations.jsx components/cmdb/SwitchWorkspace.jsx components/cmdb/RouterOperations.jsx components/cmdb/ServerOperations.jsx`

Expected: ESLint exit 0。

- [ ] **Step 3: 构建 Netcatty 原生前端**

Run from `build/netcatty-native-ui`: `npm.cmd run build`

Expected: Vite build exit 0。

- [ ] **Step 4: 运行后端回归**

Run: `go test ./...`

Expected: PASS。

- [ ] **Step 5: 冷启动隔离测试机并执行 CDP 验收**

使用 `build/native-ui-preview/assets.db` 和 `9224/18082`，不得指向正式安装数据；测试完成后停在交换机统一工作区供用户查看。

- [ ] **Step 6: 检查差异**

Run: `git diff --check -- integrations/netcatty/cmdb scripts/prepare-netcatty.mjs scripts/prepare-netcatty.test.mjs`

Expected: 无 whitespace errors；不提交、不发布、不 bump 版本。

import assert from 'node:assert/strict'
import test from 'node:test'
import * as state from './state.js'
const { customFieldDefinitions, formatLocalDateTimeInput, infrastructureDeviceTypeOptions, infrastructureFieldProfile, infrastructureGroupFilterOptions, infrastructureListFilterParams, infrastructureTypeFilterOptions, ipAddressPresentation, isApplicationHostInfrastructure, isServerInfrastructure, netcattyDirectorySummaries, normalizeAsset, normalizeWorkOrderFilters, quickConnectControlPresentation, resolveSearchTarget, terminalSerialProfile } = state
import { requestJson, importFile, exportFile, nativeStatus } from './transport.js'

test('普通设备清除物理终端 IP，云桌面保留双 IP 和网络类型', () => {
  const values = { device_type: '台式电脑', box_sn: 'PC-SN-1', display_sn: 'DISPLAY-OLD', ip: '192.0.2.1', terminal_ip: '192.0.2.2', net_type: '内网', remark: '保持原资料' }
  assert.deepEqual(normalizeAsset(values), { ...values, display_sn: '', terminal_ip: '' })
  assert.equal(values.terminal_ip, '192.0.2.2')
  assert.deepEqual(normalizeAsset({ ...values, device_type: '云桌面盒子' }), { ...values, device_type: '云桌面盒子' })
})

test('终端序列号按云桌面和普通物理终端使用不同标签', () => {
  assert.deepEqual(terminalSerialProfile({ device_type: '云桌面盒子', box_sn: 'BOX-1', display_sn: 'DISPLAY-1' }), {
    cloud: true, primaryLabel: '终端主机 SN', primaryValue: 'BOX-1', secondaryLabel: '显示器 SN', secondaryValue: 'DISPLAY-1',
  })
  assert.deepEqual(terminalSerialProfile({ device_type: '台式电脑', box_sn: 'PC-1', display_sn: 'OLD' }), {
    cloud: false, primaryLabel: '设备 SN', primaryValue: 'PC-1', secondaryLabel: '', secondaryValue: '',
  })
})

test('IP 方格明确识别网络地址和广播地址且均不可分配', () => {
  assert.deepEqual(ipAddressPresentation({ status: '网络地址' }), { kind: 'special', label: '网络地址（不可分配）' })
  assert.deepEqual(ipAddressPresentation({ status: '广播地址' }), { kind: 'special', label: '广播地址（不可分配）' })
  assert.deepEqual(ipAddressPresentation({ status: '在用', owner_type: 'terminal' }), { kind: 'used', label: '已占用' })
  assert.deepEqual(ipAddressPresentation({ status: '空闲' }), { kind: 'free', label: '空闲' })
})

test('未知设备类型保持未分类并保留历史数据，不自动臆造云桌面分类', () => {
  assert.deepEqual(normalizeAsset({ device_type: '', terminal_ip: '192.0.2.2' }), { device_type: '', terminal_ip: '192.0.2.2' })
})

test('关联导航落到准确的资产子页，保留原始记录 ID', () => {
  const result = { tableKey: 'server_apps', id: 42 }
  assert.deepEqual(resolveSearchTarget(result), { module: 'assets', assetTab: 'systems', focusTarget: result })
  assert.equal(resolveSearchTarget({ tableKey: 'unknown' }), null)
})

test('工单发生时间使用本地时间，日期筛选转换为完整边界', () => {
  assert.equal(formatLocalDateTimeInput(new Date(2026, 8, 21, 14, 45, 9)), '2026-09-21T14:45')
  assert.deepEqual(normalizeWorkOrderFilters({ date_from: '2026-09-01', date_to: '2026-09-21', owner: ' 张三 ' }), {
    date_from: '2026-09-01 00:00:00',
    date_to: '2026-09-21 23:59:59',
    owner: '张三',
  })
})

test('工单工作区的单日、区间和全部日期共用查询与导出条件', () => {
  const filters = { keyword: ' 交换机 ', status: '处理中', asset_keyword: ' 核心 ' }
  assert.deepEqual(state.workOrderDeskFilters(filters, { mode: 'day', day: '2026-09-24' }), {
    keyword: '交换机', status: '处理中', asset_keyword: '核心',
    date_from: '2026-09-24 00:00:00', date_to: '2026-09-24 23:59:59',
  })
  assert.deepEqual(state.workOrderDeskFilters(filters, { mode: 'range', from: '2026-09-01', to: '2026-09-24' }), {
    keyword: '交换机', status: '处理中', asset_keyword: '核心',
    date_from: '2026-09-01 00:00:00', date_to: '2026-09-24 23:59:59',
  })
  assert.deepEqual(state.workOrderDeskFilters(filters, { mode: 'all' }), {
    keyword: '交换机', status: '处理中', asset_keyword: '核心',
  })
})

test('工单日期前后切换正确跨月和闰日', () => {
  assert.equal(state.shiftWorkOrderDate('2024-03-01', -1), '2024-02-29')
  assert.equal(state.shiftWorkOrderDate('2026-09-30', 1), '2026-10-01')
})

test('基础设施字段按设备类型显示，网络设备不出现主机硬件字段', () => {
  assert.deepEqual(infrastructureFieldProfile('物理服务器'), {
    kind: 'server', brandModel: true, cpu: true, memory: true, disk: true, os: true, provider: true, deviceMac: true, virtualCompute: false, systemSection: '硬件与系统',
  })
  assert.deepEqual(infrastructureFieldProfile('交换机'), {
    kind: 'network', brandModel: true, cpu: false, memory: false, disk: false, os: false, provider: true, deviceMac: false, virtualCompute: false, systemSection: '',
  })
  assert.deepEqual(infrastructureFieldProfile('虚拟机'), {
    kind: 'virtual', brandModel: false, cpu: false, memory: true, disk: true, os: true, provider: true, deviceMac: false, virtualCompute: true, systemSection: '计算与系统',
  })
  assert.equal(infrastructureFieldProfile('超融合节点').cpu, true)
  assert.equal(infrastructureFieldProfile('云桌面平台').provider, true)
})

test('实体基础设施可上传照片，虚拟资产不显示照片入口', () => {
  assert.equal(state.supportsInfrastructurePhotos({ device_type: 'switch', asset_class: 'physical' }), true)
  assert.equal(state.supportsInfrastructurePhotos({ category_name: '物理服务器', asset_class: 'physical' }), true)
  assert.equal(state.supportsInfrastructurePhotos({ category_name: '虚拟机', asset_class: 'physical' }), false)
  assert.equal(state.supportsInfrastructurePhotos({ device_type: 'server', asset_class: 'virtual' }), false)
})

test('业务系统承载对象只允许服务器类基础设施', () => {
  assert.equal(isServerInfrastructure({ device_type: 'server' }), true)
  assert.equal(isServerInfrastructure({ category_name: '物理服务器' }), true)
  assert.equal(isServerInfrastructure({ category_name: '虚拟机' }), true)
  assert.equal(isServerInfrastructure({ category_name: '交换机' }), false)
  assert.equal(isServerInfrastructure({ category_name: '路由器' }), false)
  assert.equal(isServerInfrastructure({ category_name: '存储设备' }), false)
})

test('业务系统承载对象来自基础设施并排除交换机和路由器', () => {
  assert.equal(isApplicationHostInfrastructure({ device_type: 'server' }), true)
  assert.equal(isApplicationHostInfrastructure({ category_name: '虚拟机' }), true)
  assert.equal(isApplicationHostInfrastructure({ category_name: '存储设备' }), true)
  assert.equal(isApplicationHostInfrastructure({ category_name: '安全设备' }), true)
  assert.equal(isApplicationHostInfrastructure({ category_name: '交换机' }), false)
  assert.equal(isApplicationHostInfrastructure({ device_type: 'router' }), false)
})

test('基础设施编辑保留尚未纳入字典的历史设备类型', () => {
  const configured = [{ id: 7, name: '服务器' }]
  assert.deepEqual(infrastructureDeviceTypeOptions(configured, { category_id: 0, device_type: 'switch' }), [
    { value: 0, label: '交换机' },
    { value: 7, label: '服务器' },
  ])
  assert.deepEqual(infrastructureDeviceTypeOptions(configured, { category_id: 7, device_type: 'server' }), [
    { value: 7, label: '服务器' },
  ])
})

test('基础设施设备类型筛选合并配置分类与历史类型且不重复', () => {
  assert.deepEqual(infrastructureTypeFilterOptions([
    { id: 4, name: '服务器' },
    { id: 7, name: '交换机' },
  ], ['server', 'switch', 'router', 'security_device']), [
    { value: 'category:4|type:server', label: '服务器' },
    { value: 'category:7|type:switch', label: '交换机' },
    { value: 'type:router', label: '路由器' },
    { value: 'type:security_device', label: '安全设备' },
  ])
})

test('基础设施列表和导出共用设备类型筛选参数并保留未分组条件', () => {
  assert.deepEqual(infrastructureListFilterParams({ type_filter: 'category:7|type:switch', group_id: '-1', status: '在库' }), {
    category_id: 7,
    device_type: 'switch',
    group_id: '-1',
    status: '在库',
  })
  assert.deepEqual(infrastructureListFilterParams({ type_filter: 'type:router', group_id: '' }), {
    device_type: 'router',
    group_id: '',
  })
  assert.deepEqual(infrastructureGroupFilterOptions([{ id: 3, name: '网络设备' }]), [
    { value: '', label: '全部资产分组' },
    { value: -1, label: '未分组' },
    { value: 3, label: '网络设备' },
  ])
})

test('快速连接入口显示动作文字而不是无含义方块', () => {
  assert.deepEqual(quickConnectControlPresentation({ name: '核心交换机', id: 9 }), {
    label: '连接',
    ariaLabel: '快速连接主机：核心交换机',
  })
})

test('配置中心扩展字段转换为资产抽屉字段且保持嵌套存储', () => {
  assert.deepEqual(customFieldDefinitions([
    { field_key: 'license_no', field_name: '授权编号', field_type: 'text', required: 1, asset_class: 'all' },
    { field_key: 'support_level', field_name: '支持级别', field_type: 'select', options: ['标准', '高级'], asset_class: 'virtual' },
    { field_key: 'ignored', field_name: '物理字段', field_type: 'number', asset_class: 'physical' },
  ], 'virtual'), [
    { key: 'license_no', label: '授权编号', type: 'text', required: true, custom: true },
    { key: 'support_level', label: '支持级别', type: undefined, required: false, custom: true, options: ['标准', '高级'] },
  ])
})

test('Netcatty 主机和钥匙串进入 Cmdb 前移除全部秘密字段', () => {
  const result = netcattyDirectorySummaries({
    hosts: [{ id: 'h1', label: '交换机', hostname: '10.0.0.1', port: 22, protocol: 'ssh', identityId: 'i1', os: 'linux', distro: 'huawei', distroMode: 'auto', manualDistro: 'h3c', deviceType: 'network', password: 'secret', telnetPassword: 'secret-2' }],
    identities: [{ id: 'i1', label: '网络账号', username: 'admin', authMethod: 'password', password: 'secret' }],
    keys: [{ id: 'k1', label: '运维密钥', type: 'ED25519', privateKey: 'PRIVATE', passphrase: 'secret' }],
  })
  assert.deepEqual(result.hosts, [{ id: 'h1', label: '交换机', hostname: '10.0.0.1', port: 22, protocol: 'ssh', credentialId: 'i1', os: 'linux', distro: 'huawei', distroMode: 'auto', manualDistro: 'h3c', deviceType: 'network' }])
  assert.deepEqual(result.credentials, [
    { id: 'i1', label: '网络账号', type: 'password', kind: 'identity', username: 'admin' },
    { id: 'k1', label: '运维密钥', type: 'ED25519', kind: 'key', username: '' },
  ])
  assert.doesNotMatch(JSON.stringify(result), /secret|PRIVATE/)
})

test('原生通道失败明确报错，导入提交保留预览令牌，导出保留取消状态', async () => {
  const previous = globalThis.window
  try {
    globalThis.window = {}
    await assert.rejects(requestJson('/api/assets'), /原生请求通道不可用/)
    await assert.rejects(nativeStatus(), /原生状态通道不可用/)
    let imported
    globalThis.window = { netcatty: {
      cmdbStatus: async () => ({ available: false, error: '数据库打开失败' }),
      cmdbRequest: async () => { throw new Error('服务断开') },
      cmdbImportFile: async (payload) => { imported = payload; return { created: 2 } },
      cmdbExportFile: async () => ({ cancelled: true }),
    } }
    await assert.rejects(nativeStatus(), /数据库打开失败/)
    await assert.rejects(requestJson('/api/assets'), /服务断开/)
    assert.deepEqual(await importFile('/api/cmdb/assets/import', { commit: true, token: 'preview-token' }), { created: 2 })
    assert.deepEqual(imported, { path: '/api/cmdb/assets/import', commit: true, token: 'preview-token' })
    assert.deepEqual(await exportFile('/api/export/assets', 'assets.xlsx'), { cancelled: true })
  } finally { if (previous === undefined) delete globalThis.window; else globalThis.window = previous }
})

import test from 'node:test'
import assert from 'node:assert/strict'
import * as deviceModel from './deviceWorkspaceModel.js'

const { buildDeviceWorkspaceModel, buildLinkedHostByAssetID, formatMemory, infrastructureListPresentation, operatingSystemTypeFromDetectedHost, resolveDeviceKind, resolveOperatingSystemPresentation } = deviceModel

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
  assert.equal(model.ownership.organization, '信息化处')
  assert.equal(model.ownership.group, '未分配')
  assert.equal(model.ownership.owner, '张工')
  assert.equal(model.ownership.location, '核心机房')
  assert.equal(model.ownership.cabinet, 'A03 · 18-20U')
})

test('缺少项目名称和归属字段时显示可核对的回退值', () => {
  const model = buildDeviceWorkspaceModel({ project_id: 7, device_type: 'router' })

  assert.equal(model.kind, 'router')
  assert.equal(model.ownership.project, '项目 #7')
  assert.equal(model.ownership.organization, '未分配')
  assert.equal(model.ownership.owner, '未分配')
  assert.equal(model.ownership.location, '未分配')
  assert.equal(model.ownership.cabinet, '')
})

test('识别服务器和虚拟机并格式化内存', () => {
  assert.equal(resolveDeviceKind({ device_type: 'server' }), 'server')
  assert.equal(resolveDeviceKind({ device_type: 'virtual_machine' }), 'server')
  assert.equal(resolveDeviceKind({ category_name: '物理服务器' }), 'server')
  assert.equal(formatMemory(32768), '32 GB')
  assert.equal(formatMemory(0), '-')
})

test('路由器接口只使用真实角色、网络区域或主接口标记', () => {
  assert.equal(typeof deviceModel.buildRouterInterfaceRows, 'function')
  const rows = deviceModel.buildRouterInterfaceRows([
    { name: 'GE0/0', ip: '10.0.0.1', role: 'WAN' },
    { name: 'GE0/1', ip: '172.16.0.1', network_zone: '政务外网' },
    { name: 'GE0/2', ip: '192.168.0.1', is_primary: true },
    { name: 'GE0/3', ip: '' },
  ])

  assert.deepEqual(rows.map((item) => item.role), ['WAN', '政务外网', '主接口', '未标注'])
  assert.deepEqual(rows.map((item) => item.name), ['GE0/0', 'GE0/1', 'GE0/2', 'GE0/3'])
})

test('服务器规格使用现有字段生成稳定摘要', () => {
  assert.equal(typeof deviceModel.buildServerSpecification, 'function')
  assert.deepEqual(deviceModel.buildServerSpecification({
    cpu_info: 'Xeon Silver 4310',
    vcpu: 24,
    memory_mb: 65536,
    disk_info: '2 x 1.92TB SSD',
    os_type: 'Rocky Linux',
    os_version: '9.4',
    mgmt_url: 'https://10.20.30.40:9090',
  }), {
    cpu: 'Xeon Silver 4310 · 24 vCPU',
    memory: '64 GB',
    disk: '2 x 1.92TB SSD',
    os: 'Rocky Linux 9.4',
    management: 'https://10.20.30.40:9090',
  })
})

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
  assert.deepEqual(infrastructureListPresentation({
    device_type: 'server', cpu_info: '2 x Xeon', memory_mb: 65536, disk_info: '4 x SSD',
  }), { vendor: '', model: '', showOperatingSystem: false })
})

test('操作系统类型和版本合并为一个可展示对象', () => {
  assert.deepEqual(resolveOperatingSystemPresentation({ os_type: 'Windows Server', os_version: '2022' }), {
    distro: 'windows',
    name: 'Windows Server',
    version: '2022',
    label: 'Windows Server 2022',
  })
  assert.deepEqual(resolveOperatingSystemPresentation({ os_type: 'CentOS Linux', os_version: '7.9' }), {
    distro: 'centos',
    name: 'CentOS Linux',
    version: '7.9',
    label: 'CentOS Linux 7.9',
  })
})

test('国产操作系统使用独立图标标识并保留具体版本', () => {
  const cases = [
    [{ os_type: '银河麒麟', os_version: 'V10 SP3' }, 'kylin'],
    [{ os_type: '统信 UOS Server', os_version: '20' }, 'uos'],
    [{ os_type: 'openEuler', os_version: '22.03 LTS' }, 'openeuler'],
    [{ os_type: '龙蜥 Anolis OS', os_version: '8.8' }, 'alinux'],
    [{ os_type: '中科方德', os_version: '4.0' }, 'fangde'],
  ]
  for (const [asset, distro] of cases) {
    assert.equal(resolveOperatingSystemPresentation(asset).distro, distro)
    assert.match(resolveOperatingSystemPresentation(asset).label, new RegExp(asset.os_version.replace('.', '\\.')))
  }
})

test('网络设备按厂商映射原生图标，未识别数据不臆造版本', () => {
  assert.deepEqual(resolveOperatingSystemPresentation({ device_type: 'switch', vendor: '华为', os_type: 'VRP', os_version: 'V200R022' }), {
    distro: 'huawei',
    name: 'VRP',
    version: 'V200R022',
    label: 'VRP V200R022',
  })
  assert.deepEqual(resolveOperatingSystemPresentation({ device_type: 'switch', vendor: 'H3C' }), {
    distro: 'h3c',
    name: 'H3C 网络设备',
    version: '',
    label: 'H3C 网络设备',
  })
  assert.deepEqual(resolveOperatingSystemPresentation({}), {
    distro: 'unknown',
    name: '未识别',
    version: '',
    label: '未识别',
  })
})

test('安全设备系统未匹配发行版时使用安全设备专用图标', () => {
  assert.deepEqual(resolveOperatingSystemPresentation({ device_type: 'security_device', vendor: 'Sangfor', os_type: 'AFOS', os_version: '8.0' }), {
    distro: 'sangfor',
    name: 'AFOS',
    version: '8.0',
    label: 'AFOS 8.0',
  })
  assert.deepEqual(resolveOperatingSystemPresentation({ device_type: 'security_device', vendor: '山石网科' }), {
    distro: 'hillstone',
    name: '山石 安全设备',
    version: '',
    label: '山石 安全设备',
  })
  assert.equal(resolveOperatingSystemPresentation({ device_type: 'security_device', os_type: 'StoneOS' }).distro, 'hillstone')
  assert.equal(resolveOperatingSystemPresentation({ device_type: 'security_device', vendor: '深信服' }).distro, 'sangfor')
})

test('常见安全厂商使用各自图标标识', () => {
  const cases = [
    ['绿盟科技', 'nsfocus'],
    ['天融信', 'topsec'],
    ['启明星辰', 'venustech'],
    ['奇安信', 'qianxin'],
    ['迪普科技', 'dptech'],
    ['Check Point', 'checkpoint'],
    ['Sophos', 'sophos'],
    ['SonicWall', 'sonicwall'],
    ['Fortinet', 'fortinet'],
    ['Palo Alto Networks', 'paloalto'],
  ]
  for (const [vendor, distro] of cases) {
    assert.equal(resolveOperatingSystemPresentation({ device_type: 'security_device', vendor }).distro, distro)
  }
  assert.equal(resolveOperatingSystemPresentation({ device_type: 'security_device', vendor: '未收录厂商' }).distro, 'security')
})

test('存储设备按厂商和存储系统映射专用图标', () => {
  const cases = [
    [{ device_type: 'storage', vendor: 'Huawei', model: 'OceanStor 5310', os_type: 'StorageOS' }, 'huawei'],
    [{ device_type: 'storage', vendor: 'Dell EMC', model: 'PowerStore 1200T' }, 'dellemc'],
    [{ device_type: 'storage', vendor: 'NetApp', os_type: 'ONTAP' }, 'netapp'],
    [{ device_type: 'storage', vendor: 'IBM', model: 'FlashSystem 5200' }, 'ibm'],
    [{ device_type: 'storage', vendor: 'HPE', model: 'Alletra 6000' }, 'hpe'],
    [{ device_type: 'storage', vendor: 'Lenovo', model: 'DE4000H' }, 'lenovo'],
    [{ device_type: 'storage', vendor: '浪潮', model: 'AS5500G5' }, 'inspur'],
    [{ device_type: 'storage', vendor: 'Synology', os_type: 'DSM' }, 'synology'],
    [{ device_type: 'storage', vendor: 'QNAP', os_type: 'QuTS hero' }, 'qnap'],
    [{ device_type: 'storage', vendor: 'Pure Storage', os_type: 'Purity' }, 'purestorage'],
  ]
  for (const [asset, distro] of cases) {
    assert.equal(resolveOperatingSystemPresentation(asset).distro, distro)
  }
  assert.deepEqual(resolveOperatingSystemPresentation({ device_type: 'storage', vendor: '未收录厂商' }), {
    distro: 'storage',
    name: '存储设备',
    version: '',
    label: '存储设备',
  })
})

test('终端资产只使用真实关联主机的系统识别结果', () => {
  assert.deepEqual(resolveOperatingSystemPresentation({}, { distro: 'ubuntu', os: 'linux' }), {
    distro: 'ubuntu',
    name: 'Ubuntu',
    version: '',
    label: 'Ubuntu',
  })
  assert.equal(resolveOperatingSystemPresentation({}, { os: 'linux' }).label, '未识别')
  assert.equal(resolveOperatingSystemPresentation({}, null).label, '未识别')
})

test('终端系统自动回填只接受真实发行版且不覆盖台账值', () => {
  assert.equal(operatingSystemTypeFromDetectedHost({ distro: 'ubuntu', os: 'linux' }), 'Ubuntu')
  assert.equal(operatingSystemTypeFromDetectedHost({ distro: 'openeuler', os: 'linux' }), 'openEuler')
  assert.equal(operatingSystemTypeFromDetectedHost({ os: 'linux' }), '')
  assert.equal(operatingSystemTypeFromDetectedHost({ distro: '', os: 'windows' }), '')
  assert.equal(operatingSystemTypeFromDetectedHost({ distro: 'ubuntu' }, { os_type: '银河麒麟' }), '')
})

test('终端资产按主关联找到 Netcatty 主机系统信息', () => {
  const lookup = buildLinkedHostByAssetID([
    { asset_id: 8, host_id: 'secondary', is_primary: false },
    { asset_id: 8, host_id: 'primary', is_primary: true },
    { asset_id: 9, credential_id: 'credential-only', is_primary: true },
  ], [
    { id: 'secondary', distro: 'debian' },
    { id: 'primary', distro: 'openeuler' },
  ])
  assert.equal(lookup.get(8)?.id, 'primary')
  assert.equal(lookup.has(9), false)
})

test('网络与关联使用独立页签且实体设备照片保持独立', () => {
  assert.equal(typeof deviceModel.buildDeviceWorkspaceTabs, 'function')

  assert.deepEqual(deviceModel.buildDeviceWorkspaceTabs('switch'), {
    defaultTab: 'operations',
    tabs: [
      { key: 'overview', label: '概览' },
      { key: 'operations', label: '端口与配置' },
      { key: 'network', label: '网络' },
      { key: 'relations', label: '关联' },
      { key: 'records', label: '履历档案' },
      { key: 'photos', label: '设备照片' },
    ],
  })
  assert.deepEqual(deviceModel.buildDeviceWorkspaceTabs('router'), {
    defaultTab: 'operations',
    tabs: [
      { key: 'overview', label: '概览' },
      { key: 'operations', label: '接口运行' },
      { key: 'network', label: '网络' },
      { key: 'relations', label: '关联' },
      { key: 'records', label: '履历档案' },
      { key: 'photos', label: '设备照片' },
    ],
  })
  assert.deepEqual(deviceModel.buildDeviceWorkspaceTabs('server'), {
    defaultTab: 'overview',
    tabs: [
      { key: 'overview', label: '概览' },
      { key: 'operations', label: '硬件与业务' },
      { key: 'network', label: '网络' },
      { key: 'relations', label: '关联' },
      { key: 'records', label: '履历档案' },
      { key: 'photos', label: '设备照片' },
    ],
  })
  assert.deepEqual(deviceModel.buildDeviceWorkspaceTabs('server', false).tabs.map((tab) => tab.key), ['overview', 'operations', 'network', 'relations', 'records'])
})

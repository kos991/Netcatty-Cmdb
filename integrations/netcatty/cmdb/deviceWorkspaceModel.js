const missing = (value) => String(value || '').trim() || '未分配'

export function terminalOwnerPresentation(asset = {}) {
  const label = String(asset.user_name || '').trim() || '公用 / 闲置'
  const room = String(asset.room || '').trim()
  return { label, room, editable: Boolean(asset.id) }
}

export function resolveDeviceKind(asset = {}) {
  const type = [asset.device_type, asset.category_name, asset.asset_class].filter(Boolean).join(' ').toLowerCase()
  if (/switch|交换机/.test(type)) return 'switch'
  if (/router|路由器/.test(type)) return 'router'
  if (/server|服务器|物理主机|virtual_machine|虚拟机|云主机|云资源|ecs|超融合|hyperconverged|hci/.test(type)) return 'server'
  if (!asset.device_type && !asset.category_name && asset.source_type === 'legacy_server') return 'server'
  return 'generic'
}

export function deviceTypeLabel(asset = {}) {
  const labels = { server: '服务器', virtual_machine: '虚拟机', switch: '交换机', router: '路由器', security_device: '安全设备', storage: '存储设备', hyperconverged: '超融合', cloud_desktop: '云桌面' }
  return labels[asset.device_type] || asset.device_type || asset.category_name || (asset.source_type === 'legacy_server' ? '服务器' : '未配置')
}

const DISTRO_NAMES = {
  windows: 'Windows',
  macos: 'macOS',
  freebsd: 'FreeBSD',
  ubuntu: 'Ubuntu',
  debian: 'Debian',
  centos: 'CentOS',
  rocky: 'Rocky Linux',
  redhat: 'Red Hat Enterprise Linux',
  fedora: 'Fedora',
  alpine: 'Alpine Linux',
  arch: 'Arch Linux',
  opensuse: 'openSUSE',
  oracle: 'Oracle Linux',
  amazon: 'Amazon Linux',
  almalinux: 'AlmaLinux',
  kylin: '银河麒麟',
  uos: '统信 UOS',
  openeuler: 'openEuler',
  alinux: '龙蜥 Anolis OS',
  fangde: '中科方德',
  linux: 'Linux',
  security: '安全设备',
  storage: '存储设备',
  hyperconverged: '超融合（系统未填写）',
  vmware: 'VMware ESXi',
  proxmox: 'Proxmox VE',
  nutanix: 'Nutanix AHV',
  hyperv: 'Microsoft Hyper-V',
  kvm: 'KVM',
  citrix: 'Citrix Hypervisor',
  openstack: 'OpenStack',
  smartx: 'SmartX',
  zstack: 'ZStack',
  virtualbox: 'VirtualBox',
}

const NETWORK_VENDOR_NAMES = {
  huawei: '华为',
  h3c: 'H3C',
  cisco: 'Cisco',
  juniper: 'Juniper',
  hpe: 'HPE',
  mikrotik: 'MikroTik',
  fortinet: 'Fortinet',
  paloalto: 'Palo Alto',
  zyxel: 'Zyxel',
  ruijie: '锐捷',
  sangfor: '深信服',
  hillstone: '山石',
  nsfocus: '绿盟',
  topsec: '天融信',
  venustech: '启明星辰',
  qianxin: '奇安信',
  dptech: '迪普',
  checkpoint: 'Check Point',
  sophos: 'Sophos',
  sonicwall: 'SonicWall',
}

const STORAGE_VENDOR_NAMES = {
  huawei: '华为',
  dellemc: 'Dell EMC',
  netapp: 'NetApp',
  ibm: 'IBM',
  hpe: 'HPE',
  lenovo: '联想',
  inspur: '浪潮',
  synology: '群晖',
  qnap: 'QNAP',
  purestorage: 'Pure Storage',
}

function clean(value) {
  return String(value || '').trim()
}

function effectiveHostDistro(host = {}) {
  const detected = clean(host.distro).toLowerCase()
  const manual = clean(host.manualDistro).toLowerCase()
  if (host.distroMode === 'manual') return manual || detected
  return detected || manual
}

export function operatingSystemTypeFromDetectedHost(host = {}, asset = {}) {
  if (clean(asset.os_type || asset.system_type)) return ''
  const detected = clean(host.distro).toLowerCase()
  if (!detected) return ''
  const distro = distroFromText(detected)
  return DISTRO_NAMES[distro] || ''
}

function distroFromText(value) {
  const text = clean(value).toLowerCase()
  if (!text) return ''
  const mappings = [
    ['vmware', /vmware|\besxi\b|vsphere|vsan/],
    ['proxmox', /proxmox|\bpve\b/],
    ['nutanix', /nutanix|\bahv\b/],
    ['hyperv', /\bhyper\s*-?v\b/],
    ['kvm', /\bkvm\b/],
    ['citrix', /citrix|xenserver/],
    ['openstack', /openstack/],
    ['smartx', /smartx|smtx/],
    ['zstack', /zstack/],
    ['virtualbox', /virtualbox/],
    ['huawei', /fusioncompute|fusioncube/],
    ['h3c', /\bh3c\b.*\b(?:uis|cas)\b/],
    ['sangfor', /\bacloud\b/],
    ['kylin', /银河麒麟|中标麒麟|麒麟|\bkylin\b/],
    ['uos', /统信|uniontech|\buos\b|\bdeepin\b/],
    ['openeuler', /open\s*euler|欧拉/],
    ['alinux', /龙蜥|anolis|alibaba cloud linux|\balinux\b/],
    ['fangde', /中科方德|方德/],
    ['windows', /windows/],
    ['ubuntu', /ubuntu/],
    ['debian', /debian/],
    ['centos', /centos/],
    ['rocky', /rocky/],
    ['redhat', /red\s*hat|\brhel\b/],
    ['fedora', /fedora/],
    ['alpine', /alpine/],
    ['arch', /arch\s*linux|\barch\b/],
    ['opensuse', /open\s*suse|suse/],
    ['oracle', /oracle\s*linux/],
    ['amazon', /amazon\s*linux/],
    ['almalinux', /alma\s*linux|almalinux/],
    ['freebsd', /freebsd/],
    ['macos', /mac\s*os|macos|darwin/],
    ['linux', /linux|unix/],
  ]
  return mappings.find(([, pattern]) => pattern.test(text))?.[0] || ''
}

function networkVendorFromText(value) {
  const text = clean(value).toLowerCase()
  if (!text) return ''
  const mappings = [
    ['sangfor', /\bsangfor\b|深信服|\bafos\b/],
    ['hillstone', /\bhillstone\b|山石(?:网科)?|\bstoneos\b/],
    ['nsfocus', /\bnsfocus\b|绿盟(?:科技)?/],
    ['topsec', /\btopsec\b|天融信/],
    ['venustech', /\bvenustech\b|启明星辰/],
    ['qianxin', /\bqianxin\b|\bqi[-\s]?anxin\b|奇安信/],
    ['dptech', /\bdptech\b|迪普(?:科技)?/],
    ['checkpoint', /check\s*point/],
    ['sophos', /\bsophos\b/],
    ['sonicwall', /\bsonic\s*wall\b/],
    ['h3c', /\bh3c\b|新华三/],
    ['huawei', /huawei|华为/],
    ['cisco', /cisco|思科/],
    ['juniper', /juniper|瞻博/],
    ['hpe', /\bhpe\b|hewlett|惠普/],
    ['mikrotik', /mikrotik/],
    ['fortinet', /fortinet|飞塔/],
    ['paloalto', /palo\s*alto(?:\s*networks)?/],
    ['zyxel', /zyxel|合勤/],
    ['ruijie', /ruijie|锐捷/],
  ]
  return mappings.find(([, pattern]) => pattern.test(text))?.[0] || ''
}

function storageVendorFromText(value) {
  const text = clean(value).toLowerCase()
  if (!text) return ''
  const mappings = [
    ['huawei', /huawei|华为|oceanstor/],
    ['dellemc', /dell\s*emc|powerstore|powermax|unity\s*(?:xt)?/],
    ['netapp', /netapp|ontap/],
    ['ibm', /\bibm\b|flashsystem/],
    ['hpe', /\bhpe\b|hewlett|惠普|alletra|\b3par\b|nimble/],
    ['lenovo', /lenovo|联想/],
    ['inspur', /inspur|浪潮/],
    ['synology', /synology|群晖|\bdsm\b/],
    ['qnap', /\bqnap\b|\bqts\b|quts/],
    ['purestorage', /pure\s*storage|purity/],
  ]
  return mappings.find(([, pattern]) => pattern.test(text))?.[0] || ''
}

export function resolveOperatingSystemPresentation(asset = {}, host = null) {
  const type = clean(asset.os_type || asset.system_type)
  const version = clean(asset.os_version || asset.system_version)
  const hostDistro = effectiveHostDistro(host || {})
  const assetType = clean([asset.device_type, asset.category_name].filter(Boolean).join(' ')).toLowerCase()
  const securityAsset = /security[_ -]?device|firewall|安全设备|防火墙/.test(assetType)
  const storageAsset = /storage|存储/.test(assetType)
  const networkAsset = ['switch', 'router'].includes(resolveDeviceKind(asset)) || securityAsset || /network/.test(assetType)
  const vendorText = [asset.vendor, asset.model, type, hostDistro].filter(Boolean).join(' ')
  const vendorDistro = storageAsset ? storageVendorFromText(vendorText) : networkAsset ? networkVendorFromText(vendorText) : ''
  const distro = vendorDistro || distroFromText(type) || distroFromText(hostDistro) || (storageAsset ? 'storage' : securityAsset ? 'security' : networkAsset ? 'network' : /hyperconverged|超融合|\bhci\b/.test(assetType) ? 'hyperconverged' : 'unknown')
  const vendorName = storageAsset ? STORAGE_VENDOR_NAMES[vendorDistro] : NETWORK_VENDOR_NAMES[vendorDistro]
  const deviceLabel = storageAsset ? '存储设备' : securityAsset ? '安全设备' : '网络设备'
  const name = type || (vendorDistro ? `${vendorName} ${deviceLabel}` : DISTRO_NAMES[distro]) || (storageAsset ? '存储设备' : networkAsset ? '网络设备' : '未识别')
  return {
    distro,
    name,
    version,
    label: [name, version].filter(Boolean).join(' '),
  }
}

const GENERIC_OS_WORDS = /\b(?:linux|gnu|advanced|server|enterprise|edition|operating|system)\b/gi

// 列表用的操作系统短名：完整名称留在悬停提示里。
// “Linux / Sangfor OS”取更具体的一侧，去掉 Linux、Advanced Server 等通用词，保留版本号。
export function shortOperatingSystemLabel(name = '', version = '') {
  const parts = clean(name).split(/\s*\/\s*/).filter(Boolean)
  const specific = parts.length > 1 && /^linux$/i.test(parts[0]) ? parts[1] : parts[0] || ''
  const short = specific.replace(GENERIC_OS_WORDS, ' ').replace(/\s+/g, ' ').trim() || specific
  return [short, clean(version)].filter(Boolean).join(' ').replace(/\s*[（(][^）)]*[）)]/g, '').trim()
}

// 列表用的型号短名：品牌由图标表达，去掉型号里重复的品牌前缀和括号说明。
export function shortModelLabel(vendor = '', model = '') {
  const brand = clean(vendor)
  let text = clean(model)
  if (brand && text.startsWith(brand)) text = text.slice(brand.length).trim()
  text = text.replace(/[（(][^）)]*[）)]/g, '').replace(/\s+/g, ' ').trim()
  return text || brand
}

export function buildLinkedHostByAssetID(links = [], hosts = []) {
  const hostByID = new Map(hosts.map((host) => [host.id, host]))
  const lookup = new Map()
  const priorities = new Map()
  links.forEach((link) => {
    const host = hostByID.get(link.host_id)
    const assetID = Number(link.asset_id || 0)
    if (!host || !assetID) return
    const priority = link.is_primary ? 1 : 0
    if (!lookup.has(assetID) || priority > (priorities.get(assetID) || 0)) {
      lookup.set(assetID, host)
      priorities.set(assetID, priority)
    }
  })
  return lookup
}

export const sourceLabel = value => ({ manual: '手工登记', legacy_server: '基础设施台账', import: '导入' }[value] || value || '-')
export function deviceReadTime(value) {
  if (!value) return '尚未读取'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { hour12: false })
}

function formatUPosition(asset = {}) {
  const start = Number(asset.start_u || asset.u_start || 0)
  const height = Number(asset.height_u || asset.u_height || 0)
  if (!start) return ''
  if (height > 1) return `${start}-${start + height - 1}U`
  return `${start}U`
}

function uniqueValues(values) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))]
}

export function buildOwnership(asset = {}, context = {}) {
  const project = String(context.projectName || '').trim() || (asset.project_id ? `项目 #${asset.project_id}` : '未分配')
  const organization = uniqueValues([asset.org_name, asset.organization, asset.department]).join(' / ') || '未分配'
  const location = uniqueValues([
    asset.room,
    asset.data_center,
    asset.floor,
  ]).join(' · ') || '未分配'
  const cabinet = asset.asset_class === 'virtual' ? '' : uniqueValues([
    asset.cabinet_name || asset.cabinet_pos,
    asset.cabinet_row,
    Number(asset.cabinet_col) > 0 ? `第 ${asset.cabinet_col} 列` : '',
    formatUPosition(asset),
  ]).join(' · ')
  return {
    project,
    organization,
    group: missing(asset.group_name),
    owner: missing(asset.owner),
    location,
    cabinet,
  }
}

export function buildDeviceWorkspaceModel(asset = {}, context = {}) {
  return {
    kind: resolveDeviceKind(asset),
    ownership: buildOwnership(asset, context),
  }
}

const OPERATION_LABELS = {
  switch: '端口与配置',
  router: '接口运行',
  server: '承载业务',
}

// 终端资产与基础设施共用的详情分区，顺序即页签顺序；基础设施额外有机柜和设备专属运行页签。
export function buildDeviceWorkspaceTabs(kind = 'generic', showPhotos = true, options = {}) {
  const terminal = kind === 'terminal'
  const showCabinet = !terminal && !options.virtual
  const photosInCabinet = showCabinet && (kind === 'server' || kind === 'switch')
  const operationLabel = OPERATION_LABELS[kind]
  return {
    defaultTab: kind === 'switch' || kind === 'router' ? 'operations' : 'hardware',
    tabs: [
      { key: 'hardware', label: '硬件信息' },
      ...(operationLabel ? [{ key: 'operations', label: operationLabel }] : []),
      { key: 'network', label: '网络配置' },
      { key: 'usage', label: '使用与位置' },
      ...(showCabinet ? [{ key: 'cabinet', label: '机柜信息' }] : []),
      { key: 'system', label: '系统信息' },
      ...(showPhotos && !photosInCabinet ? [{ key: 'photos', label: '设备照片' }] : []),
      { key: 'records', label: '设备履历' },
      { key: 'relations', label: '凭证中心' },
    ],
  }
}

export function formatMemory(value) {
  const memoryMB = Number(value || 0)
  if (!memoryMB) return '-'
  const memoryGB = memoryMB / 1024
  return `${Number.isInteger(memoryGB) ? memoryGB : memoryGB.toFixed(1)} GB`
}

export function buildRouterInterfaceRows(interfaces = []) {
  return interfaces.map((item, index) => ({
    id: item.id || `${item.name || item.if_name || 'interface'}-${index}`,
    name: item.name || item.if_name || `接口 ${index + 1}`,
    ip: item.ip || '-',
    mask: item.mask || '',
    gateway: item.gateway || '',
    vlan: item.vlan_id || item.vlan || '',
    role: item.role || item.interface_role || item.network_zone || item.net_zone || (item.is_primary ? '主接口' : '未标注'),
  }))
}

export function buildServerSpecification(asset = {}) {
  const cpu = [asset.cpu_info, asset.vcpu ? `${asset.vcpu} vCPU` : ''].filter(Boolean).join(' · ') || '-'
  return {
    cpu,
    memory: formatMemory(asset.memory_mb),
    disk: String(asset.disk_info || '').trim() || '-',
    os: [asset.os_type, asset.os_version].filter(Boolean).join(' ') || '-',
    management: asset.mgmt_url || '-',
  }
}

const INFRASTRUCTURE_TYPES_WITHOUT_LIST_OS = new Set(['switch', 'router', 'security_device', 'storage'])

export function infrastructureListPresentation(asset = {}) {
  const deviceType = clean(asset.device_type).toLowerCase()
  const hasOperatingSystem = Boolean(clean(asset.os_type || asset.system_type) || clean(asset.os_version || asset.system_version))
  return {
    vendor: clean(asset.vendor) || clean(asset.provider),
    model: clean(asset.model),
    showOperatingSystem: hasOperatingSystem && !INFRASTRUCTURE_TYPES_WITHOUT_LIST_OS.has(deviceType),
  }
}

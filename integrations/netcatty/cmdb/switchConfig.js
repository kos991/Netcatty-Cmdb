const HIDDEN = '已配置（隐藏）'

const COMMANDS = Object.freeze({
  huawei: ['display version', 'display device', 'display current-configuration'],
  h3c: ['display version', 'display device', 'display current-configuration'],
  ruijie: ['show version', 'show interface status', 'show running-config'],
  cisco: ['show version', 'show running-config'],
  zte: ['show version', 'show interface brief', 'show running-config'],
})

export function normalizeSwitchVendor(value) {
  const name = String(value || '').trim().toLowerCase()
  if (/huawei|华为/.test(name)) return 'huawei'
  if (/h3c|新华三/.test(name)) return 'h3c'
  if (/ruijie|锐捷/.test(name)) return 'ruijie'
  if (/cisco|思科/.test(name)) return 'cisco'
  if (/zte|中兴/.test(name)) return 'zte'
  return ''
}

export function buildSwitchCommand(vendor, protocol) {
  const key = normalizeSwitchVendor(vendor)
  if (!COMMANDS[key]) throw new Error(`厂商未适配：${vendor || '未知'}`)
  if (!['ssh', 'telnet'].includes(String(protocol || '').toLowerCase())) throw new Error('交换机读取仅支持 SSH 或 Telnet 协议')
  return [...COMMANDS[key]]
}

function hiddenKey(key) {
  return /pass(word)?|secret|community|auth(key|entication)?|priv(key|acy)?|hash|cipher|encrypt|private.?key/i.test(key)
}

export function sanitizeSwitchSnapshot(value, key = '') {
  if (hiddenKey(key)) return HIDDEN
  if (Array.isArray(value)) return value.map((item) => sanitizeSwitchSnapshot(item))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, sanitizeSwitchSnapshot(item, name)]))
}

function emptySnapshot(vendor) {
  return {
    version: 2,
    vendor: String(vendor || '').trim().toLowerCase(),
    readAt: new Date().toISOString(),
    device: { name: '', model: '', version: '', managementAddress: '', managementVlan: '', aggregation: [] },
    interfaces: [],
    acl: [],
    accounts: [],
    services: { sshTelnet: { ssh: '未识别', telnet: '未识别', inbound: '' } },
    snmp: { version: '', users: [], groups: [], securityLevel: '', algorithms: '', acl: '', views: [], traps: [] },
  }
}

function parseInterfaceLine(line) {
  const match = line.match(/^interface\s+(.+)$/i)
  return match ? { name: match[1].trim(), enabled: null, description: '', mode: '', vlan: '', allowedVlans: [], aggregation: '' } : null
}

function parseCommon(output, vendor) {
  const snapshot = emptySnapshot(vendor)
  let current = null
  let currentAccount = null
  let currentACL = ''
  const add = (list, value) => { if (value && !list.includes(value)) list.push(value) }
  const lines = String(output || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  for (const line of lines) {
    if (/^[#!]$|^return$|^end$/i.test(line)) { current = null; currentAccount = null; currentACL = ''; continue }
    const aclHeader = line.match(/^(?:acl(?: (?:number|name))?|ip access-list (?:extended|standard))\s+(\S+)/i)
    if (aclHeader) { currentACL = aclHeader[1]; current = null; currentAccount = null; continue }
    const iface = parseInterfaceLine(line)
    if (iface) { snapshot.interfaces.push(iface); current = iface; currentAccount = null; currentACL = ''; continue }
    if (current && /^shutdown$/i.test(line)) { current.enabled = false; continue }
    if (current && /^(?:undo|no) shutdown$/i.test(line)) { current.enabled = true; continue }
    if (current && /^description\s+/i.test(line)) { current.description = line.replace(/^description\s+/i, '').trim(); continue }
    if (current && /(port link-type|switchport mode)/i.test(line)) { current.mode = line.match(/(?:port link-type|switchport mode)\s+(\S+)/i)?.[1] || ''; continue }
    if (current && /^(?:port default vlan|port access vlan|port trunk pvid vlan|switchport access vlan|switchport trunk native vlan)\s+/i.test(line)) {
      current.vlan = line.match(/(\d+)\s*$/)?.[1] || ''
      continue
    }
    if (current && /^(?:port link-aggregation group|channel-group|eth-trunk)\s+/i.test(line)) {
      current.aggregation = line.match(/(?:group|eth-trunk)\s+(\d+)/i)?.[1] || ''
      continue
    }
    if (current && /(allow-pass vlan|permit vlan|allowed vlan)/i.test(line)) {
      current.allowedVlans = line.replace(/^.*?(allow-pass vlan|permit vlan|allowed vlan)\s*/i, '').split(/[ ,]+/).filter(Boolean)
      continue
    }
    if (current && /^ip address /i.test(line)) {
      current.ip = line.split(/\s+/)[2]
      continue
    }
    const name = line.match(/^(?:sysname|hostname)\s+(.+)$/i)
    if (name) { snapshot.device.name = name[1].trim(); continue }
    const version = line.match(/(?:software[, ]+version|VRP.*?Version|Comware.*?Version|^version|software version)\s*[: ]\s*(.+)$/i)
    if (version && !snapshot.device.version) { snapshot.device.version = version[1].trim(); continue }
    const model = line.match(/(?:device model|model)\s*[: ]\s*(.+)$/i) || line.match(/^(?:H3C|Huawei|Cisco|Ruijie|ZTE)\s+(\S+)\s+(?:uptime|\()/i)
    if (model && !snapshot.device.model) { snapshot.device.model = model[1].trim(); continue }
    const acl = line.match(/^(?:rule|access-list)\s+(.+)$/i) || (currentACL ? line.match(/^((?:\d+\s+)?(?:permit|deny)\s+.+)$/i) : null)
    if (acl) { snapshot.acl.push({ name: currentACL || (/^access-list/i.test(line) ? acl[1].split(/\s+/)[0] : ''), rule: acl[1].trim(), action: /\bdeny\b/i.test(acl[1]) ? 'deny' : 'permit' }); continue }
    const account = line.match(/^(?:local-user|username)\s+(\S+)(.*)$/i)
    if (account) {
      current = null
      currentAccount = snapshot.accounts.find(item => item.username === account[1])
      if (!currentAccount) { currentAccount = { username: account[1], role: '', services: [], status: '已配置' }; snapshot.accounts.push(currentAccount) }
    }
    if (currentAccount) {
      const role = line.match(/(?:privilege(?: level)?|user-role)\s+(\S+)/i)
      if (role) currentAccount.role = role[1]
      const services = line.match(/service-type\s+(.+)/i)
      if (services) currentAccount.services = services[1].split(/\s+/)
      if (/state block/i.test(line)) currentAccount.status = '已禁用'
    }
    if (/^(?:undo |no )?(?:stelnet|ssh|telnet) server (?:enable|disable)/i.test(line)) {
      const service = /^.*?telnet server/i.test(line) && !/stelnet/i.test(line) ? 'telnet' : 'ssh'
      snapshot.services.sshTelnet[service] = /^(undo|no) | disable/i.test(line) ? '已关闭' : '已启用'
    }
    if (/^ip ssh /i.test(line)) snapshot.services.sshTelnet.ssh = '已配置（运行状态未采集）'
    const inbound = line.match(/^(?:transport input|protocol inbound)\s+(.+)/i)
    if (inbound) snapshot.services.sshTelnet.inbound = inbound[1]
    const snmpVersion = line.match(/snmp.*version\s+(.+)/i)
    if (snmpVersion) snapshot.snmp.version = snmpVersion[1].trim().toLowerCase()
    if (/snmp.*(?:enable|server|community|user|group|trap)/i.test(line)) snapshot.snmp.configured = HIDDEN
    if (/^snmp/i.test(line)) {
      add(snapshot.snmp.users, line.match(/(?:usm-user\s+v3|snmp-server user)\s+(\S+)/i)?.[1])
      add(snapshot.snmp.groups, line.match(/(?:snmp-agent group\s+v\d|snmp-server group)\s+(\S+)/i)?.[1])
      add(snapshot.snmp.views, line.match(/(?:mib-view\s+(?:included|excluded)|snmp-server view)\s+(\S+)/i)?.[1])
      add(snapshot.snmp.traps, line.match(/(?:udp-domain|snmp-server host)\s+([\da-f:.]+)/i)?.[1])
      const level = line.match(/\b(privacy|authentication|noauth|auth|priv)\b/i)
      if (level) snapshot.snmp.securityLevel = level[1]
      const algorithms = [...line.matchAll(/(?:authentication-mode|privacy-mode)\s+(\S+)/gi)].map(match => match[1])
      if (algorithms.length) snapshot.snmp.algorithms = algorithms.join(' / ')
      const aclName = line.match(/\bacl\s+(\S+)/i)
      if (aclName) snapshot.snmp.acl = aclName[1]
    }
  }
  if (!snapshot.device.name && !snapshot.interfaces.length && !snapshot.accounts.length && !snapshot.acl.length && !snapshot.snmp.configured) throw new Error('未识别到设备配置，请检查读取权限、厂商和命令输出')
  return sanitizeSwitchSnapshot(snapshot)
}

export function parseSwitchOutput(vendor, output) {
  const key = normalizeSwitchVendor(vendor)
  if (!COMMANDS[key]) throw new Error(`厂商未适配：${vendor || '未知'}`)
  return parseCommon(output, key)
}

export const SUPPORTED_SWITCH_VENDORS = Object.freeze(Object.keys(COMMANDS))

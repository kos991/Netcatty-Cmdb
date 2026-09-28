import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSwitchCommand, normalizeSwitchVendor, parseSwitchOutput, sanitizeSwitchSnapshot } from './switchConfig.js'

test('识别资产中常见的中英文厂商名称', () => {
  assert.equal(normalizeSwitchVendor('华为技术有限公司'), 'huawei')
  assert.equal(normalizeSwitchVendor('H3C/新华三'), 'h3c')
  assert.equal(normalizeSwitchVendor('Cisco Systems'), 'cisco')
  assert.equal(normalizeSwitchVendor('未知品牌'), '')
})

test('只为已适配厂商生成只读命令并拒绝修改命令', () => {
  assert.ok(buildSwitchCommand('huawei', 'ssh').includes('display current-configuration'))
  assert.ok(buildSwitchCommand('cisco', 'telnet').includes('show running-config'))
  assert.throws(() => buildSwitchCommand('unknown', 'ssh'), /未适配/)
  assert.throws(() => buildSwitchCommand('huawei', 'ftp'), /协议/)
})

test('解析华为输出为标准设备、端口、安全摘要', () => {
  const snapshot = parseSwitchOutput('huawei', `
Huawei Versatile Routing Platform Software
sysname CORE-SW
interface GigabitEthernet0/0/1
 description 上联服务器
 port link-type trunk
 port trunk allow-pass vlan 10 20
interface GigabitEthernet0/0/2
 shutdown
 description 空闲端口
acl number 3000
 rule 5 permit ip source 10.0.0.0 0.0.0.255
stelnet server enable
snmp-agent sys-info version v3
local-user admin privilege level 15
`)
  assert.equal(snapshot.device.name, 'CORE-SW')
  assert.equal(snapshot.interfaces.length, 2)
  assert.deepEqual(snapshot.interfaces[0], { name: 'GigabitEthernet0/0/1', enabled: null, description: '上联服务器', mode: 'trunk', vlan: '', allowedVlans: ['10', '20'], aggregation: '' })
  assert.equal(snapshot.interfaces[1].enabled, false)
  assert.equal(snapshot.acl[0].rule, '5 permit ip source 10.0.0.0 0.0.0.255')
  assert.equal(snapshot.services.sshTelnet.ssh, '已启用')
  assert.equal(snapshot.snmp.version, 'v3')
})

test('完整配置保留接口和 ACL 子命令，分段不串台，账号和 SNMP 不泄漏口令', () => {
  const raw = `sysname CORE
interface GigabitEthernet1/0/1
 description uplink
 shutdown
 port link-type trunk
 port trunk permit vlan 10 20
 port link-aggregation group 10
#
acl number 3000
 rule 5 deny ip source 192.0.2.0 0.0.0.255
#
local-user admin class manage
 password hash VERY_SECRET_PASSWORD
 authorization-attribute user-role network-admin
 service-type ssh telnet
#
line vty 0 4
 protocol inbound ssh
#
snmp-agent sys-info version v3
snmp-agent group v3 ops privacy read-view safe acl 2001
snmp-agent usm-user v3 monitor ops authentication-mode sha AUTH_SECRET privacy-mode aes128 PRIV_SECRET
snmp-agent community read COMMUNITY_SECRET
snmp-agent mib-view included safe iso
snmp-agent target-host trap address udp-domain 192.0.2.2 params securityname SECRET_TARGET v3 privacy
`
  const snapshot = parseSwitchOutput('h3c', raw)
  assert.equal(snapshot.interfaces[0].enabled, false)
  assert.deepEqual(snapshot.interfaces[0].allowedVlans, ['10', '20'])
  assert.equal(snapshot.acl[0].name, '3000')
  assert.equal(snapshot.accounts[0].role, 'network-admin')
  assert.deepEqual(snapshot.accounts[0].services, ['ssh', 'telnet'])
  assert.equal(snapshot.services.sshTelnet.telnet, '未识别')
  assert.ok(snapshot.snmp.groups.includes('ops'))
  assert.ok(snapshot.snmp.users.includes('monitor'))
  assert.ok(snapshot.snmp.views.includes('safe'))
  assert.deepEqual(snapshot.snmp.traps, ['192.0.2.2'])
  assert.doesNotMatch(JSON.stringify(snapshot), /VERY_SECRET|AUTH_SECRET|PRIV_SECRET|COMMUNITY_SECRET|SECRET_TARGET/)
  assert.throws(() => parseSwitchOutput('h3c', '% Permission denied'), /未识别|权限/)
})

test('递归脱敏不保存口令、哈希、Community 和密钥', () => {
  const sanitized = sanitizeSwitchSnapshot({ username: 'admin', password: 'x', community: 'public', authKey: 'secret', nested: { encrypted: 'x', value: 'ok' } })
  assert.deepEqual(sanitized, { username: 'admin', password: '已配置（隐藏）', community: '已配置（隐藏）', authKey: '已配置（隐藏）', nested: { encrypted: '已配置（隐藏）', value: 'ok' } })
})

test('解析端口的 Access VLAN 和聚合组', () => {
  const snapshot = parseSwitchOutput('h3c', `
interface GigabitEthernet1/0/1
 port link-type access
 port default vlan 230
 port link-aggregation group 10
interface GigabitEthernet1/0/2
 port link-type trunk
 port trunk allow-pass vlan 10 20
`)

  assert.equal(snapshot.interfaces[0].vlan, '230')
  assert.equal(snapshot.interfaces[0].aggregation, '10')
  assert.deepEqual(snapshot.interfaces[1].allowedVlans, ['10', '20'])
})

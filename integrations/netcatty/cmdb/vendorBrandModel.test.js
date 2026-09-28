import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveVendorBrand, vendorBrandLabel } from './vendorBrandModel.js'
import { resolveDeviceKind, resolveOperatingSystemPresentation } from './deviceWorkspaceModel.js'
import { infrastructureFieldProfile } from './state.js'

test('虚拟化和超融合品牌按常见产品名自动识别', () => {
  const cases = {
    VMware: 'vmware',
    'VMware vSphere / ESXi': 'vmware',
    PVE: 'proxmox',
    'Proxmox VE': 'proxmox',
    Nutanix: 'nutanix',
    Prism: 'nutanix',
    'FusionCube 超融合': 'huawei',
    'H3C UIS': 'h3c',
    SmartX: 'smartx',
    ZStack: 'zstack',
    OpenStack: 'openstack',
    'Microsoft Hyper-V': 'hyperv',
    XenServer: 'citrix',
    KVM: 'kvm',
  }
  for (const [input, expected] of Object.entries(cases)) assert.equal(resolveVendorBrand(input), expected, input)
})

test('保留原始品牌字段，同时提供规范显示名称', () => {
  assert.equal(resolveVendorBrand('Dell EMC PowerStore'), 'dellemc')
  assert.equal(vendorBrandLabel('proxmox'), 'Proxmox VE')
  assert.equal(resolveVendorBrand('未知厂商'), '')
})

test('国产系统厂商的中文与英文名称映射同一品牌', () => {
  for (const [value, brand] of [['麒麟软件', 'kylin'], ['Kylin', 'kylin'], ['统信 UOS', 'uos'], ['UnionTech', 'uos'], ['中科方德', 'fangde'], ['NFSChina', 'fangde']]) {
    assert.equal(resolveVendorBrand(value), brand, value)
  }
})

test('品牌优先于型号或供应商，未知品牌不冒用经销商品牌', () => {
  assert.equal(resolveVendorBrand('Dell'), 'dellemc')
  assert.equal(resolveVendorBrand('华为', { model: 'VMware vSAN', provider: 'Dell EMC' }), 'huawei')
  assert.equal(resolveVendorBrand('自定义厂商', { provider: '华为' }), '')
  assert.equal(resolveVendorBrand('Hypervisor'), '')
  assert.equal(resolveVendorBrand('community'), '')
  for (const [input, expected] of [['Cisco', 'cisco'], ['飞塔', 'fortinet'], ['Juniper', 'juniper'], ['Palo Alto', 'paloalto'], ['MikroTik', 'mikrotik'], ['Zyxel', 'zyxel'], ['Check Point', 'checkpoint']]) {
    assert.equal(resolveVendorBrand(input), expected)
  }
})

test('虚拟化平台在系统列识别，不能用设备品牌覆盖真实操作系统', () => {
  for (const [type, expected] of [['VMware ESXi', 'vmware'], ['PVE', 'proxmox'], ['Nutanix AHV', 'nutanix'], ['Hyper-V', 'hyperv'], ['KVM', 'kvm'], ['FusionCompute', 'huawei'], ['H3C UIS', 'h3c'], ['aCloud', 'sangfor'], ['SmartX', 'smartx'], ['ZStack', 'zstack']]) {
    const result = resolveOperatingSystemPresentation({ device_type: 'hyperconverged', os_type: type, os_version: '8.0' })
    assert.equal(result.distro, expected, type)
    assert.equal(result.version, '8.0')
  }
  assert.equal(resolveOperatingSystemPresentation({ device_type: 'server', vendor: 'VMware', os_type: 'Ubuntu' }).distro, 'ubuntu')
  assert.equal(resolveOperatingSystemPresentation({ device_type: 'hyperconverged' }).distro, 'hyperconverged')
  assert.equal(resolveDeviceKind({ device_type: 'hyperconverged' }), 'server')
  assert.equal(infrastructureFieldProfile('hyperconverged').cpu, true)
})

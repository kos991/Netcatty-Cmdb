import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const directory = path.dirname(fileURLToPath(import.meta.url))

test('新增设备厂商均使用真实 SVG 品牌资源', () => {
  const vendors = [
    'dellemc', 'netapp', 'ibm', 'hpe', 'lenovo', 'inspur', 'synology', 'qnap', 'purestorage',
    'ruijie', 'nsfocus', 'topsec', 'venustech', 'qianxin', 'dptech', 'checkpoint', 'sophos', 'sonicwall',
  ]
  for (const vendor of vendors) {
    const file = path.join(directory, 'vendor-icons', `${vendor}.svg`)
    assert.equal(fs.existsSync(file), true, `缺少 ${vendor} 的品牌 SVG`)
    const source = fs.readFileSync(file, 'utf8')
    assert.match(source, /<svg[\s>]/i, `${vendor} 不是 SVG 资源`)
    assert.doesNotMatch(source, /data-os-icon|font-size|>\s*[A-Z]{1,3}\s*</i, `${vendor} 仍是文字徽章占位`)
  }
})

test('虚拟化和超融合品牌资源已内置且不是文字占位', () => {
  const resources = {
    vmware: 'svg',
    proxmox: 'svg',
    nutanix: 'svg',
    huawei: 'svg',
    zstack: 'svg',
    openstack: 'svg',
    microsoft: 'svg',
    citrix: 'svg',
    virtualbox: 'svg',
    kvm: 'png',
    redhat: 'svg',
    redhatopenshift: 'svg',
    smartx: 'svg',
    kylin: 'png',
    uos: 'png',
    fangde: 'svg',
  }
  for (const [vendor, extension] of Object.entries(resources)) {
    const file = path.join(directory, 'vendor-icons', `${vendor}.${extension}`)
    assert.equal(fs.existsSync(file), true, `缺少 ${vendor} 的本地品牌资源`)
    const source = fs.readFileSync(file)
    if (extension === 'svg') {
      assert.match(source.toString('utf8'), /<svg[\s>]/i, `${vendor} 不是 SVG 资源`)
      assert.doesNotMatch(source.toString('utf8'), /data-os-icon|font-size|>\s*[A-Z]{1,3}\s*</i, `${vendor} 仍是文字徽章占位`)
    } else {
      assert.equal(source[0], 0x89, `${vendor} PNG 资源头不正确`)
      assert.equal(source[1], 0x50, `${vendor} PNG 资源头不正确`)
    }
  }
})

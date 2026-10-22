import assert from 'node:assert/strict'
import test from 'node:test'
import { parseHardwareOutput } from './hostHardwareParser.js'

test('Linux CPU sockets, logical cores, memory and physical disks remain distinct', () => {
  const value = parseHardwareOutput('Linux', `__CMDB_CPU__
CPU(s): 32
Model name: Intel Xeon 1234
Socket(s): 2
__CMDB_MEMORY__
MemTotal: 67108864 kB
__CMDB_DISKS__
sda 107374182400 disk Test SSD
sda1 104857600 part
loop0 4096 loop
__CMDB_OS__
NAME="Ubuntu"
VERSION_ID="24.04"`)
  assert.deepEqual(value, { cpu_info: '2 × Intel Xeon 1234', vcpu: 32, memory_mb: 65536, disk_info: '100 GB Test SSD', os_type: 'Ubuntu', os_version: '24.04' })
})

test('incomplete Linux output fails instead of filling empty hardware', () => {
  assert.throws(() => parseHardwareOutput('Linux', '__CMDB_CPU__\nModel name: x'), /不完整/)
  assert.throws(() => parseHardwareOutput('Linux', '__CMDB_CPU__\nModel name: x\n__CMDB_MEMORY__\nMemTotal: 1024 kB\n__CMDB_DISKS__\n__CMDB_OS__\nNAME=Linux'), /缺少/)
})

test('Windows JSON preserves complete disk descriptions and rejects invalid memory', () => {
  const source = { cpu_info: '2 x CPU name', vcpu: 16, memory_mb: 32768, disk_info: '250 GB SCSI Test / 1000 GB SATA Test', os_type: 'Windows Server', os_version: '10.0' }
  assert.deepEqual(parseHardwareOutput('Windows', JSON.stringify(source)), source)
  assert.throws(() => parseHardwareOutput('Windows', JSON.stringify({ ...source, memory_mb: 1.5 })), /缺少/)
})

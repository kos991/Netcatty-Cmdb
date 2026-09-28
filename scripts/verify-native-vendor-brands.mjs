import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

// 仅连接隔离测试版：不扫描设备、不连接主机、不写正式安装目录。
const require = createRequire(new URL('../build/native-ui-test-tools/package.json', import.meta.url))
const { chromium, expect } = require('playwright/test')
const browser = await chromium.connectOverCDP('http://127.0.0.1:9224')
const page = browser.contexts()[0].pages().find(item => item.url() === 'app://netcatty/index.html')
assert.ok(page, '未找到隔离 Netcatty 测试窗口')
page.setDefaultTimeout(10000)
const errors = []
page.on('pageerror', error => errors.push(error.message))
const request = (path, method = 'GET', body) => page.evaluate(args => window.netcatty.cmdbRequest(args), { path, method, ...(body ? { body: JSON.stringify(body) } : {}) })
const screenshot = name => page.screenshot({ path: fileURLToPath(new URL(`../build/native-ui-preview/${name}.png`, import.meta.url)) })
const editor = page.locator('[data-section="cmdb-infrastructure-editor"]')
const demoCode = 'DEMO-HCI-BRAND-VMWARE'

try {
  await page.setViewportSize({ width: 1536, height: 864 })
  await page.reload()
  await page.locator('[data-tab-id="cmdb"]').click()
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('netcatty.cmdb.cloudSync.v1') || '{}').enabled === true), false, '测试数据不得触发云同步')
  await page.getByRole('combobox', { name: '资产类别', exact: true }).click()
  await page.getByRole('option', { name: '基础设施', exact: true }).click()
  const search = page.getByPlaceholder('搜索资产编码、名称、SN、IP、品牌、型号或供应商')

  const types = await request('/api/cmdb/config/device-types')
  let hci = types.list.find(item => item.name === '超融合')
  if (!hci) hci = await request('/api/cmdb/config/device-types', 'POST', { name: '超融合', remark: '图标演示类型（隔离测试库）', parent_id: 0 })

  const existing = (await request(`/api/cmdb/assets?keyword=${demoCode}`)).list.find(item => item.asset_code === demoCode)
  if (existing) {
    await search.fill(demoCode)
    await search.press('Enter')
    await page.getByRole('button', { name: existing.name, exact: true }).click()
    await page.getByRole('button', { name: '编辑设备', exact: true }).click()
  } else {
    await page.getByRole('button', { name: '新增资产', exact: true }).click()
    await page.getByRole('button', { name: '基础设施', exact: true }).click()
  }
  const input = editor.getByRole('combobox', { name: '品牌 / 厂商', exact: true })
  await input.fill('')
  await input.press('ArrowDown')
  const presets = page.getByRole('listbox')
  await expect(presets).toBeVisible()
  assert.equal(await presets.getByRole('option').count(), 43, '品牌预设缺失')
  await expect(presets.locator('img')).toHaveCount(43)
  await page.waitForFunction(() => Array.from(document.querySelectorAll('[role="listbox"] img')).every(img => img.complete && img.naturalWidth > 0))
  await screenshot('cmdb-brand-presets')

  await input.fill('PVE')
  await expect(editor.locator('[data-vendor-brand="proxmox"]')).toHaveCount(1)
  await page.getByRole('option').filter({ hasText: 'Proxmox VE' }).click()
  await expect(input).toHaveValue('Proxmox VE')
  for (const [value, brand] of [['Dell EMC', 'dellemc'], ['华为', 'huawei'], ['VMware', 'vmware'], ['SmartX', 'smartx'], ['深信服', 'sangfor'], ['山石', 'hillstone'], ['Check Point', 'checkpoint']]) {
    await input.fill(value)
    await input.press('Escape')
    await expect(input).toHaveValue(value)
    await expect(editor.locator(`[data-vendor-brand="${brand}"]`)).toHaveCount(1)
  }
  await input.fill('自定义供应品牌')
  await input.press('Tab')
  await expect(input).toHaveValue('自定义供应品牌')
  await expect(editor.locator('[data-vendor-brand]')).toHaveCount(0)

  await input.fill('VMware')
  await input.press('Escape')
  await editor.getByRole('textbox', { name: '设备名称', exact: true }).fill('超融合图标演示 · VMware')
  await editor.getByRole('textbox', { name: '资产编码', exact: true }).fill(demoCode)
  await editor.getByRole('combobox', { name: '设备类型', exact: true }).click()
  await page.getByRole('option', { name: '超融合', exact: true }).click()
  await editor.getByRole('textbox', { name: '型号', exact: true }).fill('vSAN / vSphere')
  await editor.getByRole('textbox', { name: '备注', exact: true }).fill('仅用于图标和品牌预设验收，无真实管理 IP。')
  const os = editor.getByRole('combobox', { name: '操作系统类型', exact: true })
  await os.fill('VMware')
  await page.getByRole('option', { name: 'VMware ESXi', exact: true }).click()
  await editor.getByRole('textbox', { name: '操作系统版本', exact: true }).fill('8.0')
  await editor.getByRole('button', { name: '保存', exact: true }).click()
  await expect(editor).toHaveCount(0)
  const saved = (await request(`/api/cmdb/assets?keyword=${demoCode}`)).list.find(item => item.asset_code === demoCode)
  assert.equal(saved.vendor, 'VMware')
  assert.equal(saved.model, 'vSAN / vSphere')
  assert.equal(saved.os_type, 'VMware ESXi')
  assert.ok(!saved.mgmt_ip && !saved.manage_ip)
  const closeWorkspace = page.getByRole('button', { name: '关闭设备工作区', exact: true })
  if (await closeWorkspace.count()) await closeWorkspace.click()

  const examples = [
    ['PVE', 'PVE', 'Proxmox VE', 'proxmox'],
    ['Nutanix', 'Nutanix', 'Nutanix AHV', 'nutanix'],
    ['SmartX', 'SmartX', 'SmartX', 'smartx'],
    ['ZStack', 'ZStack', 'ZStack', 'zstack'],
  ]
  for (const [key, vendor, osType] of examples) {
    const code = `DEMO-HCI-BRAND-${key}`
    const rows = (await request(`/api/cmdb/assets?keyword=${code}`)).list
    if (!rows.some(item => item.asset_code === code)) await request('/api/cmdb/assets', 'POST', {
      name: `超融合图标演示 · ${key}`, asset_code: code, asset_class: 'physical', device_type: '超融合', category_id: hci.id,
      vendor, os_type: osType, status: '在库', interfaces: [], remark: '仅用于本地品牌图标演示，无真实管理 IP。',
    })
  }
  await search.fill('DEMO-HCI-BRAND')
  await search.press('Enter')
  for (const [key, , , brand] of [['VMware', '', '', 'vmware'], ...examples]) {
    const row = page.locator('tr').filter({ hasText: `超融合图标演示 · ${key}` })
    await expect(row.locator(`[data-os-distro="${brand}"]`)).toHaveCount(1)
    await expect(row.locator(`[data-vendor-brand="${brand}"]`)).toHaveCount(2)
  }
  await page.waitForFunction(() => Array.from(document.querySelectorAll('tr img')).every(img => img.complete && img.naturalWidth > 0))
  await screenshot('cmdb-virtualization-brands')
  await page.getByRole('button', { name: '超融合图标演示 · VMware', exact: true }).click()
  await expect(page.locator('[data-section="device-overview"] [data-vendor-brand="vmware"]')).toHaveCount(1)
  await page.getByRole('button', { name: '编辑设备', exact: true }).click()
  await expect(editor.getByRole('combobox', { name: '品牌 / 厂商', exact: true })).toHaveValue('VMware')
  await screenshot('cmdb-brand-editor')
  await editor.getByRole('button', { name: '取消', exact: true }).click()
  await page.getByRole('button', { name: '关闭设备工作区', exact: true }).click()

  await page.getByRole('button', { name: '配置中心', exact: true }).click()
  await page.getByRole('button', { name: '资产配置', exact: true }).click()
  await page.getByRole('combobox', { name: '资产字典类型', exact: true }).click()
  await page.getByRole('option', { name: '厂商与型号', exact: true }).click()
  const modelName = '本地品牌图标验收型号'
  await page.getByPlaceholder('搜索厂商与型号').fill(modelName)
  const models = await request(`/api/cmdb/models?keyword=${encodeURIComponent(modelName)}`)
  if (models.list.some(item => item.model === modelName)) {
    await page.locator('tr').filter({ hasText: modelName }).getByRole('button', { name: '编辑厂商与型号', exact: true }).click()
  } else {
    await page.getByRole('button', { name: '新增厂商与型号', exact: true }).click()
  }
  const modelEditor = page.getByRole('dialog')
  const modelVendor = modelEditor.getByRole('combobox', { name: '厂商', exact: true })
  await modelVendor.fill('PVE')
  await page.getByRole('option').filter({ hasText: 'Proxmox VE' }).click()
  await modelEditor.getByRole('textbox', { name: '型号', exact: true }).fill(modelName)
  await modelEditor.getByRole('button', { name: '保存', exact: true }).click()
  await expect(modelEditor).toHaveCount(0)
  await expect(page.locator('tr').filter({ hasText: modelName }).locator('[data-vendor-brand="proxmox"]')).toHaveCount(1)
  assert.equal((await request(`/api/cmdb/models?keyword=${encodeURIComponent(modelName)}`)).list.find(item => item.model === modelName).vendor, 'Proxmox VE')
  await screenshot('cmdb-brand-config')
  await page.getByRole('button', { name: '设备资产', exact: true }).click()
  await page.getByRole('combobox', { name: '资产类别', exact: true }).click()
  await page.getByRole('option', { name: '基础设施', exact: true }).click()
  await search.fill('DEMO-HCI-BRAND')
  await search.press('Enter')
  await expect(page.getByRole('button', { name: '超融合图标演示 · VMware', exact: true })).toBeVisible()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ presets: 43, savedID: saved.id, examples: ['VMware', ...examples.map(item => item[0])], errors }, null, 2))
} finally {
  await browser.close()
}

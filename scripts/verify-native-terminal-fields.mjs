import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

// Only run against an explicitly supplied isolated profile and database.
const { NETCATTY_SMOKE_PLAYWRIGHT, NETCATTY_SMOKE_DEBUG_URL, NETCATTY_SMOKE_DATA } = process.env
if (!NETCATTY_SMOKE_PLAYWRIGHT || !NETCATTY_SMOKE_DEBUG_URL || !NETCATTY_SMOKE_DATA) throw new Error('请显式设置隔离 Playwright、调试地址和数据目录')
const require = createRequire(import.meta.url)
const { chromium, expect } = require(NETCATTY_SMOKE_PLAYWRIGHT)
const browser = await chromium.connectOverCDP(NETCATTY_SMOKE_DEBUG_URL)
const context = browser.contexts()[0]
const page = context.pages().find(item => item.url() === 'app://netcatty/index.html')
assert.ok(page, '未找到隔离 Netcatty 窗口')
page.setDefaultTimeout(15000)
const errors = []
page.on('pageerror', error => errors.push(error.message))
const request = (path, method = 'GET', body) => page.evaluate(args => window.netcatty.cmdbRequest(args), { path, method, ...(body ? { body: JSON.stringify(body) } : {}) })
const demoCode = `SMOKE-TERMINAL-FIELDS-${Date.now()}`
const expected = { vendor: '隔离验收品牌', model: '隔离验收型号 A-20', os_type: '统信 UOS', os_version: '20 Professional 1070（隔离验收）' }

try {
  // Verify the launched process uses the requested test database before writing anything.
  const dataPath = resolve(NETCATTY_SMOKE_DATA)
  const storage = await request('/api/cmdb/attachment-storage')
  assert.ok(JSON.stringify(storage).includes(dataPath.replaceAll('\\', '\\\\')) || JSON.stringify(storage).includes(dataPath), '服务存储位置不在指定隔离目录')
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('netcatty.cmdb.cloudSync.v1') || '{}').enabled === true), false, '隔离验收不得启用云同步')
  const created = await request('/api/assets', 'POST', { asset_code: demoCode, asset_name: demoCode, device_type: '云桌面', box_sn: `${demoCode}-HOST`, display_sn: `${demoCode}-DISPLAY`, status: '在用', remark: '仅用于隔离 UI 验收，不对应真实资产' })
  assert.ok(created.id)
  await page.getByText('Cmdb', { exact: true }).first().click()
  const search = page.getByPlaceholder('搜索名称、资产编号、SN、IP 或使用人')
  await search.fill(demoCode)
  await search.press('Enter')
  const row = page.locator('tr').filter({ has: page.getByRole('button', { name: demoCode, exact: true }) })
  await row.getByRole('button', { name: `${demoCode} 的操作`, exact: true }).click()
  await page.getByRole('menuitem', { name: '编辑资产', exact: true }).click()
  const panel = page.locator('[data-section="cmdb-asset-panel"]')
  await panel.getByRole('tab', { name: '硬件信息', exact: true }).click()
  await panel.getByRole('combobox', { name: '品牌 / 厂商', exact: true }).fill(expected.vendor)
  await panel.getByRole('textbox', { name: '型号', exact: true }).click()
  await panel.getByRole('textbox', { name: '型号', exact: true }).fill(expected.model)
  assert.equal(await panel.locator('[data-hardware-field]').count(), 0, '云桌面不应出现计算硬件编辑器')
  await panel.getByRole('tab', { name: '网络与系统', exact: true }).click()
  await panel.getByRole('combobox', { name: '操作系统类型', exact: true }).fill('统信')
  await page.getByRole('option', { name: '统信 UOS', exact: true }).click()
  const version = panel.getByRole('textbox', { name: '操作系统版本', exact: true })
  await expect(version).toBeEditable()
  await version.click()
  await version.pressSequentially('20 Professional 1070')
  await expect(version).toHaveValue('20 Professional 1070')
  await version.press('End')
  await page.keyboard.insertText('（隔离验收）')
  await expect(version).toHaveValue(expected.os_version)
  await panel.getByRole('tab', { name: '基本信息', exact: true }).click()
  await panel.getByRole('tab', { name: '硬件信息', exact: true }).click()
  await expect(panel.getByRole('combobox', { name: '品牌 / 厂商', exact: true })).toHaveValue(expected.vendor)
  await expect(panel.getByRole('textbox', { name: '型号', exact: true })).toHaveValue(expected.model)
  await panel.getByRole('tab', { name: '网络与系统', exact: true }).click()
  await expect(version).toHaveValue(expected.os_version)
  await page.screenshot({ path: resolve(dataPath, 'terminal-fields-draft.png') })
  await panel.getByRole('button', { name: '保存', exact: true }).click()
  await expect(panel).toHaveCount(0)
  const detail = await request(`/api/assets/${created.id}`)
  const asset = detail.asset
  for (const [key, value] of Object.entries(expected)) assert.equal(asset[key], value, `${key} 未持久化`)
  assert.equal(asset.box_sn, `${demoCode}-HOST`)
  assert.equal(asset.display_sn, `${demoCode}-DISPLAY`)
  await row.getByRole('button', { name: `${demoCode} 的操作`, exact: true }).click()
  await page.getByRole('menuitem', { name: '编辑资产', exact: true }).click()
  await panel.getByRole('tab', { name: '硬件信息', exact: true }).click()
  await expect(panel.getByRole('combobox', { name: '品牌 / 厂商', exact: true })).toHaveValue(expected.vendor)
  await expect(panel.getByRole('textbox', { name: '型号', exact: true })).toHaveValue(expected.model)
  await panel.getByRole('tab', { name: '网络与系统', exact: true }).click()
  await expect(panel.getByRole('combobox', { name: '操作系统类型', exact: true })).toHaveValue(expected.os_type)
  await expect(version).toHaveValue(expected.os_version)
  await page.screenshot({ path: resolve(dataPath, 'terminal-fields-saved.png') })
  await panel.getByRole('button', { name: '取消', exact: true }).click()
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ databaseDirectory: dataPath, assetId: created.id, assetCode: demoCode, persisted: expected, screenshots: ['terminal-fields-draft.png', 'terminal-fields-saved.png'], pageErrors: errors }, null, 2))
} finally {
  await browser.close()
}

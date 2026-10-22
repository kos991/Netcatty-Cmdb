import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

// Only run against an explicitly supplied isolated profile and database.
const { NETCATTY_SMOKE_PLAYWRIGHT, NETCATTY_SMOKE_DEBUG_URL, NETCATTY_SMOKE_DATA, NETCATTY_SMOKE_SERVICE_URL } = process.env
if (!NETCATTY_SMOKE_PLAYWRIGHT || !NETCATTY_SMOKE_DEBUG_URL || !NETCATTY_SMOKE_DATA || !NETCATTY_SMOKE_SERVICE_URL) throw new Error('请显式设置隔离 Playwright、调试地址、数据目录和服务地址')
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
  await page.reload()
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
  const uniqueOctet = (Date.now() % 200) + 20
  const longAsset = {
    asset_code: `${demoCode}-LONG-CODE-ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789`,
    asset_name: `${demoCode}-超长设备名称用于验证列宽与完整标题保留-ABCDEFGHIJKLMNOPQRSTUVWXYZ`,
    box_sn: `SERIAL-${demoCode}-ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ`,
    device_type: '云桌面', vendor: '深信服', model: 'aDesk-STD-200H-s-超长型号-ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    os_type: '统信 UOS', os_version: '20 Professional 1070-ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    user_name: '隔离验收超长使用人名称', department: '隔离验收超长部门名称用于列宽验证',
    ip: `198.18.${uniqueOctet}.100`, terminal_ip: `198.18.${uniqueOctet}.101`, net_type: '内网', status: '在用',
  }
  await request('/api/assets', 'POST', longAsset)
  for (let index = 0; index < 21; index++) await request('/api/assets', 'POST', {
    asset_code: `${demoCode}-PAGE-${index}`, asset_name: `${demoCode}-分页-${index}`, device_type: '云桌面', status: '在用',
  })
  const workspace = page.locator('.cmdb-terminal-assets')
  const nextPage = workspace.getByRole('button', { name: '下一页', exact: true })
  await search.fill('')
  await search.fill(demoCode)
  await search.press('Enter')
  await expect(nextPage).toBeEnabled({ timeout: 15000 })

  await nextPage.click()
  await expect(workspace.getByRole('button', { name: '上一页', exact: true })).toBeEnabled()
  await workspace.getByRole('button', { name: '上一页', exact: true }).click()
  await search.fill(longAsset.asset_code)
  await search.press('Enter')
  const longRow = workspace.locator('tr').filter({ has: page.getByRole('button', { name: longAsset.asset_name, exact: true }) })
  await expect(longRow).toHaveCount(1)
  for (const title of [longAsset.asset_name, longAsset.model, longAsset.vendor]) assert.equal(await longRow.locator('[title]').evaluateAll((nodes, title) => nodes.some(node => node.title === title), title), true, `完整标题缺失：${title}`)
  const titleButton = longRow.getByRole('button', { name: longAsset.asset_name, exact: true })
  const dimensions = await titleButton.evaluate(node => ({ width: node.clientWidth, content: node.scrollWidth }))
  assert.ok(dimensions.content > dimensions.width, '超长名称应截断且完整标题保留')
  await page.screenshot({ path: resolve(dataPath, 'terminal-table-long-values.png') })
  await titleButton.click()
  const detailPanel = page.locator('[data-section="cmdb-asset-panel"]')
  for (const name of ['编辑资产', '调换使用人', '维修换件', '注销归档']) await expect(detailPanel.getByRole('button', { name, exact: true })).toBeEnabled()
  await longRow.getByRole('button', { name: `${longAsset.asset_name} 的操作`, exact: true }).click()
  for (const name of ['查看详情', '编辑资产', '调换使用人', '维修换件', '注销归档']) await expect(page.getByRole('menuitem', { name, exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.screenshot({ path: resolve(dataPath, 'terminal-table-side-panel-actions.png') })
  await page.getByRole('button', { name: '导入/导出', exact: true }).click()
  const exportItem = page.getByRole('button', { name: '导出当前筛选', exact: true })
  await expect(exportItem).toBeEnabled()
  await page.keyboard.press('Escape')
  const exportResponse = await fetch(`${NETCATTY_SMOKE_SERVICE_URL}/api/export/assets?keyword=${encodeURIComponent(longAsset.asset_code)}`)
  const exportBytes = new Uint8Array(await exportResponse.arrayBuffer())
  const exported = { status: exportResponse.status, contentType: exportResponse.headers.get('content-type'), size: exportBytes.length, signature: String.fromCharCode(...exportBytes.slice(0, 2)) }
  assert.equal(exported.status, 200)
  assert.ok(exported.contentType.includes('spreadsheetml.sheet'), '导出应为 Excel 文件')
  assert.equal(exported.signature, 'PK')
  assert.ok(exported.size > 0)
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ databaseDirectory: dataPath, assetId: created.id, assetCode: demoCode, persisted: expected, layout: { truncatedName: dimensions, search: true, pagination: true, exportRequest: exported, sidePanelActions: true }, screenshots: ['terminal-fields-draft.png', 'terminal-fields-saved.png', 'terminal-table-long-values.png', 'terminal-table-side-panel-actions.png'], pageErrors: errors }, null, 2))
} finally {
  await browser.close()
}

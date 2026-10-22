import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(new URL('../build/native-ui-test-tools/package.json', import.meta.url))
const { chromium } = require('playwright')
const browser = await chromium.connectOverCDP('http://127.0.0.1:9241')
const context = browser.contexts()[0]
const main = context.pages().find((page) => page.url() === 'app://netcatty/index.html')
assert.ok(main, '未找到隔离 Netcatty 测试窗口')
const preview = new URL('../build/native-settings-preview/', import.meta.url)
const errors = []
const screenshot = async (page, name) => {
  if (process.env.CMDB_SKIP_SCREENSHOTS === '1') return
  await page.screenshot({ path: fileURLToPath(new URL(name, preview)), timeout: 30000 })
}
main.on('pageerror', (error) => errors.push(error.message))
main.setDefaultTimeout(12000)

async function captureAsset(kind, expectedHeaders, fileName) {
  await main.getByRole('combobox', { name: '资产类别' }).click()
  await main.getByRole('option', { name: kind, exact: true }).click()
  const table = main.locator('[data-cmdb-native] table').first()
  await table.getByRole('columnheader', { name: expectedHeaders[0] }).waitFor()
  const headers = await table.locator('th').allTextContents()
  for (const header of expectedHeaders) assert.ok(headers.some((value) => value.trim() === header), `${kind} 缺少 ${header} 列`)
  assert.ok(!headers.some((value) => value.includes('IP / 网络')), `${kind} 仍合并 IP 和网络`)
  const last = table.getByRole('columnheader', { name: '操作', exact: true })
  assert.equal(await last.evaluate((node) => node.getBoundingClientRect().right <= innerWidth + 1), true, `${kind} 操作列不可见`)
  await screenshot(main, fileName)
  await main.setViewportSize({ width: 1024, height: 720 })
  assert.equal(await last.evaluate((node) => node.getBoundingClientRect().right <= innerWidth + 1), true, `${kind} 窄窗口操作列不可见`)
  for (const label of expectedHeaders.filter((value) => value.includes('IP') || value === '网络类型')) {
    const header = table.getByRole('columnheader', { name: label, exact: true })
    await header.waitFor()
    assert.equal(await header.evaluate((node) => { const bounds = node.getBoundingClientRect(); return bounds.left >= 0 && bounds.right <= innerWidth + 1 }), true, `${kind} 窄窗口 ${label} 列不可见`)
  }
  await screenshot(main, fileName.replace('.png', '-1024.png'))
  await main.setViewportSize({ width: 1440, height: 820 })
  return headers.map((value) => value.trim())
}

try {
  await main.setViewportSize({ width: 1440, height: 820 })
  await main.reload()
  await main.locator('[data-tab-id="cmdb"]').click()
  await main.locator('[data-cmdb-native]').waitFor()
  const sidebar = main.locator('[data-section="cmdb-sidebar"]')
  assert.equal(await sidebar.getByRole('button', { name: '配置中心' }).count(), 0)

  let settings = context.pages().find((page) => page.url().includes('#/settings'))
  if (!settings) {
    const settingsOpened = context.waitForEvent('page')
    await main.evaluate(() => window.netcatty.openSettingsWindow())
    settings = await settingsOpened
  }
  settings.on('pageerror', (error) => errors.push(error.message))
  settings.setDefaultTimeout(12000)
  settings.setDefaultNavigationTimeout(30000)
  await settings.reload()
  await settings.getByRole('tab', { name: 'Cmdb', exact: true }).click()
  assert.equal(await settings.getByRole('combobox', { name: '配置项目' }).count(), 0)
  await settings.getByRole('tab', { name: '资产配置', exact: true }).waitFor()
  await settings.getByRole('tab', { name: '工单配置', exact: true }).waitFor()
  await settings.getByRole('tab', { name: '项目与数据', exact: true }).waitFor()
  assert.equal(await settings.getByRole('tab', { name: '资产配置', exact: true }).getAttribute('aria-selected'), 'true')
  assert.equal(await settings.getByRole('button', { name: '维护类型' }).count(), 0)
  await settings.locator('[data-section="cmdb-settings-catalog"]').waitFor()
  await settings.locator('[data-section="cmdb-settings-network"]').waitFor()
  for (const button of await settings.locator('[data-section="cmdb-settings-assets"]').getByRole('button', { name: '编辑', exact: true }).all()) {
    assert.equal(await button.evaluate((node) => {
      const bounds = node.getBoundingClientRect()
      return bounds.left >= 0 && bounds.right <= innerWidth
    }), true, '资产配置编辑按钮被内容挤出窗口')
  }
  assert.equal(await settings.locator('[data-section="cmdb-settings-work-orders"]').count(), 0)
  assert.equal(await settings.locator('[data-section="cmdb-settings-project"]').count(), 0)
  await screenshot(settings, 'settings-types.png')

  if (!await settings.locator('[data-section="cmdb-settings-catalog"]').getByText('验收终端类型').count()) {
    await settings.locator('[data-section="cmdb-settings-catalog"]').getByText('终端设备类型').locator('..').getByRole('button', { name: '编辑' }).click()
    const dialog = settings.getByRole('dialog', { name: '设备类型管理' })
    await dialog.getByRole('button', { name: '新增大类' }).click()
    await dialog.locator('#taxonomy-name').fill('验收终端类型')
    await dialog.getByRole('button', { name: '保存', exact: true }).click()
    await settings.locator('[data-section="cmdb-settings-catalog"]').getByText('验收终端类型').waitFor()
    await settings.keyboard.press('Escape')
  }
  await main.getByRole('combobox', { name: '类型' }).click()
  await main.getByRole('option', { name: '验收终端类型', exact: true }).waitFor()
  await main.keyboard.press('Escape')

  const terminal = await captureAsset('终端资产', ['资产名称', 'IP 地址', '网络类型', '设备状态', '操作'], 'terminal-assets.png')
  const terminalRow = main.locator('[data-cmdb-native] table tbody tr').filter({ hasText: '验收云桌面' })
  assert.equal(await terminalRow.count(), 1)
  assert.match(await terminalRow.innerText(), /10\.20\.30\.10[\s\S]*172\.16\.8\.10/)
  const infrastructure = await captureAsset('基础设施', ['资产名称', '管理 IP', '网络类型', '设备状态', '操作'], 'infrastructure-assets.png')
  const systems = await captureAsset('业务系统', ['系统名称 / 版本', '业务 IP', '网络类型', '状态', '操作'], 'systems-assets.png')
  await sidebar.getByRole('button', { name: '机柜与网络' }).click()
  await main.locator('[data-network-view="ip"]').click()
  await main.locator('[data-ipam-subnet-selector]').getByText('验收业务内网').waitFor()
  await main.getByRole('button', { name: '10.20.30.10 已占用' }).waitFor()
  await screenshot(main, 'ipam-linked-assets.png')

  await settings.getByRole('tab', { name: '项目与数据', exact: true }).click()
  await settings.locator('[data-section="cmdb-settings-project"]').waitFor()
  await settings.locator('[data-section="cmdb-cloud-sync-settings"]').waitFor()
  await settings.getByRole('heading', { name: '项目设置' }).scrollIntoViewIfNeeded()
  await screenshot(settings, 'settings-project.png')
  assert.equal(await settings.getByRole('button', { name: '下载模板' }).count(), 3)
  await settings.getByRole('tab', { name: '资产配置', exact: true }).click()
  await settings.locator('[data-section="cmdb-settings-network"]').getByRole('button', { name: '编辑' }).click()
  await settings.getByRole('button', { name: '新增网络类型' }).click()
  const networkEditor = settings.getByRole('dialog', { name: '新增网络类型' })
  const networkName = `验收网络类型-${Date.now()}`
  await networkEditor.getByRole('textbox', { name: '名称' }).fill(networkName)
  await networkEditor.getByRole('button', { name: '保存', exact: true }).click()
  await networkEditor.waitFor({ state: 'hidden' })
  await settings.getByPlaceholder('搜索网络类型').fill(networkName)
  await settings.getByText(networkName, { exact: true }).waitFor()
  await settings.keyboard.press('Escape')
  const modelSection = settings.locator('[data-section="cmdb-settings-models"]')
  await modelSection.getByRole('button', { name: '编辑' }).click()
  await settings.getByRole('button', { name: '新增型号' }).click()
  const modelEditor = settings.getByRole('dialog', { name: '新增型号' })
  const modelName = `验收型号-${Date.now()}`
  await modelEditor.getByRole('textbox', { name: '品牌 / 厂商' }).fill('验收厂商')
  await modelEditor.getByRole('textbox', { name: '型号' }).fill(modelName)
  await modelEditor.getByRole('button', { name: '保存', exact: true }).click()
  await modelEditor.waitFor({ state: 'hidden' })
  await settings.getByPlaceholder('搜索型号').fill(modelName)
  await settings.getByText(modelName, { exact: true }).waitFor()
  await settings.keyboard.press('Escape')
  await settings.getByRole('tab', { name: '工单配置', exact: true }).click()
  const categorySection = settings.locator('[data-section="cmdb-settings-work-order-categories"]')
  await categorySection.getByRole('button', { name: '编辑' }).click()
  await settings.getByRole('button', { name: '新增工单类别' }).click()
  const categoryEditor = settings.getByRole('dialog', { name: '新增工单类别' })
  const categoryName = `验收类别-${Date.now()}`
  await categoryEditor.getByRole('textbox', { name: '名称' }).fill(categoryName)
  await categoryEditor.getByRole('button', { name: '保存', exact: true }).click()
  await categoryEditor.waitFor({ state: 'hidden' })
  await settings.getByPlaceholder('搜索工单类别').fill(categoryName)
  await settings.getByText(categoryName, { exact: true }).waitFor()
  await settings.keyboard.press('Escape')
  await settings.locator('[data-section="cmdb-settings-work-orders"]').getByRole('button', { name: '编辑' }).first().click()
  await settings.getByRole('dialog', { name: '编辑工单编号规则' }).getByRole('button', { name: '保存规则' }).click()
  await settings.getByText('编号规则已保存').waitFor()
  await main.evaluate(() => { document.title = 'Cmdb 测试机' })
  await main.bringToFront()
  assert.equal(errors.length, 0, `页面脚本错误：${errors.join('; ')}`)
  console.log(JSON.stringify({ terminal, infrastructure, systems, screenshots: ['settings-types.png', 'terminal-assets.png', 'infrastructure-assets.png', 'systems-assets.png', 'ipam-linked-assets.png'], errors }, null, 2))
} finally {
  await browser.close()
}

import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(new URL('../build/native-ui-test-tools/package.json', import.meta.url))
const { chromium } = require('playwright')
const browser = await chromium.connectOverCDP('http://127.0.0.1:9224')
const page = browser.contexts()[0].pages().find((item) => item.url() === 'app://netcatty/index.html')
assert.ok(page, '未找到 Netcatty 测试窗口')
page.setDefaultTimeout(15000)

try {
  await page.setViewportSize({ width: 1536, height: 824 })
  await page.reload()
  const cmdbTab = page.locator('[data-tab-id="cmdb"]')
  if (await cmdbTab.count()) await cmdbTab.click()

  const header = page.locator('[data-section="cmdb-device-assets-header"]')
  const search = header.getByPlaceholder('搜索资产编码、名称、SN、IP、品牌、型号或供应商')
  const filter = header.getByRole('button', { name: '选择筛选项' })
  const transfer = header.getByRole('button', { name: '导入/导出' })
  const taxonomy = header.getByRole('button', { name: '分类与分组管理' })
  await filter.waitFor()
  for (const button of [filter, transfer, taxonomy]) {
    assert.equal(await button.locator('svg').count(), 1, '顶部操作应使用图标')
    assert.equal((await button.innerText()).trim(), '', '顶部操作不应显示文字')
    assert.ok(await button.getAttribute('title'), '图标按钮需要悬停提示')
  }
  assert.equal(await header.getByRole('button', { name: '刷新当前资产列表' }).count(), 0)

  const searchBox = await search.boundingBox()
  const filterBox = await filter.boundingBox()
  const transferBox = await transfer.boundingBox()
  const taxonomyBox = await taxonomy.boundingBox()
  assert.ok(searchBox && filterBox && transferBox && taxonomyBox)
  assert.ok(searchBox.x + searchBox.width <= filterBox.x && filterBox.x < transferBox.x && transferBox.x < taxonomyBox.x, '顶部工具应在搜索框右侧依次排列')
  assert.ok(Math.abs(searchBox.y - filterBox.y) < 2, '宽窗口顶部工具应与搜索框同一行')

  const category = page.getByRole('combobox', { name: '资产类别' })
  for (const [tab, expectedFilter, expectedImport] of [
    ['终端资产', '设备分类', '导入终端资产'],
    ['基础设施', '设备类型', '导入基础设施'],
    ['业务系统', '系统分类', '导入设备信息'],
  ]) {
    await category.click()
    await page.getByRole('option', { name: tab }).click()
    await filter.click()
    await page.getByText(expectedFilter, { exact: true }).last().waitFor()
    await page.keyboard.press('Escape')
    await transfer.click()
    await page.getByRole('button', { name: expectedImport }).waitFor()
    await page.getByRole('button', { name: '导出当前筛选' }).waitFor()
    await page.keyboard.press('Escape')
  }

  await taxonomy.click()
  await page.getByRole('heading', { name: '分类与分组管理' }).waitFor()
  await page.keyboard.press('Escape')

  await page.setViewportSize({ width: 860, height: 720 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, '窄窗口不应出现横向溢出')
  const screenshot = fileURLToPath(new URL('../build/native-ui-preview/cmdb-asset-toolbar.png', import.meta.url))
  await page.screenshot({ path: screenshot, fullPage: true })
  await page.setViewportSize({ width: 1536, height: 824 })
  await category.click()
  await page.getByRole('option', { name: '终端资产', exact: true }).click()
  await filter.waitFor()
  const wideScreenshot = fileURLToPath(new URL('../build/native-ui-preview/cmdb-asset-toolbar-wide.png', import.meta.url))
  await page.screenshot({ path: wideScreenshot, fullPage: true })
  console.log(JSON.stringify({ tabs: ['终端资产', '基础设施', '业务系统'], screenshot, wideScreenshot }, null, 2))
} finally {
  await browser.close()
}

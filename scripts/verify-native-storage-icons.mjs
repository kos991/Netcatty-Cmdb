import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(new URL('../build/native-ui-test-tools/package.json', import.meta.url))
const { chromium } = require('playwright')
const browser = await chromium.connectOverCDP('http://127.0.0.1:9224')
const page = browser.contexts()[0].pages().find((item) => item.url() === 'app://netcatty/index.html')
assert.ok(page, '未找到 Netcatty 测试窗口')
page.setDefaultTimeout(15000)
const pageErrors = []
page.on('pageerror', (error) => pageErrors.push(error.message))

try {
  await page.setViewportSize({ width: 1536, height: 824 })
  await page.reload()
  const cmdbTab = page.locator('[data-tab-id="cmdb"]')
  if (await cmdbTab.count()) await cmdbTab.click()
  const category = page.getByRole('combobox', { name: '资产类别' })
  await category.click()
  await page.getByRole('option', { name: '基础设施' }).click()
  const search = page.getByPlaceholder('搜索资产编码、名称、SN、IP、品牌、型号或供应商')
  await search.fill('存储')
  await search.press('Enter')

  const expected = [
    ['备份存储阵列', 'huawei'],
    ['Dell EMC PowerStore 存储', 'dellemc'],
    ['NetApp ONTAP 存储', 'netapp'],
    ['HPE Alletra 存储', 'hpe'],
    ['浪潮集中式存储', 'inspur'],
    ['群晖备份存储', 'synology'],
    ['QNAP 文件存储', 'qnap'],
    ['Pure Storage 全闪存阵列', 'purestorage'],
    ['通用存储设备', 'storage'],
  ]
  const results = []
  for (const [name, distro] of expected) {
    const row = page.locator('tr').filter({ hasText: name }).first()
    await row.waitFor()
    const presentation = row.locator(`[data-os-distro="${distro}"]`)
    assert.equal(await presentation.count(), 1, `${name} 未显示 ${distro} 图标`)
    const rendered = await presentation.evaluate((element) => {
      const image = element.querySelector('img')
      return image ? image.complete && image.naturalWidth > 0 : Boolean(element.querySelector('[data-os-icon]'))
    })
    assert.equal(rendered, true, `${name} 的图标资源未成功渲染`)
    results.push({ name, distro })
  }

  const filteredScreenshot = fileURLToPath(new URL('../build/native-ui-preview/cmdb-storage-vendor-icons-filtered.png', import.meta.url))
  await page.screenshot({ path: filteredScreenshot, fullPage: true })

  await search.fill('')
  await search.press('Enter')
  const preserved = [
    ['核心交换机 A', 'h3c'],
    ['边界防火墙', 'sangfor'],
    ['山石网科防火墙', 'hillstone'],
    ['虚拟化节点 01', 'rocky'],
  ]
  for (const [name, distro] of preserved) {
    const row = page.locator('tr').filter({ hasText: name }).first()
    await row.waitFor()
    assert.equal(await row.locator(`[data-os-distro="${distro}"]`).count(), 1, `${name} 的既有图标回归失败`)
  }

  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, '页面出现横向溢出')
  assert.deepEqual(pageErrors, [], '页面发生运行时异常')
  const screenshot = fileURLToPath(new URL('../build/native-ui-preview/cmdb-storage-vendor-icons-final.png', import.meta.url))
  await page.screenshot({ path: screenshot, fullPage: true })
  console.log(JSON.stringify({ results, preserved, pageErrors, screenshot, filteredScreenshot }, null, 2))
} finally {
  await browser.close()
}

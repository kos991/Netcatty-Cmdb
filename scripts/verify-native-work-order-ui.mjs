import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(new URL('../build/native-ui-test-tools/package.json', import.meta.url))
const { chromium } = require('playwright')
const browser = await chromium.connectOverCDP('http://127.0.0.1:9224')
const page = browser.contexts()[0].pages().find((item) => item.url() === 'app://netcatty/index.html')
assert.ok(page, '未找到 Netcatty 测试窗口')
page.setDefaultTimeout(12000)

const pageErrors = []
page.on('pageerror', (error) => pageErrors.push(error.message))

const openCmdb = async () => {
  await page.reload()
  await page.locator('[data-tab-id="cmdb"]').click()
  await page.locator('[data-section="cmdb-sidebar"]').getByRole('button', { name: '工单与统计' }).click()
  await page.locator('[data-work-order-mode-trigger]').waitFor()
  await page.getByRole('table').waitFor()
}

try {
  await page.setViewportSize({ width: 1536, height: 824 })
  await openCmdb()

  // 默认进入统计查询页，工单编号和八个核心字段按确认顺序显示。
  assert.equal(await page.locator('[data-work-order-stats]').count(), 1, '默认页应展示工单流程')
  const headers = (await page.getByRole('columnheader').allTextContents()).map((value) => value.trim()).filter(Boolean)
  assert.deepEqual(headers.slice(0, 8), ['工单号', '优先级', '维护主题', '维护类型', '关联资产', '处理时间', '维护人员', '维护状态'])
  await page.getByPlaceholder('搜索工单号或主题').waitFor()
  await page.locator('[data-work-orders-filter]').waitFor()
  await page.getByRole('button', { name: '导出工单' }).waitFor()

  // 新建入口打开弹窗，不切走默认查询列表。
  await page.locator('[data-work-order-mode-trigger]').click()
  await page.locator('[data-work-order-mode-option="create"]').click()
  const orderDialog = page.locator('[data-work-order-create-dialog]')
  await orderDialog.waitFor()
  await page.getByRole('heading', { name: '受理信息' }).waitFor()
  const editor = page.locator('[data-work-order-editor]')
  await editor.waitFor()
  assert.equal(await orderDialog.evaluate((element) => element.scrollWidth <= element.clientWidth), true, '工单弹窗不得横向溢出')
  await page.locator('#cmdb-work-order-form').waitFor()
  await page.getByRole('button', { name: '筛选关联资源' }).waitFor()
  await page.getByRole('button', { name: '选择附件' }).waitFor()
  await page.getByRole('button', { name: '创建工单' }).waitFor()
  await orderDialog.getByRole('button', { name: '取消', exact: true }).click()
  await orderDialog.waitFor({ state: 'hidden' })

  // 批量关闭入口只允许已解决工单，未选择时不可见。
  assert.equal(await page.getByRole('button', { name: '批量关闭' }).count(), 0, '未选择工单时不应显示批量关闭')
  const firstRowCheckbox = page.getByRole('checkbox', { name: '选择此行' }).first()
  if (await firstRowCheckbox.count()) {
    await firstRowCheckbox.check()
    const batchClose = page.getByRole('button', { name: '批量关闭' })
    await batchClose.waitFor()
    const row = firstRowCheckbox.locator('xpath=ancestor::tr')
    const status = (await row.locator('td').nth(8).innerText()).trim().split('\n')[0]
    assert.equal(await batchClose.isDisabled(), status !== '已解决', '批量关闭必须限制为已解决状态')
    await firstRowCheckbox.uncheck()
  }

  // IPAM 顶部保留搜索和数据操作，但不再显示无用的筛选入口。
  await page.locator('[data-section="cmdb-sidebar"] button[aria-label="机柜与网络"]').click()
  await page.locator('[data-network-view="ip"]').click()
  const ipamHeader = page.locator('[data-section="cmdb-ipam-header"]')
  await ipamHeader.getByPlaceholder(/搜索 IP/).waitFor()
  await ipamHeader.getByRole('button', { name: '导入\/导出' }).waitFor()
  assert.equal(await ipamHeader.locator('[data-ipam-filter]').count(), 0, 'IPAM 不应显示筛选入口')

  assert.deepEqual(pageErrors, [], '桌面页面发生运行时异常')
  console.log('工单流程/列表顺序/新建弹窗、批量关闭限制及 IPAM 顶部布局检查通过')
} finally {
  await browser.close()
}

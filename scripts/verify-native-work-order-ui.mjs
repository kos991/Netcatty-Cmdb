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
  await page.getByRole('heading', { name: '受理信息' }).waitFor()
}

try {
  await page.setViewportSize({ width: 1536, height: 824 })
  await openCmdb()

  // 新建页只保留居中的表单，不显示查询控件或旧的左右列表。
  await page.getByRole('heading', { name: '新建工单' }).waitFor()
  assert.equal(await page.locator('[data-work-orders-filter]').count(), 0, '新建页不应显示筛选按钮')
  assert.equal(await page.getByPlaceholder('搜索工单号或主题').count(), 0, '新建页不应显示工单搜索框')
  assert.equal(await page.locator('[data-work-order-list]').count(), 0, '新建页不应显示旧工单列表')
  const editor = page.locator('[data-work-order-editor]')
  await editor.waitFor()
  const formFrame = editor.locator('> div').first()
  const editorBox = await editor.boundingBox()
  const formFrameBox = await formFrame.boundingBox()
  assert.ok(editorBox && formFrameBox && formFrameBox.width <= 1000 && formFrameBox.x > editorBox.x, '新建工单表单应限制宽度并居中')
  await page.locator('#cmdb-work-order-form').waitFor()
  await page.getByRole('button', { name: '筛选关联资源' }).waitFor()
  await page.getByRole('button', { name: '选择附件' }).waitFor()
  await page.getByRole('button', { name: '创建工单' }).waitFor()

  // 查询页才显示搜索、筛选、导出和批量完成。
  const modeButton = page.locator('[data-work-order-mode-trigger]')
  await modeButton.click()
  await page.locator('[data-work-order-mode-option="stats"]').click()
  await page.getByRole('table').waitFor()
  await page.getByPlaceholder('搜索工单号或主题').waitFor()
  await page.locator('[data-work-orders-filter]').waitFor()
  await page.getByRole('button', { name: '导出工单' }).waitFor()
  assert.equal(await page.getByRole('button', { name: '批量完成' }).count(), 0, '未选择工单时不应显示批量完成')

  const firstRowCheckbox = page.getByRole('checkbox', { name: '选择此行' }).first()
  if (await firstRowCheckbox.count()) {
    await firstRowCheckbox.check()
    await page.getByRole('button', { name: '批量完成' }).waitFor()
    await page.getByRole('button', { name: '批量完成' }).click()
    await page.getByRole('heading', { name: '结束工单' }).waitFor()
    await page.getByRole('button', { name: '取消' }).click()
  }

  // IPAM 顶部保留搜索和数据操作，但不再显示无用的筛选入口。
  await page.locator('[data-section="cmdb-sidebar"] button[aria-label="IPAM/IP"]').click()
  const ipamHeader = page.locator('[data-section="cmdb-ipam-header"]')
  await ipamHeader.getByPlaceholder(/搜索 IP/).waitFor()
  await ipamHeader.getByRole('button', { name: '导入\/导出' }).waitFor()
  assert.equal(await ipamHeader.locator('[data-ipam-filter]').count(), 0, 'IPAM 不应显示筛选入口')

  assert.deepEqual(pageErrors, [], '桌面页面发生运行时异常')
  console.log('工单新建/查询、批量完成及 IPAM 顶部布局检查通过')
} finally {
  await browser.close()
}

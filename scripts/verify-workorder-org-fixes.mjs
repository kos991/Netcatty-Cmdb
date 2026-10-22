import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(new URL('../build/native-ui-test-tools/package.json', import.meta.url))
const { chromium } = require('playwright')
const browser = await chromium.connectOverCDP('http://127.0.0.1:9224')
const page = browser.contexts()[0].pages().find((item) => item.url() === 'app://netcatty/index.html')
assert.ok(page, '未找到唯一 Netcatty 测试窗口')
page.setDefaultTimeout(12000)
const errors = []
page.on('pageerror', (error) => errors.push(error.message))

try {
  await page.reload()
  await page.locator('[data-tab-id="cmdb"]').click()
  const sidebar = page.locator('[data-section="cmdb-sidebar"]')
  await sidebar.getByRole('button', { name: '组织架构' }).click()
  const people = page.locator('[data-people-directory]')
  const departmentButton = people.locator('aside button').filter({ has: page.getByText('技术部', { exact: true }) })
  await departmentButton.click()
  await people.getByText('1 人', { exact: true }).waitFor()
  assert.match(await departmentButton.innerText(), /技术部\s+1$/, '组织树人数与人员列表不一致')
  const visiblePeople = await people.getByRole('table').locator('tbody tr').count()
  assert.equal(visiblePeople, 1, '技术部人数与名单不一致')

  await sidebar.getByRole('button', { name: '工单与统计' }).click()
  await page.locator('[data-work-order-mode-trigger]').click()
  await page.locator('[data-work-order-mode-option="create"]').click()
  const createDialog = page.locator('[data-work-order-create-dialog]')
  await createDialog.waitFor()
  assert.equal(await createDialog.getByLabel('处理结果').count(), 0, '新建工单不应录入处理结果')
  assert.equal(await createDialog.getByLabel('工时（分钟）').count(), 0, '新建工单不应录入工时')
  await createDialog.getByRole('button', { name: '取消', exact: true }).click()

  await page.getByRole('button', { name: '编辑工单' }).first().click()
  const editDialog = page.locator('[data-work-order-edit-dialog]')
  await editDialog.waitFor()
  assert.equal(await editDialog.evaluate((element) => element.scrollWidth <= element.clientWidth), true, '编辑工单横向溢出')
  assert.equal(await editDialog.getByLabel('工时（分钟）').isDisabled(), true, '已关闭工单工时必须只读')
  const previewButton = editDialog.getByRole('button', { name: /预览图片/ }).first()
  await previewButton.waitFor()
  await previewButton.click()
  const image = page.getByRole('img', { name: /\.png$/ }).first()
  await image.waitFor()
  assert.equal(await image.evaluate((element) => element.complete && element.naturalWidth > 0), true, '附件图片未正常显示')
  assert.deepEqual(errors, [], 'Netcatty 页面运行异常')
  console.log('测试机组织人数、工单创建字段、编辑布局与图片附件预览通过')
} finally {
  await browser.close()
}

import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const require = createRequire(new URL('../build/native-ui-test-tools/package.json', import.meta.url))
const { chromium } = require('playwright')
const browser = await chromium.connectOverCDP('http://127.0.0.1:9238')
const page = browser.contexts()[0].pages().find((item) => item.url() === 'app://netcatty/index.html')
assert.ok(page, '未找到隔离 Netcatty 测试窗口')
page.setDefaultTimeout(12000)
const output = new URL('../build/native-asset-layout-preview/', import.meta.url)
const checks = []
const failures = []
const nonce = Date.now()
const subnetName = `弹窗验收网段-${nonce}`
const renamedSubnet = `已编辑网段-${nonce}`
const subject = `弹窗验收工单-${nonce}`
let subnetId = 0
let ipId = 0
let orderId = 0
const request = (path, method = 'GET', body) => page.evaluate(({ path, method, body }) => window.netcatty.cmdbRequest({ path, method, ...(body ? { body: JSON.stringify(body) } : {}) }), { path, method, body })
const subnetDialog = page.locator('[data-subnet-maintenance]')
const orderDialog = page.locator('[data-work-order-create-dialog]')
const sidebar = page.locator('[data-section="cmdb-sidebar"]')

async function openSubnet(action = 'maintain') {
  await page.locator('[data-ipam-add-subnet]').click()
  await page.locator(`[data-ipam-subnet-menu-item="${action}"]`).click()
  await subnetDialog.waitFor()
}

async function openOrder() {
  await page.locator('[data-work-order-mode-trigger]').click()
  await page.locator('[data-work-order-mode-option="create"]').click()
  await orderDialog.waitFor()
}

async function selectSubnet(name) {
  await page.locator('[data-ipam-subnet-selector]').click()
  await page.locator('[data-ipam-subnet-option]').filter({ hasText: name }).click()
}

async function captureDialog(dialog, stem) {
  await page.locator('div.fixed.bottom-4.right-4').waitFor({ state: 'hidden' })
  for (const [size, suffix] of [[{ width: 1536, height: 824 }, 'desktop'], [{ width: 600, height: 720 }, 'narrow']]) {
    await page.setViewportSize(size)
    await page.waitForFunction((selector) => {
      const box = document.querySelector(selector)?.getBoundingClientRect()
      return box && box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight
    }, stem === 'subnet-maintenance' ? '[data-subnet-maintenance]' : '[data-work-order-create-dialog]')
    assert.equal(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth), true, '弹窗不得横向溢出')
    await dialog.getByRole('button', { name: stem === 'subnet-maintenance' ? '保存' : '创建工单', exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: fileURLToPath(new URL(`${stem}-${suffix}.png`, output)) })
  }
  await page.setViewportSize({ width: 1536, height: 824 })
}

async function captureWorkbench(stem) {
  await page.locator('div.fixed.bottom-4.right-4').waitFor({ state: 'hidden' })
  for (const [size, suffix] of [[{ width: 1536, height: 824 }, 'desktop'], [{ width: 600, height: 720 }, 'narrow']]) {
    await page.setViewportSize(size)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, '工作台不得让整个窗口横向溢出')
    await page.screenshot({ path: fileURLToPath(new URL(`${stem}-${suffix}.png`, output)) })
  }
  await page.setViewportSize({ width: 1536, height: 824 })
}

try {
  assert.equal((await (await fetch('http://127.0.0.1:18082/api/health')).json()).status, 'ok')
  await page.setViewportSize({ width: 1536, height: 824 })
  await page.reload()
  await page.locator('[data-tab-id="cmdb"]').click()

  await sidebar.getByRole('button', { name: '工单与统计', exact: true }).click()
  await page.locator('[data-work-order-mode-trigger]').waitFor()
  try {
    assert.equal(await page.locator('[data-cmdb-native] table').count(), 1, '进入工单模块默认必须显示工单列表')
    assert.equal(await page.locator('[data-work-order-stats]').count(), 1, '进入工单模块默认必须显示统计区域')
    assert.equal(await orderDialog.count(), 0, '进入工单模块不得自动打开新建弹窗')
    await openOrder()
    assert.equal(await page.locator('[data-work-order-mode-option]').count(), 0)
    await orderDialog.getByRole('button', { name: '取消', exact: true }).click()
    await orderDialog.waitFor({ state: 'hidden' })
    checks.push('默认工单列表；菜单新建才打开居中弹窗；取消后回到列表')
  } catch (error) { failures.push(error.message) }

  await page.keyboard.press('Escape')
  await sidebar.getByRole('button', { name: '机柜与网络', exact: true }).click()
  try {
    await page.locator('[data-section="cmdb-ipam-header"] [data-rack-search]').waitFor()
    assert.equal(await page.locator('[data-ipam-add-subnet]').count(), 0, '默认机柜视图不显示网段操作')
    checks.push('机柜与网络默认进入机柜视图')
  } catch (error) { failures.push(error.message) }
  await page.locator('[data-network-view="ip"]').click()
  await page.locator('[data-ipam-add-subnet]').waitFor()
  try {
    assert.equal(await page.locator('[data-ipam-subnet-selector]').count(), 1, 'IPAM 网段选择必须融入右侧顶部工具栏')
    assert.equal(await page.locator('aside[aria-label="网络与地址空间"]').count(), 0, 'IPAM 不得保留左侧网络与地址空间栏')
    assert.equal(await page.locator('[data-section="cmdb-ipam-header"] [data-ipam-subnet-selector]').count(), 1, '网段选择器必须位于 IPAM 顶部工具栏')
    await page.locator('[data-ipam-add-subnet]').click()
    assert.equal(await page.locator('[data-ipam-subnet-menu-item]').count(), 3, '新增网段按钮必须先打开三个菜单入口')
    await page.locator('[data-ipam-subnet-menu-item="create"]').click()
    await subnetDialog.waitFor()
    assert.equal(await subnetDialog.getByRole('heading', { name: '新增网段', exact: true }).count(), 1)
    assert.equal(await page.locator('[data-cmdb-native] aside button[aria-label="网段管理"]').count(), 0, '左侧不得重复放网段设置按钮')
    await page.keyboard.press('Escape')
    await subnetDialog.waitFor({ state: 'hidden' })
    checks.push('新增网段单按钮下拉；新增和维护均居中弹窗；无左侧重复设置按钮')
  } catch (error) { failures.push(error.message) }
  assert.deepEqual(failures, [], '入口交互不符合已确认要求')
  if (!process.argv.includes('--entry-only')) {
    await openSubnet('create')
    await subnetDialog.getByRole('textbox', { name: '网段名称', exact: true }).fill(subnetName)
    await subnetDialog.getByRole('combobox', { name: '网络类型', exact: true }).click()
    await page.getByRole('option', { name: '专网', exact: true }).click()
    await subnetDialog.getByRole('textbox', { name: 'CIDR', exact: true }).fill('192.0.2.0/29')
    await subnetDialog.getByRole('textbox', { name: '网关', exact: true }).fill('192.0.2.1')
    await subnetDialog.getByRole('textbox', { name: 'VLAN', exact: true }).fill('120')
    await subnetDialog.getByRole('textbox', { name: 'VXLAN VNI', exact: true }).fill('10120')
    await subnetDialog.getByRole('button', { name: '保存', exact: true }).click()
    await subnetDialog.getByText(subnetName, { exact: true }).waitFor()
    const subnet = (await request('/api/ip_subnets')).list.find((item) => item.name === subnetName)
    assert.ok(subnet?.id, '新增网段必须写入真实数据库')
    subnetId = subnet.id
    assert.equal(subnet.vlan, '120')
    assert.equal(subnet.vni, '10120')
    await page.keyboard.press('Escape')
    await subnetDialog.waitFor({ state: 'hidden' })
    await selectSubnet(subnetName)
    await page.getByRole('button', { name: '192.0.2.0 网络地址（不可分配）', exact: true }).waitFor()
    await page.getByRole('button', { name: '192.0.2.7 广播地址（不可分配）', exact: true }).waitFor()
    ipId = (await request('/api/ip_pool', 'POST', { subnet: subnetName, ip: '192.0.2.2', status: '保留', remark: '弹窗验收预留' })).id
    assert.ok(ipId)
    await openSubnet()
    await subnetDialog.getByText(subnetName, { exact: true }).click()
    await subnetDialog.getByRole('textbox', { name: '网段名称', exact: true }).fill(renamedSubnet)
    await subnetDialog.getByRole('button', { name: '保存', exact: true }).click()
    await subnetDialog.getByText(renamedSubnet, { exact: true }).waitFor()
    assert.equal((await request(`/api/ip_pool?keyword=192.0.2.2&subnet=${encodeURIComponent(renamedSubnet)}`)).list[0].subnet, renamedSubnet)
    await subnetDialog.getByRole('button', { name: '删除', exact: true }).click()
    await page.getByRole('dialog', { name: '删除网段', exact: true }).getByRole('button', { name: '删除', exact: true }).click()
    await subnetDialog.getByRole('alert').waitFor()
    assert.match(await subnetDialog.getByRole('alert').innerText(), /还有.*IP/)
    checks.push('新增/编辑网段真实保存 VLAN/VNI；改名同步 IP 归属；有地址时拒绝删除并显示原因')
    await subnetDialog.getByText(renamedSubnet, { exact: true }).click()
    await captureDialog(subnetDialog, 'subnet-maintenance')
    await page.keyboard.press('Escape')
    await subnetDialog.waitFor({ state: 'hidden' })
    await page.locator('[data-ipam-subnet-selector]').getByText(renamedSubnet, { exact: true }).waitFor()
    await page.getByRole('button', { name: '192.0.2.2 保留', exact: true }).waitFor()
    checks.push('当前网段改名后仍保持选中；网络/广播地址及预留方格保留')
    await captureWorkbench('ipam-workbench')

    await sidebar.getByRole('button', { name: '工单与统计', exact: true }).click()
    await openOrder()
    await orderDialog.getByRole('textbox', { name: '工单主题', exact: true }).fill(subject)
    await orderDialog.getByRole('textbox', { name: '故障内容', exact: true }).fill('验证弹窗内录入与附件上传')
    assert.match(await orderDialog.locator('input[type="datetime-local"]').inputValue(), /^\d{4}-\d{2}-\d{2}T/)
    await orderDialog.locator('[data-work-order-attachments]').setInputFiles({ name: '弹窗验收附件.txt', mimeType: 'text/plain', buffer: Buffer.from('附件功能验收', 'utf8') })
    await orderDialog.getByText('弹窗验收附件.txt', { exact: true }).waitFor()
    await captureDialog(orderDialog, 'work-order-create')
    await orderDialog.getByRole('button', { name: '创建工单', exact: true }).click()
    await orderDialog.waitFor({ state: 'hidden' })
    const order = (await request(`/api/cmdb/work-orders?keyword=${encodeURIComponent(subject)}`)).list[0]
    assert.ok(order?.id, '工单必须真实创建')
    orderId = order.id
    assert.ok(order.order_no, '工单号应自动生成')
    assert.equal((await request(`/api/cmdb/work-orders/${orderId}/attachments`)).total, 1)
    await page.getByRole('table').getByText(subject, { exact: true }).waitFor()
    checks.push('弹窗创建工单，自动编号/发生时间；创建前选附件，保存后真实上传并回到列表')
    const headers = (await page.getByRole('columnheader').allTextContents()).map((value) => value.trim()).filter(Boolean)
    assert.deepEqual(headers.slice(0, 8), ['工单号', '优先级', '维护主题', '维护类型', '关联资产', '处理时间', '维护人员', '维护状态'])
    const orderRow = () => page.getByRole('row').filter({ hasText: order.order_no })
    await orderRow().getByRole('button', { name: `查看工单 ${order.order_no}`, exact: true }).click()
    const detail = page.locator('[data-work-order-detail]')
    await detail.getByText(order.order_no, { exact: true }).waitFor()
    await detail.getByRole('button', { name: '关闭', exact: true }).first().click()
    checks.push('工单号可打开详情；列表字段顺序符合确认的八列顺序')
    await page.locator('[data-work-orders-filter]').click()
    const status = page.getByRole('combobox', { name: '工单状态', exact: true })
    await status.click()
    await page.getByRole('option', { name: '新建', exact: true }).click()
    await page.keyboard.press('Escape')
    const search = page.getByPlaceholder('搜索工单号或主题')
    await search.fill(subject)
    await search.press('Enter')
    await page.getByRole('table').getByText(subject, { exact: true }).waitFor()
    await page.locator('[data-work-orders-filter]').click()
    await page.getByRole('button', { name: '重置', exact: true }).click()
    await page.keyboard.press('Escape')
    await search.fill(subject)
    await search.press('Enter')
    await orderRow().getByRole('button', { name: '开始处理', exact: true }).click()
    await page.waitForFunction(async ({ subject, expected }) => {
      const result = await window.netcatty.cmdbRequest({ path: `/api/cmdb/work-orders?keyword=${encodeURIComponent(subject)}` })
      return result.list.some((item) => item.status === expected)
    }, { subject, expected: '处理中' })
    await page.waitForFunction(() => /^\d+$/.test(document.querySelector('[data-work-order-stat="completedThisMonth"]')?.textContent || ''))
    const completedBefore = Number(await page.locator('[data-work-order-stat="completedThisMonth"]').innerText())
    await orderRow().getByRole('button', { name: '标记解决', exact: true }).click()
    await page.waitForFunction(async ({ subject, expected }) => {
      const result = await window.netcatty.cmdbRequest({ path: `/api/cmdb/work-orders?keyword=${encodeURIComponent(subject)}` })
      return result.list.some((item) => item.status === expected)
    }, { subject, expected: '已解决' })
    await orderRow().getByRole('button', { name: '关闭工单', exact: true }).click()
    await page.getByRole('dialog', { name: '关闭工单', exact: true }).getByRole('button', { name: '确认关闭', exact: true }).click()
    await page.waitForFunction(async ({ id, subject }) => {
      const result = await window.netcatty.cmdbRequest({ path: `/api/cmdb/work-orders?keyword=${encodeURIComponent(subject)}&status=已关闭` })
      return result.list.some((item) => item.id === id)
    }, { id: orderId, subject })
    await page.waitForFunction((expected) => Number(document.querySelector('[data-work-order-stat="completedThisMonth"]')?.textContent) === expected + 1, completedBefore)
    checks.push('工单严格按新建→处理中→已解决→已关闭推进，解决后联动更新本月完成统计')
    await orderRow().getByRole('checkbox', { name: '选择此行', exact: true }).check()
    const batchClose = page.getByRole('button', { name: '批量关闭', exact: true })
    await batchClose.waitFor()
    assert.equal(await batchClose.isDisabled(), true, '未处于已解决阶段的工单不得批量关闭')
    await orderRow().getByRole('checkbox', { name: '选择此行', exact: true }).uncheck()
    checks.push('批量关闭只允许已解决状态；已关闭工单保持不可批量重复关闭')
    await captureWorkbench('work-orders-workbench')
    checks.push('1536/600 宽度下网段维护和新建工单弹窗无溢出，保存按钮可达')
  }
  const result = { verifiedAt: new Date().toISOString(), url: page.url(), debugPort: 9238, checks }
  writeFileSync(new URL('ipam-work-orders-verification.json', output), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
} finally {
  if (orderId) await request(`/api/cmdb/work-orders/${orderId}`, 'DELETE')
  if (ipId) await request(`/api/ip_pool/${ipId}`, 'DELETE')
  if (subnetId) await request(`/api/ip_subnets/${subnetId}`, 'DELETE')
  await browser.close()
}

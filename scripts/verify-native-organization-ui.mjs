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
const nodes = []
let personId = 0
const nonce = Date.now()
const orgName = `界面验收组织-${nonce}`
const departmentName = `界面验收部门-${nonce}`
const renamedDepartment = `已编辑部门-${nonce}`
const groupName = `界面验收分组-${nonce}`
const personName = `界面验收人员-${nonce}`
const request = (path, method = 'GET', body) => page.evaluate(({ path, method, body }) => window.netcatty.cmdbRequest({ path, method, ...(body ? { body: JSON.stringify(body) } : {}) }), { path, method, body })
const dialog = page.locator('[data-organization-maintenance]')

async function openMaintenance() {
  await page.locator('[data-people-add]').click()
  await page.locator('[data-people-create-menu-item="organization-maintenance"]').click()
  await dialog.waitFor()
  await page.waitForFunction(() => {
    const button = document.querySelector('[data-organization-maintenance] section button')
    return button && !button.disabled
  })
}

async function createNode(buttonName, name) {
  await dialog.getByRole('button', { name: buttonName, exact: true }).click()
  await dialog.locator('#organization-name').fill(name)
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await dialog.getByText(name, { exact: true }).waitFor()
  const row = (await request('/api/cmdb/config/org-nodes')).list.find((item) => item.name === name)
  assert.ok(row?.id, '节点必须真实写入测试数据库')
  nodes.push(row.id)
  return row
}

async function removeSelected() {
  await dialog.getByRole('button', { name: '删除', exact: true }).click()
  const confirmation = page.getByRole('dialog').filter({ hasText: '存在子节点或引用人员时不能删除' })
  await confirmation.getByRole('button', { name: '删除', exact: true }).click()
}

try {
  assert.equal((await (await fetch('http://127.0.0.1:18082/api/health')).json()).status, 'ok')
  await page.setViewportSize({ width: 1536, height: 824 })
  await page.reload()
  await page.locator('[data-tab-id="cmdb"]').click()
  await page.locator('[data-section="cmdb-sidebar"]').getByRole('button', { name: '组织架构', exact: true }).click()
  const trigger = page.locator('[data-people-add]')
  await trigger.waitFor()
  assert.equal(await trigger.count(), 1)
  await trigger.click()
  assert.equal(await page.locator('[data-people-create-menu-item]').count(), 2)
  assert.equal(await page.getByRole('dialog', { name: '新增人员', exact: true }).count(), 0)
  await page.locator('[data-people-create-menu-item="create-person"]').click()
  const personDialog = page.getByRole('dialog', { name: '新增人员', exact: true })
  await personDialog.waitFor()
  assert.equal(await page.locator('[data-people-create-menu-item]').count(), 0)
  await personDialog.getByRole('button', { name: '取消', exact: true }).click()
  assert.equal(await page.locator('[data-people-directory] aside button[aria-label="维护组织架构"]').count(), 0)
  checks.push('单按钮下拉显示两个入口；点菜单才新增人员；菜单关闭；无左侧重复设置按钮')

  await openMaintenance()
  assert.equal(await dialog.getByRole('heading', { name: '组织架构维护', exact: true }).count(), 1)
  assert.equal(await dialog.locator('section[aria-label="组织架构目录"]').count(), 1)
  assert.equal(await dialog.locator('section[aria-label="组织节点编辑"]').count(), 1)
  assert.equal(await page.locator('[data-people-create-menu-item]').count(), 0)
  const root = await createNode('新增组织', orgName)
  const department = await createNode('新增部门', departmentName)
  const group = await createNode('新增分组', groupName)
  assert.equal(department.parent_id, root.id)
  assert.equal(group.parent_id, department.id)
  checks.push('居中左右编辑弹窗；新增组织、部门、分组真实保存，并自动选择新节点')

  const createdPerson = await request('/api/cmdb/persons', 'POST', { name: personName, status: '在职', org_id: root.id, department_id: department.id, group_id: group.id })
  personId = createdPerson.id
  assert.ok(personId)
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('cmdb:directory-changed')))
  await page.waitForFunction(() => document.querySelector('#organization-person-count')?.value === '1 人')
  await removeSelected()
  await dialog.getByRole('alert').waitFor()
  assert.match(await dialog.getByRole('alert').innerText(), /人员引用/)
  assert.equal((await request('/api/cmdb/config/org-nodes')).list.some((item) => item.id === group.id), true)
  checks.push('引用人员计数真实；有人员引用的节点拒绝删除并显示错误')

  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden' })
  await page.locator('[data-people-directory] aside').getByText(departmentName, { exact: true }).click()
  await page.getByRole('table').getByText(personName, { exact: true }).waitFor()
  await openMaintenance()
  await dialog.getByText(departmentName, { exact: true }).click()
  await dialog.locator('#organization-name').fill(renamedDepartment)
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await dialog.getByText(renamedDepartment, { exact: true }).waitFor()
  const personnel = (await request(`/api/cmdb/persons?keyword=${encodeURIComponent(personName)}`)).list[0]
  assert.equal(personnel.department, renamedDepartment)
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden' })
  await page.locator('[data-people-directory] aside').getByText(renamedDepartment, { exact: true }).waitFor()
  await page.getByRole('table').getByText(personName, { exact: true }).waitFor()
  assert.ok((await page.locator('[data-people-directory]').innerText()).includes(renamedDepartment))
  checks.push('部门改名同步到人员归属、组织树，原已选人员筛选仍能查到该人员')

  await request(`/api/cmdb/persons/${personId}`, 'DELETE')
  personId = 0
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('cmdb:directory-changed')))
  await openMaintenance()
  for (const name of [groupName, renamedDepartment, orgName]) {
    await dialog.getByText(name, { exact: true }).click()
    await removeSelected()
    await dialog.getByText(name, { exact: true }).waitFor({ state: 'hidden' })
  }
  nodes.length = 0
  checks.push('无引用的分组、部门、组织可按顺序在弹窗删除；验收临时数据已清理')

  if (!await dialog.locator('#organization-name').count()) await dialog.getByRole('button', { name: '新增组织', exact: true }).click()
  const search = dialog.getByPlaceholder('搜索组织、部门或分组')
  await search.fill('不存在的节点-' + nonce)
  await dialog.getByText('没有匹配的组织节点', { exact: true }).waitFor()
  await search.fill('')
  await page.waitForFunction(() => !document.body.innerText.includes('组织节点已删除') && !document.body.innerText.includes('Error invoking remote method'))
  for (const [size, file] of [
    [{ width: 1536, height: 824 }, 'organization-maintenance-desktop.png'],
    [{ width: 600, height: 720 }, 'organization-maintenance-narrow.png'],
  ]) {
    await page.setViewportSize(size)
    await page.waitForFunction(() => {
      const element = document.querySelector('[data-organization-maintenance]')
      const box = element?.getBoundingClientRect()
      return box && box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight
    })
    assert.equal(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth), true, '弹窗不应横向溢出')
    const columns = await dialog.locator('section').evaluateAll((elements) => elements.map((element) => { const box = element.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height } }))
    if (size.width === 600) assert.ok(columns[1].y > columns[0].y, '窄窗口应上下排列')
    else assert.ok(columns[1].x > columns[0].x, '桌面窗口应左右排列')
    await dialog.locator('button[type="submit"]').scrollIntoViewIfNeeded()
    await page.screenshot({ path: fileURLToPath(new URL(file, output)) })
  }
  checks.push('搜索空结果可恢复；1536 和 600 宽度无横向溢出，保存按钮可滚动到达')
  await page.setViewportSize({ width: 1536, height: 824 })
  await dialog.locator('section[aria-label="组织节点编辑"]').evaluate((element) => { element.scrollTop = 0 })
  await page.screenshot({ path: fileURLToPath(new URL('organization-maintenance-desktop.png', output)) })
  const result = { verifiedAt: new Date().toISOString(), url: page.url(), debugPort: 9238, checks }
  writeFileSync(new URL('organization-maintenance-verification.json', output), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
} finally {
  if (personId) await request(`/api/cmdb/persons/${personId}`, 'DELETE')
  for (const id of nodes.reverse()) await request(`/api/cmdb/config/org-nodes/${id}`, 'DELETE')
  await browser.close()
}

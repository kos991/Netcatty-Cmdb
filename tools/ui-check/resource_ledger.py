"""资源总账界面回归；只读取数据及打开表单，不提交资产变更。"""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

base = sys.argv[1]
output = Path(__file__).resolve().parents[2] / 'docs' / 'evidence' / 'resource-ledger'
output.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={'width': 1440, 'height': 960}, device_scale_factor=1)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(base + '/?view=cmdb_center', wait_until='networkidle')
    rows = page.locator('.ledger-main .ant-table-tbody tr[data-row-key]')
    expect(rows).to_have_count(10)
    first = rows.first.get_attribute('data-row-key')
    page.locator('.ant-pagination-item-2').click()
    expect(rows.first).not_to_have_attribute('data-row-key', first)
    expect(page.locator('.ant-pagination-item-2')).to_have_class('ant-pagination-item ant-pagination-item-2 ant-pagination-item-active')
    page.locator('.ant-pagination-item-1').click()
    expect(rows.first).to_have_attribute('data-row-key', first)
    page.locator('.ledger-identity button').first.click()
    expect(page.locator('.ant-drawer-content')).to_be_visible()
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(350)
    page.screenshot(path=str(output / 'detail.png'))
    page.locator('.ant-drawer-close').click()
    expect(page.locator('.ant-drawer-content')).not_to_be_visible()
    page.locator('.ledger-heading .ant-btn-primary').click()
    expect(page.get_by_role('dialog')).to_be_visible()
    page.locator('.ant-modal-footer .ant-btn-default').click()
    page.get_by_role('button', name='显示字段', exact=True).click()
    expect(page.locator('.ledger-column-picker')).to_be_visible()
    page.get_by_label('序列号', exact=True).check()
    page.locator('.ledger-heading h2').click()
    expect(page.get_by_role('columnheader', name='序列号', exact=True)).to_be_visible()
    page.get_by_role('button', name='显示字段', exact=True).click()
    page.get_by_label('序列号', exact=True).uncheck()
    page.locator('.ledger-heading h2').click()
    page.locator('.ledger-filterbar input.ant-input').fill('no-matching-resource-5849')
    page.locator('.ledger-filterbar input.ant-input').press('Enter')
    expect(rows).to_have_count(0)
    expect(page.get_by_text('检测到尚未同步旧台账数据，点击同步')).to_have_count(0)
    page.locator('.ledger-filterbar > .ant-btn').click()
    expect(rows).to_have_count(10)
    page.screenshot(path=str(output / 'desktop.png'), full_page=True)
    page.set_viewport_size({'width': 390, 'height': 844})
    page.screenshot(path=str(output / 'mobile.png'), full_page=True)
    assert not errors, errors
    print('PASS: 分页、详情、新增弹窗、字段选择、查询、空结果、重置；无页面运行错误。')
    browser.close()

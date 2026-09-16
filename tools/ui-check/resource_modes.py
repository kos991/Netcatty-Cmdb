"""验证资源总账固定表格布局。"""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

base = sys.argv[1]
output = Path(__file__).resolve().parents[2] / 'docs' / 'evidence' / 'resource-ledger'
output.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={'width': 1440, 'height': 900})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(base + '/?view=cmdb_center', wait_until='networkidle')
    assert page.locator('.ledger-sidebar').count() == 0
    assert page.locator('.ledger-main .ant-table').count() == 1
    assert page.get_by_text('分栏', exact=True).count() == 0
    assert page.get_by_text('卡片', exact=True).count() == 0
    page.screenshot(path=str(output / 'desktop.png'), full_page=True)
    assert not errors, errors
    print('PASS: 左侧分类已删除；资源总账固定为表格布局。')
    browser.close()

from pathlib import Path
from playwright.sync_api import sync_playwright

out = Path('docs/evidence/rebuild-phase1')
out.mkdir(parents=True, exist_ok=True)
errors = []
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={'width': 1600, 'height': 1000})
    page.on('pageerror', lambda error: errors.append(str(error)))
    port = '63636'
    page.goto(f'http://127.0.0.1:{port}/?view=search', wait_until='networkidle')
    page.screenshot(path=str(out / 'search.png'), full_page=True)
    assert page.locator('.top-header').count() == 1
    assert page.locator('.top-nav button').count() == 3
    page.locator('.top-nav button').nth(1).click()
    page.wait_for_timeout(900)
    page.screenshot(path=str(out / 'cmdb.png'), full_page=True)
    assert page.locator('.top-nav button').nth(1).get_attribute('class') == 'active'
    assert page.locator('.cmdb-assets-sidebar').count() == 0
    page.locator('.top-nav button').nth(2).click()
    page.wait_for_timeout(900)
    page.screenshot(path=str(out / 'ip-pool.png'), full_page=True)
    assert page.locator('.top-nav button').nth(2).get_attribute('class') == 'active'
    print('errors=', errors)
    print('PASS: 三个一级入口、全局查询、CMDB、IP 池可切换')
    browser.close()

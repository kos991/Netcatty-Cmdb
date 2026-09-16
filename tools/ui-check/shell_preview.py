from pathlib import Path
import sys
from playwright.sync_api import sync_playwright

out = Path('docs/evidence/shell-preview')
out.mkdir(parents=True, exist_ok=True)
errors = []

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={'width': 1600, 'height': 1000})
    page.on('pageerror', lambda error: errors.append(str(error)))
    port = sys.argv[1] if len(sys.argv) > 1 else '63632'
    page.goto(f'http://127.0.0.1:{port}/?view=search', wait_until='networkidle')
    page.screenshot(path=str(out / 'shell-a.png'), full_page=True)
    page.locator('.sp-options button').nth(1).click()
    page.screenshot(path=str(out / 'shell-b.png'), full_page=True)
    page.locator('.sp-options button').nth(2).click()
    page.screenshot(path=str(out / 'shell-c.png'), full_page=True)
    print('title=', page.locator('.sp-picker strong').inner_text())
    print('errors=', errors)
    browser.close()

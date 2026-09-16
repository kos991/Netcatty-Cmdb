"""通用页面采集：带登录态打开指定页面，输出截图 + DOM 结构清单。

用法：
    python tools/nettopo-probe/capture.py 名称=路径 [名称=路径 ...]
例：
    python tools/nettopo-probe/capture.py workbench=/workbench cmdb-dashboard=/cmdb/dashboard

输出：docs/evidence/nettopo/<名称>.png / <名称>.json
"""

import json
import os
import sys

from playwright.sync_api import sync_playwright

EVIDENCE_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "docs", "evidence", "nettopo")
)
STATE_PATH = os.path.join(os.environ.get("TEMP", "."), "nettopo-probe", "state.json")
ORIGIN = "https://nettopo.com"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

INVENTORY_JS = """() => {
  const norm = (el) => (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
  const collect = (sel) => Array.from(document.querySelectorAll(sel)).map(norm).filter(Boolean);
  const uniq = (arr) => Array.from(new Set(arr));
  return {
    url: location.href,
    title: document.title,
    sidebar: uniq(collect('.el-menu-item, .el-sub-menu__title, .el-menu--inline .el-menu-item, aside a, aside li')),
    menuLinks: uniq(Array.from(document.querySelectorAll('a[href^="/"]')).map((a) => norm(a) + ' -> ' + a.getAttribute('href'))),
    tabs: uniq(collect('.el-tabs__item, [role=tab]')),
    buttons: uniq(collect('button')),
    tableHeaders: uniq(collect('th, .el-table__header th')),
    formLabels: uniq(collect('label, .el-form-item__label')),
    headings: uniq(collect('h1, h2, h3, h4, .card-title, .panel-title, .section-title')),
    selects: uniq(collect('.el-select .el-select__placeholder, .el-input__inner')),
    emptyStates: uniq(collect('.el-empty__description, .el-table__empty-text')),
    bodyText: (document.body.innerText || '').slice(0, 12000),
  };
}"""


def capture(page, name, path):
    url = path if path.startswith("http") else ORIGIN + path
    page.goto(url, wait_until="domcontentloaded", timeout=60000)
    try:
        page.wait_for_load_state("networkidle", timeout=20000)
    except Exception:  # noqa: BLE001 - 部分页面长轮询，超时不算失败
        pass
    page.wait_for_timeout(3000)

    info = page.evaluate(INVENTORY_JS)
    info["requestedPath"] = path

    with open(os.path.join(EVIDENCE_DIR, f"{name}.json"), "w", encoding="utf-8") as fh:
        json.dump(info, fh, ensure_ascii=False, indent=2)
    page.screenshot(path=os.path.join(EVIDENCE_DIR, f"{name}.png"), full_page=True)
    return info


def main():
    pairs = []
    for arg in sys.argv[1:]:
        if "=" not in arg:
            print(f"跳过无法解析的参数: {arg}", file=sys.stderr)
            continue
        name, path = arg.split("=", 1)
        pairs.append((name, path))
    if not pairs:
        print("用法: capture.py 名称=路径 ...", file=sys.stderr)
        return 2

    os.makedirs(EVIDENCE_DIR, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent=USER_AGENT,
            viewport={"width": 1680, "height": 1000},
            storage_state=STATE_PATH,
        )
        page = context.new_page()
        for name, path in pairs:
            try:
                info = capture(page, name, path)
                print(f"[ok] {name} {info['url']} | sidebar={len(info['sidebar'])} "
                      f"tabs={len(info['tabs'])} buttons={len(info['buttons'])} th={len(info['tableHeaders'])}")
            except Exception as exc:  # noqa: BLE001 - 逐页记录失败原因，继续采下一页
                print(f"[fail] {name} {path} -> {exc}", file=sys.stderr)
        browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())

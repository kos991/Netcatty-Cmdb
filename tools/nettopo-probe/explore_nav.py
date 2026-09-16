"""点击 CMDB 顶部导航逐项探索：记录真实 URL、页面结构与截图。

用法：
    python tools/nettopo-probe/explore_nav.py
输出：
    docs/evidence/nettopo/nav-<序号>-<名称>.png / .json
    docs/evidence/nettopo/nav-map.json
"""

import json
import os
import re
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
NAV_LABELS = ["仪表盘", "资源管理", "编码与标签", "工单管理", "资产盘点", "凭证中心", "配置中心"]

PAGE_JS = """() => {
  const norm = (el) => (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
  const uniq = (a) => Array.from(new Set(a.filter(Boolean)));
  const collect = (sel) => uniq(Array.from(document.querySelectorAll(sel)).map(norm));
  return {
    url: location.href,
    title: document.title,
    headings: collect('h1, h2, h3, h4, [class*=title], [class*=Title]').slice(0, 40),
    buttons: collect('button'),
    tableHeaders: collect('th'),
    tabs: collect('[class*=tab], [role=tab]').slice(0, 30),
    formLabels: collect('label').slice(0, 40),
    bodyText: (document.body.innerText || '').slice(0, 15000),
  };
}"""


def safe(name):
    return re.sub(r"[^0-9A-Za-z\-]", "", name) or "page"


def main():
    os.makedirs(EVIDENCE_DIR, exist_ok=True)
    nav_map = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent=USER_AGENT,
            viewport={"width": 1680, "height": 1000},
            storage_state=STATE_PATH,
        )
        page = context.new_page()
        page.goto(f"{ORIGIN}/cmdb/dashboard", wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(4000)

        for idx, label in enumerate(NAV_LABELS, start=1):
            try:
                loc = page.get_by_text(label, exact=True)
                count = loc.count()
                if count == 0:
                    nav_map[label] = {"error": "未找到导航元素"}
                    continue
                loc.first.click()
                page.wait_for_timeout(4000)
                try:
                    page.wait_for_load_state("networkidle", timeout=15000)
                except Exception:  # noqa: BLE001 - 长轮询页面允许超时
                    pass
                info = page.evaluate(PAGE_JS)
                info["navLabel"] = label
                info["matchCount"] = count
                slug = f"nav-{idx}-{safe(label)}"
                with open(os.path.join(EVIDENCE_DIR, f"{slug}.json"), "w", encoding="utf-8") as fh:
                    json.dump(info, fh, ensure_ascii=False, indent=2)
                page.screenshot(path=os.path.join(EVIDENCE_DIR, f"{slug}.png"), full_page=True)
                nav_map[label] = {"slug": slug, "url": info["url"], "title": info["title"],
                                  "headings": info["headings"][:12]}
                print(f"[ok] {label} -> {info['url']} | {info['title']}")
            except Exception as exc:  # noqa: BLE001 - 逐项记录失败原因
                nav_map[label] = {"error": str(exc)}
                print(f"[fail] {label} -> {exc}", file=sys.stderr)

        with open(os.path.join(EVIDENCE_DIR, "nav-map.json"), "w", encoding="utf-8") as fh:
            json.dump(nav_map, fh, ensure_ascii=False, indent=2)
        browser.close()
    print(f"[map] {os.path.join(EVIDENCE_DIR, 'nav-map.json')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

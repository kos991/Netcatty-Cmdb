"""UI 检查：用 Playwright 打开本系统，抓控制台报错并逐页截图。

用法（项目根目录）：
    python tools/ui-check/screenshot.py [端口] [输出目录]

这个脚本用来弥补「无法可视化验证」的缺口：它把运行时报错抓出来，并把每个页面截图落盘，
以便逐页核对排版与渲染。
"""

import sys
import os
import json
from playwright.sync_api import sync_playwright

PORT = sys.argv[1] if len(sys.argv) > 1 else "18080"
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.environ.get("TEMP", "."), "ui-check")
BASE = f"http://127.0.0.1:{PORT}"

# (名称, 需要点击的导航文字, 需要再点击的子页签文字)
PAGES = [
    ("01-search", "全局查询", None),
    ("02-workbench", "工作台", None),
    ("03-cmdb-resources", "CMDB 资源管理", "资源管理"),
    ("04-cmdb-dashboard", "CMDB 资源管理", "仪表盘"),
    ("05-cmdb-assets", "CMDB 资源管理", "云桌面终端台账"),
    ("06-cmdb-servers", "CMDB 资源管理", "物理服务器与应用"),
    ("07-cmdb-labels", "CMDB 资源管理", "编码与标签"),
    ("08-cmdb-workorders", "CMDB 资源管理", "工单管理"),
    ("09-cmdb-credentials", "CMDB 资源管理", "凭证中心"),
    ("10-cmdb-config", "CMDB 资源管理", "配置中心"),
    ("11-logs", "全院运维履历总账", None),
    ("12-ip-pool", "IP 规划池", None),
    ("13-dashboard", "全景统计看板", None),
]


def main():
    os.makedirs(OUT, exist_ok=True)
    console_msgs = []
    page_errors = []

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1600, "height": 1000})

        page.on("console", lambda m: console_msgs.append({"type": m.type, "text": m.text}))
        page.on("pageerror", lambda e: page_errors.append(str(e)))

        page.goto(BASE, wait_until="networkidle", timeout=60000)
        page.wait_for_timeout(1500)

        for name, nav, subtab in PAGES:
            try:
                # 左侧主导航
                item = page.get_by_role("button", name=nav, exact=False).first
                if item.count() == 0:
                    item = page.get_by_text(nav, exact=True).first
                item.click(timeout=8000)
                page.wait_for_timeout(900)

                if subtab:
                    tab = page.get_by_role("tab", name=subtab, exact=False).first
                    if tab.count() == 0:
                        tab = page.get_by_text(subtab, exact=True).first
                    tab.click(timeout=8000)
                    page.wait_for_timeout(1200)

                path = os.path.join(OUT, f"{name}.png")
                page.screenshot(path=path, full_page=False)
                print(f"[OK]   {name:22s} -> {path}")
            except Exception as e:  # noqa: BLE001
                print(f"[FAIL] {name:22s} -> {type(e).__name__}: {str(e)[:160]}")

        browser.close()

    errors = [m for m in console_msgs if m["type"] == "error"]
    warnings = [m for m in console_msgs if m["type"] == "warning"]

    print("\n===== 控制台 error =====")
    if errors:
        for m in errors[:40]:
            print("  " + m["text"][:300])
    else:
        print("  (无)")

    print("\n===== 页面未捕获异常 =====")
    if page_errors:
        for e in page_errors[:40]:
            print("  " + e[:300])
    else:
        print("  (无)")

    print(f"\n===== 控制台 warning 数量: {len(warnings)} =====")
    for m in warnings[:10]:
        print("  " + m["text"][:200])

    with open(os.path.join(OUT, "console.json"), "w", encoding="utf-8") as f:
        json.dump({"errors": errors, "pageErrors": page_errors, "warnings": warnings}, f,
                  ensure_ascii=False, indent=2)
    print(f"\n截图目录: {OUT}")


if __name__ == "__main__":
    main()

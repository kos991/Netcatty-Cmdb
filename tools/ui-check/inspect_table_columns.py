"""定点排查：CMDB 列表页「管理IP」列的宽度与是否被截断。"""

import os
import sys
from playwright.sync_api import sync_playwright

PORT = sys.argv[1] if len(sys.argv) > 1 else "18080"
BASE = f"http://127.0.0.1:{PORT}"
OUT = os.path.join(os.environ.get("TEMP", "."), "ui-check")
os.makedirs(OUT, exist_ok=True)


def click_text(pg, text):
    """依次尝试 menuitem / tab / 任意文本"""
    for role in ("menuitem", "tab"):
        loc = pg.get_by_role(role, name=text)
        if loc.count() > 0:
            loc.first.click()
            return True
    loc = pg.get_by_text(text, exact=True)
    if loc.count() > 0:
        loc.first.click()
        return True
    return False


def main():
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={"width": 1600, "height": 1000})
        pg.goto(BASE, wait_until="networkidle")
        pg.wait_for_timeout(1500)

        assert click_text(pg, "CMDB 资源管理"), "找不到 CMDB 入口"
        pg.wait_for_timeout(1000)
        click_text(pg, "资源管理")
        pg.wait_for_timeout(2000)

        print("列头宽度:")
        for name in ["资产编号", "设备名称", "状态", "设备分类", "操作系统类型", "操作系统版本", "管理IP", "操作"]:
            th = pg.get_by_role("columnheader", name=name)
            if th.count() == 0:
                print(f"  {name}: 未找到")
                continue
            bb = th.first.bounding_box()
            print(f"  {name:14s} 宽={bb['width'] if bb else None}")

        print("\n管理IP 单元格（前 5 个非空）:")
        n = 0
        for c in pg.locator("td").all():
            t = (c.inner_text() or "").strip()
            if t and t[0].isdigit() and "." in t and " " not in t and "-" not in t:
                bb = c.bounding_box()
                overflow = c.evaluate("e => e.scrollWidth > e.clientWidth")
                clipped = c.evaluate(
                    "e => { const s=e.querySelector('.ant-table-cell-content')||e;"
                    " return s.scrollWidth > s.clientWidth; }"
                )
                print(f"  文本=[{t}] 宽={bb['width'] if bb else None} 溢出={overflow} 内容被裁={clipped}")
                n += 1
                if n >= 5:
                    break
        if n == 0:
            print("  (未找到)")

        # 只截取表格区域，看清列渲染
        table = pg.locator(".ant-table").first
        if table.count() > 0:
            table.screenshot(path=os.path.join(OUT, "debug-table.png"))
            print(f"\n表格区域截图: {os.path.join(OUT, 'debug-table.png')}")
        b.close()


if __name__ == "__main__":
    main()

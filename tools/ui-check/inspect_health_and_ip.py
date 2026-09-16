"""定点排查：资产健康卡片的文字 + 管理IP 列的宽度与溢出情况。"""

import os
import sys
from playwright.sync_api import sync_playwright

PORT = sys.argv[1] if len(sys.argv) > 1 else "18080"
BASE = f"http://127.0.0.1:{PORT}"
OUT = os.path.join(os.environ.get("TEMP", "."), "ui-check")
os.makedirs(OUT, exist_ok=True)


def main():
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={"width": 1600, "height": 1000})
        pg.goto(BASE, wait_until="networkidle")
        pg.wait_for_timeout(1500)

        # 工作台：资产健康卡片文字
        pg.get_by_text("工作台", exact=True).first.click()
        pg.wait_for_timeout(1500)
        card = pg.get_by_text("资产健康", exact=True).first
        box = card.bounding_box()
        if box:
            # 取卡片容器内的全部文字
            container = card.locator("xpath=ancestor::div[contains(@class,'MuiCard-root')][1]")
            print("资产健康卡片文字:")
            print("  " + container.inner_text().replace("\n", " | "))
        pg.screenshot(path=os.path.join(OUT, "debug-workbench.png"))

        # CMDB 资源管理：列宽与溢出
        pg.get_by_text("CMDB 资源管理", exact=True).first.click()
        pg.wait_for_timeout(900)
        pg.get_by_role("tab", name="资源管理").first.click()
        pg.wait_for_timeout(1800)

        print("\n列表页列头宽度:")
        for name in ["资产编号", "设备名称", "状态", "管理IP", "操作"]:
            th = pg.get_by_role("columnheader", name=name)
            if th.count() == 0:
                print(f"  {name}: 未找到")
                continue
            bb = th.first.bounding_box()
            print(f"  {name}: {bb['width'] if bb else None}")

        print("\n含 IP 的单元格:")
        found = 0
        for c in pg.locator("td").all():
            t = (c.inner_text() or "").strip()
            if t and (t.startswith("192.") or t.startswith("138.") or t.startswith("180.")):
                bb = c.bounding_box()
                overflow = c.evaluate("e => e.scrollWidth > e.clientWidth")
                print(f"  文本=[{t}] 宽={bb['width'] if bb else None} 溢出={overflow}")
                found += 1
                if found >= 3:
                    break
        if found == 0:
            print("  (当前页没找到 IP 单元格)")

        pg.screenshot(path=os.path.join(OUT, "debug-resources.png"))
        b.close()
        print(f"\n调试截图目录: {OUT}")


if __name__ == "__main__":
    main()

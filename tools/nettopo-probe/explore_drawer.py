"""采集 CMDB 资产详情面板：左侧 10 个页签逐项点击，记录字段与截图；并采集新增资产/分类管理表单。

用法：
    python tools/nettopo-probe/explore_drawer.py
输出：
    docs/evidence/nettopo/drawer-*.png / .json
    docs/evidence/nettopo/form-*.json
    docs/evidence/nettopo/drawer-map.json
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

DRAWER_ROOT = ".resource-detail-overlay"
TAB_LABELS = ["信息", "资产拓扑", "设备机柜", "业务监控", "SNMP日志", "核心指标",
              "工单", "LLDP", "控制台审计", "历史记录"]

PANEL_JS = """(rootSel) => {
  const norm = (el) => (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
  const uniq = (a) => Array.from(new Set(a.filter(Boolean)));
  const root = document.querySelector(rootSel) || document.body;
  return {
    url: location.href,
    className: root.className,
    labels: uniq(Array.from(root.querySelectorAll('label, .el-form-item__label, [class*=label]')).map(norm)).slice(0, 90),
    buttons: uniq(Array.from(root.querySelectorAll('button')).map(norm)),
    inputs: Array.from(root.querySelectorAll('input, textarea')).map((el) => ({
      placeholder: el.placeholder || '', value: el.value || '', type: el.type,
    })).filter((x) => x.placeholder || x.value).slice(0, 80),
    text: norm(root).slice(0, 14000),
  };
}"""


def safe(name):
    return re.sub(r"[^0-9A-Za-z\-]", "", name) or "x"


def dump(name, payload):
    with open(os.path.join(EVIDENCE_DIR, f"{name}.json"), "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)


def main():
    os.makedirs(EVIDENCE_DIR, exist_ok=True)
    drawer_map = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent=USER_AGENT,
            viewport={"width": 1680, "height": 1000},
            storage_state=STATE_PATH,
        )
        page = context.new_page()
        page.goto(f"{ORIGIN}/cmdb/resources", wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(6000)

        page.locator("table tbody tr:first-child td:nth-child(2)").first.click()
        page.wait_for_selector(DRAWER_ROOT, timeout=15000)
        page.wait_for_timeout(4000)

        summary = page.evaluate(PANEL_JS, DRAWER_ROOT)
        dump("drawer-summary", summary)
        page.screenshot(path=os.path.join(EVIDENCE_DIR, "drawer-summary.png"), full_page=True)
        print("[ok] drawer opened")

        # 左侧页签逐项点击（限定在详情面板内部，避免命中正文同名文本）
        overlay = page.locator(DRAWER_ROOT)
        for idx, label in enumerate(TAB_LABELS, start=1):
            try:
                btn = overlay.get_by_role("button", name=label, exact=True)
                if btn.count() == 0:
                    drawer_map[label] = {"error": "面板内未找到该页签按钮"}
                    print(f"[skip] {label}")
                    continue
                btn.first.click()
                page.wait_for_timeout(3000)
                payload = page.evaluate(PANEL_JS, DRAWER_ROOT)
                slug = f"drawer-tab-{idx}-{safe(label)}"
                dump(slug, payload)
                page.screenshot(path=os.path.join(EVIDENCE_DIR, f"{slug}.png"), full_page=True)
                drawer_map[label] = {"slug": slug, "text": payload["text"][:1500]}
                print(f"[ok] tab {label}")
            except Exception as exc:  # noqa: BLE001
                drawer_map[label] = {"error": str(exc)}
                print(f"[fail] tab {label}: {exc}", file=sys.stderr)

        # 关闭详情面板
        try:
            overlay.get_by_role("button", name="关闭", exact=True).first.click()
            page.wait_for_timeout(2500)
        except Exception as exc:  # noqa: BLE001
            print(f"[warn] 关闭面板失败: {exc}", file=sys.stderr)

        # 新增资产表单
        for name, trigger in (("form-new-asset", "新增资产"), ("form-category", "分类管理")):
            try:
                page.get_by_role("button", name=trigger, exact=True).first.click()
                page.wait_for_timeout(3500)
                payload = page.evaluate(PANEL_JS, ".el-dialog, .el-drawer")
                dump(name, payload)
                page.screenshot(path=os.path.join(EVIDENCE_DIR, f"{name}.png"), full_page=True)
                print(f"[ok] {name} labels={len(payload['labels'])} tabs={payload.get('tabs')}")
                page.keyboard.press("Escape")
                page.wait_for_timeout(2000)
            except Exception as exc:  # noqa: BLE001
                print(f"[fail] {name}: {exc}", file=sys.stderr)

        with open(os.path.join(EVIDENCE_DIR, "drawer-map.json"), "w", encoding="utf-8") as fh:
            json.dump(drawer_map, fh, ensure_ascii=False, indent=2)
        browser.close()
    print(f"[map] {os.path.join(EVIDENCE_DIR, 'drawer-map.json')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

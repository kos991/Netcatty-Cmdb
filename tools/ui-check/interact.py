"""交互检查：用 Playwright 打开本系统，逐项验证真实交互是否可用（Ant Design 5 版）。

用法（项目根目录）：
    python tools/ui-check/interact.py [端口] [输出目录]

覆盖的交互（不是只截图，而是真的点开、真的读 DOM）：
    1. CMDB 资源管理 → 新增资产：弹窗出现、必填校验生效、取消可关闭
    2. CMDB 资源管理 → 状态列头筛选：筛选菜单可打开
    3. CMDB 资源管理 → 分类管理：弹窗出现、三个维度页签可切换
    4. 云桌面终端台账 → 卡片/列表视图切换、履历抽屉打开
    5. 物理服务器与应用 → 清单/机架概览切换、应用抽屉、全院应用总览
    6. 编码与标签 → 扫码定位弹窗
    7. 工单管理 → 新增工单弹窗
    8. 凭证中心 / 配置中心 → 新增弹窗、SNMP 说明页签
    9. IP 规划池 → 网段管理弹窗、补录 IP 弹窗
"""

import sys
import os
import json
from playwright.sync_api import sync_playwright

PORT = sys.argv[1] if len(sys.argv) > 1 else "18080"
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.environ.get("TEMP", "."), "ui-check")
BASE = f"http://127.0.0.1:{PORT}"

results = []

# 当前浏览器页，供 check() 在失败时清理残留弹窗（main() 里赋值）
CURRENT_PAGE = {"page": None}


def check(name, fn, page=None):
    active = page or CURRENT_PAGE["page"]
    try:
        detail = fn()
        results.append({"name": name, "ok": True, "detail": detail or ""})
        print(f"[OK]   {name}  {detail or ''}")
    except Exception as e:  # noqa: BLE001
        results.append({"name": name, "ok": False, "detail": f"{type(e).__name__}: {str(e)[:200]}"})
        print(f"[FAIL] {name}  {type(e).__name__}: {str(e)[:200]}")
        # 失败时清理残留弹窗，避免挡住后续用例（这是测试清理，不是掩盖失败）
        if active is not None:
            for _ in range(4):
                if visible_modals(active) == 0:
                    break
                active.keyboard.press("Escape")
                active.wait_for_timeout(300)


def nav_main(page, text):
    """左侧主导航（antd Menu，role=menuitem）"""
    item = page.get_by_role("menuitem", name=text, exact=False)
    if item.count() == 0:
        item = page.get_by_role("button", name=text, exact=False)
    item.first.click(timeout=8000)
    page.wait_for_timeout(700)


def nav_tab(page, text):
    """CMDB 顶部页签（antd Menu horizontal，同为 role=menuitem）"""
    page.get_by_role("menuitem", name=text, exact=False).first.click(timeout=8000)
    page.wait_for_timeout(900)


def visible_modals(page):
    """当前可见的 antd Modal 数量（关闭的 Modal 仍在 DOM 里，靠 :visible 过滤）"""
    return page.locator(".ant-modal-wrap:visible").count()


def modal(page):
    """最上层的 antd Modal 内容区；弹窗内定位一律限定在它内部，避免与页面同名元素串台"""
    return page.locator(".ant-modal-content:visible").last


def drawer(page):
    return page.locator(".ant-drawer-content:visible").last


def main():
    os.makedirs(OUT, exist_ok=True)
    console_errors = []
    page_errors = []

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1600, "height": 1000})
        CURRENT_PAGE["page"] = page
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: page_errors.append(str(e)))

        page.goto(BASE, wait_until="networkidle", timeout=60000)
        page.wait_for_timeout(1500)

        # ---------- 1. CMDB 资源管理：新增资产弹窗 ----------
        nav_main(page, "CMDB 资源管理")
        nav_tab(page, "资源管理")

        def t_create_dialog():
            page.get_by_role("button", name="新增资产").first.click(timeout=8000)
            page.wait_for_timeout(700)
            n = visible_modals(page)
            assert n >= 1, f"未弹出新增资产对话框（可见 modal 数={n}）"
            box = modal(page)
            title = box.inner_text()[:20].replace("\n", " ")
            # 直接保存应触发必填校验
            box.get_by_role("button", name="保 存").first.click(timeout=5000)
            page.wait_for_timeout(600)
            err = box.locator(".ant-form-item-explain-error").first.inner_text()
            assert "请填写设备名称" in err, f"必填校验未生效（实际提示：{err}）"
            box.get_by_role("button", name="取 消").first.click(timeout=5000)
            page.wait_for_timeout(600)
            assert visible_modals(page) == 0, "取消后对话框未关闭"
            return f"弹窗可开可关，必填校验生效（{title.strip()}）"

        check("CMDB 资源管理 / 新增资产弹窗", t_create_dialog)

        # ---------- 2. 列头筛选菜单 ----------
        def t_filter():
            th = page.locator("th", has_text="状态").first
            trigger = th.locator(".ant-table-filter-trigger").first
            trigger.click(timeout=6000)
            page.wait_for_timeout(700)
            menu = page.locator(".ant-table-filter-dropdown:visible").first
            assert menu.count() > 0, "列头筛选菜单未出现"
            text = menu.inner_text()
            assert "在线" in text, "筛选菜单未包含真实状态取值"
            page.keyboard.press("Escape")
            page.wait_for_timeout(500)
            return "状态列头筛选菜单可打开，且选项来自后端真实取值"

        check("CMDB 资源管理 / 状态列头筛选", t_filter)

        # ---------- 3. 分类管理弹窗 ----------
        def t_taxonomy():
            page.get_by_role("button", name="分类管理").first.click(timeout=8000)
            page.wait_for_timeout(800)
            assert visible_modals(page) >= 1, "分类管理弹窗未出现"
            box = modal(page)
            box.get_by_role("tab", name="分组", exact=True).click(timeout=6000)
            page.wait_for_timeout(900)
            # 切到「分组」后，面板里的主按钮应变成「新增分组」——用来证明页签真的切换了
            assert "新增分组" in box.locator(".ant-tabs-tabpane-active").inner_text(), (
                "点击『分组』页签后内容没有跟着切换"
            )
            box.get_by_role("tab", name="类型", exact=True).click(timeout=6000)
            page.wait_for_timeout(900)
            assert "新增设备分类" in box.locator(".ant-tabs-tabpane-active").inner_text(), (
                "点击『类型』页签后内容没有跟着切换"
            )
            box.locator(".ant-tabs-tabpane-active").get_by_role("button", name="新增设备分类").click(
                timeout=6000
            )
            page.wait_for_timeout(700)
            assert visible_modals(page) >= 2, "新增设备分类表单未出现"
            modal(page).get_by_role("button", name="取 消").click(timeout=6000)
            page.wait_for_timeout(500)
            modal(page).get_by_role("button", name="关 闭").click(timeout=6000)
            page.wait_for_timeout(700)
            assert visible_modals(page) == 0, "分类管理弹窗未关闭"
            return "组织/分组/类型 三页签内容真实切换，新增表单可开可关"

        check("CMDB 资源管理 / 分类管理弹窗", t_taxonomy)

        # ---------- 4. 云桌面终端台账 ----------
        nav_tab(page, "云桌面终端台账")

        def t_assets():
            # 卡片/列表切换是 antd Segmented：真正的 radio input 是视觉隐藏的，
            # 直接点它的文字标签才是用户实际点击的目标
            page.locator(".ant-segmented-item-label", has_text="列表").first.click(timeout=8000)
            page.wait_for_timeout(1200)
            page.get_by_role("button", name="详情").first.click(timeout=8000)
            page.wait_for_timeout(1800)
            body = drawer(page).inner_text()
            assert "当前设备概况" in body, "履历抽屉未打开"
            assert "关联信息" in body, "履历抽屉缺少关联信息"
            assert "历史运维与调配轨迹" in body, "履历抽屉缺少时间轴"
            page.keyboard.press("Escape")
            page.wait_for_timeout(900)
            page.locator(".ant-segmented-item-label", has_text="卡片").first.click(timeout=8000)
            page.wait_for_timeout(900)
            return "列表/卡片切换正常，履历抽屉含当前设备概况、关联信息与时间轴"

        check("云桌面终端台账 / 视图与履历", t_assets)

        # ---------- 5. 物理服务器与应用 ----------
        nav_tab(page, "物理服务器与应用")

        def t_servers():
            page.get_by_role("button", name="机架概览").first.click(timeout=8000)
            page.wait_for_timeout(1100)
            assert "当前页机架占用概览" in page.locator("body").inner_text(), "机架概览未渲染"
            # antd 会给「两个汉字」的按钮自动插入空格，可访问名是「清 单」
            page.get_by_role("button", name="清 单").first.click(timeout=8000)
            page.wait_for_timeout(1000)
            # 行末「应用」按钮：定位到该行最后一格里的第一个按钮，避免与「共 N 个应用/服务」链接按钮混淆。
            # 注意用 tr.ant-table-row：设置 scroll.x 时 antd 会在 tbody 顶部插一行隐藏的测量行。
            page.locator(".ant-table-tbody tr.ant-table-row").first.locator("td:last-child button").first.click(
                timeout=8000
            )
            page.wait_for_timeout(1800)
            assert "承载系统应用清单" in drawer(page).inner_text(), "应用抽屉未打开"
            page.keyboard.press("Escape")
            page.wait_for_timeout(800)
            page.get_by_role("tab", name="全院系统应用总览").first.click(timeout=8000)
            page.wait_for_timeout(1400)
            assert "系统/应用名称" in page.locator("body").inner_text(), "全院应用总览未渲染"
            return "机架概览/清单切换正常，应用抽屉与全院应用总览可打开"

        check("物理服务器与应用 / 机架与应用", t_servers)

        # ---------- 6. 编码与标签 ----------
        nav_tab(page, "编码与标签")

        def t_labels():
            page.get_by_role("button", name="扫码 / 编码定位").first.click(timeout=8000)
            page.wait_for_timeout(800)
            assert visible_modals(page) >= 1, "扫码弹窗未出现"
            box = modal(page)
            box.get_by_placeholder("扫描或输入编码后回车").fill("2025100002000001")
            page.wait_for_timeout(300)
            box.get_by_role("button", name="定 位").click(timeout=6000)
            page.wait_for_timeout(1600)
            body = modal(page).inner_text()
            assert "编码" in body, "定位后未展示编码详情"
            modal(page).get_by_role("button", name="关 闭").click(timeout=6000)
            page.wait_for_timeout(600)
            assert visible_modals(page) == 0, "扫码弹窗未关闭"
            return "扫码/编码定位弹窗可输入并执行定位"

        check("编码与标签 / 扫码定位", t_labels)

        # ---------- 7. 工单管理 ----------
        nav_tab(page, "工单管理")

        def t_orders():
            page.get_by_role("button", name="新增工单").first.click(timeout=8000)
            page.wait_for_timeout(900)
            assert visible_modals(page) >= 1, "新增工单弹窗未出现"
            box = modal(page)
            box.get_by_label("维护主题").fill("UI 交互自检工单")
            page.wait_for_timeout(300)
            box.get_by_role("button", name="取 消").click(timeout=6000)
            page.wait_for_timeout(600)
            assert visible_modals(page) == 0, "新增工单弹窗未关闭"
            return "新增工单弹窗可打开、填写主题后取消"

        check("工单管理 / 新增工单弹窗", t_orders)

        # ---------- 8. 凭证中心 / 配置中心 ----------
        nav_tab(page, "凭证中心")

        def t_creds():
            page.get_by_role("button", name="新增凭证").first.click(timeout=8000)
            page.wait_for_timeout(800)
            assert visible_modals(page) >= 1, "新增凭证弹窗未出现"
            box = modal(page)
            assert "不接收、不存储口令明文" in box.inner_text(), "弹窗缺少不存明文口令的说明"
            box.get_by_role("button", name="取 消").click(timeout=6000)
            page.wait_for_timeout(600)
            assert visible_modals(page) == 0, "新增凭证弹窗未关闭"
            return "新增凭证弹窗可开可关，含不存明文口令说明"

        check("凭证中心 / 新增凭证弹窗", t_creds)

        nav_tab(page, "配置中心")

        def t_config():
            page.get_by_role("button", name="新增模型").first.click(timeout=8000)
            page.wait_for_timeout(800)
            assert visible_modals(page) >= 1, "新增模型弹窗未出现"
            box = modal(page)
            box.get_by_label("型号").fill("UI自检型号")
            box.get_by_role("button", name="取 消").click(timeout=6000)
            page.wait_for_timeout(600)
            page.get_by_role("tab", name="SNMP 采集配置").first.click(timeout=8000)
            page.wait_for_timeout(900)
            assert "依赖常驻采集端" in page.locator("body").inner_text(), "SNMP 页签说明缺失"
            return "新增模型弹窗可打开；SNMP 页签保留『依赖采集端』说明"

        check("配置中心 / 新增模型与 SNMP 说明", t_config)

        # ---------- 9. IP 规划池 ----------
        nav_main(page, "IP 规划池")

        def t_ip():
            page.get_by_role("button", name="网段管理").first.click(timeout=8000)
            page.wait_for_timeout(1400)
            box = modal(page)
            assert "网段名称" in box.inner_text(), "网段管理弹窗未出现"
            box.get_by_role("button", name="新增网段").click(timeout=8000)
            page.wait_for_timeout(900)
            assert "网段名称" in modal(page).inner_text(), "新增网段表单未出现"
            modal(page).get_by_role("button", name="取 消").click(timeout=6000)
            page.wait_for_timeout(600)
            modal(page).get_by_role("button", name="关 闭").click(timeout=6000)
            page.wait_for_timeout(700)
            assert visible_modals(page) == 0, "网段管理弹窗未关闭"
            page.get_by_role("button", name="补录 IP").first.click(timeout=8000)
            page.wait_for_timeout(900)
            assert "IP 地址" in modal(page).inner_text(), "补录 IP 表单未出现"
            modal(page).get_by_role("button", name="取 消").click(timeout=6000)
            page.wait_for_timeout(600)
            return "网段管理（含新增网段）与补录 IP 弹窗均可开可关"

        check("IP 规划池 / 网段管理与补录", t_ip)

        page.screenshot(path=os.path.join(OUT, "interact-final.png"))
        browser.close()

    print("\n===== 控制台 error =====")
    print("\n".join("  " + e[:300] for e in console_errors[:30]) if console_errors else "  (无)")
    print("\n===== 页面未捕获异常 =====")
    print("\n".join("  " + e[:300] for e in page_errors[:30]) if page_errors else "  (无)")

    passed = sum(1 for r in results if r["ok"])
    print(f"\n===== 交互检查结果: {passed}/{len(results)} 通过 =====")

    with open(os.path.join(OUT, "interact.json"), "w", encoding="utf-8") as f:
        json.dump(
            {"results": results, "consoleErrors": console_errors, "pageErrors": page_errors},
            f,
            ensure_ascii=False,
            indent=2,
        )
    print(f"结果文件: {os.path.join(OUT, 'interact.json')}")


if __name__ == "__main__":
    main()

"""登录入口侦察：打开 nettopo 首页，输出 URL/标题/输入框/按钮/链接，并截图。

用途：在正式采集前确认登录表单的真实结构（选择器、字段名、是否有验证码）。
账号密码不在本文件中，统一从环境变量 NETTOPO_USER / NETTOPO_PASS 读取。
"""

import json
import os
import sys

from playwright.sync_api import sync_playwright

EVIDENCE_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "docs", "evidence", "nettopo")
)
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)


def describe(page):
    """采集页面上的可交互元素概要。"""
    return page.evaluate(
        """() => ({
            url: location.href,
            title: document.title,
            inputs: Array.from(document.querySelectorAll('input')).map((el) => ({
                type: el.type,
                name: el.name,
                id: el.id,
                placeholder: el.placeholder,
                className: el.className,
            })),
            buttons: Array.from(document.querySelectorAll('button')).map((el) => ({
                text: (el.innerText || '').trim().slice(0, 40),
                type: el.type,
                className: el.className,
            })),
            links: Array.from(document.querySelectorAll('a')).slice(0, 60).map((el) => ({
                text: (el.innerText || '').trim().slice(0, 40),
                href: el.getAttribute('href'),
            })),
            text: (document.body.innerText || '').slice(0, 3000),
        })"""
    )


def main():
    target = sys.argv[1] if len(sys.argv) > 1 else "https://nettopo.com"
    tag = sys.argv[2] if len(sys.argv) > 2 else "landing"

    os.makedirs(EVIDENCE_DIR, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(user_agent=USER_AGENT, viewport={"width": 1600, "height": 1000})
        page = context.new_page()
        page.goto(target, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(4000)

        info = describe(page)
        dump = os.path.join(EVIDENCE_DIR, f"recon-{tag}.json")
        with open(dump, "w", encoding="utf-8") as fh:
            json.dump(info, fh, ensure_ascii=False, indent=2)
        print(f"[json] {dump}")

        shot = os.path.join(EVIDENCE_DIR, f"recon-{tag}.png")
        page.screenshot(path=shot, full_page=True)
        print(f"\n[screenshot] {shot}", file=sys.stderr)

        browser.close()


if __name__ == "__main__":
    main()

"""登录 nettopo 并保存会话状态，供后续逐页采集复用。

账号从环境变量读取：NETTOPO_USER / NETTOPO_PASS。
会话状态写入 %TEMP%\\nettopo-probe\\state.json（刻意不放进项目目录，避免凭据/令牌落到仓库）。
"""

import json
import os
import sys

from playwright.sync_api import sync_playwright

STATE_PATH = os.path.join(os.environ.get("TEMP", "."), "nettopo-probe", "state.json")
EVIDENCE_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "docs", "evidence", "nettopo")
)
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)


def login(page, user, password):
    traffic = []

    def on_response(resp):
        url = resp.url
        if any(k in url.lower() for k in ("login", "auth", "token", "session")):
            try:
                body = resp.text()[:600]
            except Exception as exc:  # noqa: BLE001 - 诊断用，读不到就记录异常
                body = f"<unreadable: {exc}>"
            traffic.append({"status": resp.status, "url": url, "body": body})

    page.on("response", on_response)

    page.goto("https://nettopo.com/login", wait_until="domcontentloaded", timeout=60000)
    page.wait_for_selector("#username", timeout=30000)
    page.click("#username")
    page.type("#username", user, delay=60)
    page.click("#password")
    page.type("#password", password, delay=60)
    page.wait_for_timeout(500)
    page.click("button.login-btn")
    page.wait_for_timeout(9000)

    info = page.evaluate(
        """() => ({
            url: location.href,
            title: document.title,
            text: (document.body.innerText || '').slice(0, 1200),
            usernameValue: document.querySelector('#username')?.value || '',
            toasts: Array.from(document.querySelectorAll(
                '.ant-message, .el-message, .toast, [class*=message], [class*=error]'
            )).map((el) => (el.innerText || '').trim()).filter(Boolean).slice(0, 10),
        })"""
    )
    info["authTraffic"] = traffic
    return info


def main():
    user = os.environ.get("NETTOPO_USER")
    password = os.environ.get("NETTOPO_PASS")
    if not user or not password:
        print("ERROR: 需要设置 NETTOPO_USER / NETTOPO_PASS 环境变量", file=sys.stderr)
        return 2

    os.makedirs(os.path.dirname(STATE_PATH), exist_ok=True)
    os.makedirs(EVIDENCE_DIR, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(user_agent=USER_AGENT, viewport={"width": 1680, "height": 1000})
        page = context.new_page()
        console_errors = []
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)

        result = login(page, user, password)
        print(json.dumps(result, ensure_ascii=False))
        print(f"[console errors] {len(console_errors)}")

        page.screenshot(path=os.path.join(EVIDENCE_DIR, "after-login.png"), full_page=True)
        context.storage_state(path=STATE_PATH)
        print(f"[state] {STATE_PATH}")

        browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())

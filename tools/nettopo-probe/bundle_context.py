"""在 nettopo 前端构建产物中检索指定文案的上下文，用于还原菜单/路由配置。

用法：
    python tools/nettopo-probe/bundle_context.py 资源管理 工单管理 ...
输出：
    docs/evidence/nettopo/bundle-context.txt
"""

import os
import sys

from playwright.sync_api import sync_playwright

EVIDENCE_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "docs", "evidence", "nettopo")
)
ORIGIN = "https://nettopo.com"
ENTRY = "/assets/index-DkgEbQZC.js"


def main():
    terms = sys.argv[1:]
    if not terms:
        print("用法: bundle_context.py 关键词 [关键词 ...]", file=sys.stderr)
        return 2

    os.makedirs(EVIDENCE_DIR, exist_ok=True)
    with sync_playwright() as p:
        api = p.request.new_context(base_url=ORIGIN)
        text = api.get(ENTRY).text()
        api.dispose()

    lines = [f"bundle={ENTRY} size={len(text)}"]
    for term in terms:
        lines.append("")
        lines.append(f"===== {term} =====")
        start = 0
        hits = 0
        while hits < 12:
            idx = text.find(term, start)
            if idx < 0:
                break
            lo = max(0, idx - 320)
            hi = min(len(text), idx + 320)
            lines.append(f"--- offset {idx} ---")
            lines.append(text[lo:hi].replace("\n", " "))
            start = idx + 1
            hits += 1
        if hits == 0:
            lines.append("(未找到)")

    out = os.path.join(EVIDENCE_DIR, "bundle-context.txt")
    mode = "a" if os.path.exists(out) else "w"
    with open(out, mode, encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")
    print(f"[out] {out}")
    print("\n".join(lines[:400]))
    return 0


if __name__ == "__main__":
    sys.exit(main())

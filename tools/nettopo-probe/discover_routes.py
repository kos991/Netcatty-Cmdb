"""从 nettopo 前端构建产物中提取完整路由与视图清单。

做法：抓 index.html -> 递归抓取其引用的 JS chunk -> 正则提取路由 path / 视图组件名 / 菜单文案。
输出：docs/evidence/nettopo/route-inventory.json
"""

import json
import os
import re
from collections import OrderedDict

from playwright.sync_api import sync_playwright

EVIDENCE_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "docs", "evidence", "nettopo")
)
ORIGIN = "https://nettopo.com"

IMPORT_RE = re.compile(r'from"\./([A-Za-z0-9_.\-]+\.js)"')
SCRIPT_RE = re.compile(r'<script[^>]+src="([^"]+)"')
PATH_RE = re.compile(r'path:\s*"([^"]*)"')
NAME_RE = re.compile(r'name:\s*"([A-Za-z][A-Za-z0-9_]*)"')


def main():
    os.makedirs(EVIDENCE_DIR, exist_ok=True)
    with sync_playwright() as p:
        api = p.request.new_context(base_url=ORIGIN)
        html = api.get("/").text()
        entry_scripts = SCRIPT_RE.findall(html)

        chunks = OrderedDict()
        queue = [s for s in entry_scripts if s.endswith(".js")]
        seen = set()
        while queue and len(seen) < 400:
            rel = queue.pop(0)
            if rel in seen:
                continue
            seen.add(rel)
            try:
                text = api.get(rel).text()
            except Exception as exc:  # noqa: BLE001 - 记录抓取失败，不静默跳过
                chunks[rel] = {"error": str(exc)}
                continue

            paths = PATH_RE.findall(text)
            names = NAME_RE.findall(text)
            chunks[rel] = {
                "size": len(text),
                "paths": sorted({x for x in paths if x}),
                "names": sorted(set(names))[:60],
            }
            for imp in IMPORT_RE.findall(text):
                nxt = f"/assets/{imp}"
                if nxt not in seen:
                    queue.append(nxt)

        api.dispose()

    report = {
        "entryScripts": entry_scripts,
        "chunkCount": len(chunks),
        "routes": {},
        "chunks": chunks,
    }
    all_paths = set()
    for rel, data in chunks.items():
        for path in data.get("paths", []):
            all_paths.add(path)
            report["routes"].setdefault(path, []).append(rel)
    report["allPaths"] = sorted(all_paths)

    out = os.path.join(EVIDENCE_DIR, "route-inventory.json")
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(report, fh, ensure_ascii=False, indent=2)
    print(f"[json] {out}")
    print(f"[chunks] {len(chunks)}")
    print(f"[paths] {len(all_paths)}")
    for path in sorted(all_paths):
        print("  ", path)


if __name__ == "__main__":
    main()

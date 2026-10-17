"""
pack_cmdb_plugin.py  —  Netcatty-CMDB 插件打包器

用法：
  python tools/pack_cmdb_plugin.py [--platform <名称>] [--all-platforms]

  --platform win-x64       只打 Windows x64（默认，当前机器平台优先）
  --platform linux-x64     只打 Linux x64
  --platform linux-arm64   只打 Linux arm64
  --platform darwin-x64    只打 macOS Intel
  --platform darwin-arm64  只打 macOS Apple Silicon
  --all-platforms          打全部平台（发布到 GitHub Release 时使用）

每个平台产出独立的发布目录：
  build/dist/netcatty-cmdb-<version>-<platform>/
    netcatty-cmdb-<version>-<platform>.ncpkg  ← 单平台插件包（<10 MB）
    install.bat                                ← Windows 双击安装
    install.mjs                                ← 安装器主体
    install.sh                                 ← Linux/macOS 安装脚本
    README.md                                  ← 使用说明
"""

import argparse
import hashlib
import json
import os
import platform
import shutil
import subprocess
import sys

# ── 路径常量 ──────────────────────────────────────────────────────────────────

PROJECT_ROOT  = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLUGIN_DIR    = os.path.join(PROJECT_ROOT, "plugins", "netcatty-cmdb")
BUILD_DIR     = os.path.join(PROJECT_ROOT, "build", "netcatty-final")
CLI_PATH      = os.path.join(BUILD_DIR, "packages", "plugin-cli", "dist", "cli.js")
INSTALLER_DIR = os.path.join(PROJECT_ROOT, "tools", "install-plugin")
DIST_ROOT     = os.path.join(PROJECT_ROOT, "build", "dist")

VERSION_FILE  = os.path.join(PROJECT_ROOT, "VERSION")

def get_version():
    try:
        return open(VERSION_FILE, encoding="utf-8").read().strip()
    except FileNotFoundError:
        return "1.3.1"

VERSION = get_version()

# ── 平台映射 ──────────────────────────────────────────────────────────────────
# key = 平台标识（用于目录名和文件名）
# binary = backend/ 下的可执行文件名
# ncpkg_platform = netcatty.plugin.json companionExecutables variants 平台列表

PLATFORMS = {
    "win-x64": {
        "binary":          "cmdb-server.exe",
        "ncpkg_platforms": ["win32-x64"],
        "label":           "Windows x64",
    },
    "linux-x64": {
        "binary":          "cmdb-server-linux-amd64",
        "ncpkg_platforms": ["linux-x64"],
        "label":           "Linux x64",
    },
    "linux-arm64": {
        "binary":          "cmdb-server-linux-arm64",
        "ncpkg_platforms": ["linux-arm64"],
        "label":           "Linux arm64",
    },
    "darwin-x64": {
        "binary":          "cmdb-server-darwin-amd64",
        "ncpkg_platforms": ["darwin-x64"],
        "label":           "macOS Intel",
    },
    "darwin-arm64": {
        "binary":          "cmdb-server-darwin-arm64",
        "ncpkg_platforms": ["darwin-arm64"],
        "label":           "macOS Apple Silicon",
    },
}

def detect_host_platform():
    """返回当前机器对应的平台标识。"""
    sys_p = platform.system().lower()
    mach  = platform.machine().lower()
    if sys_p == "windows":
        return "win-x64"
    if sys_p == "darwin":
        return "darwin-arm64" if mach in ("arm64", "aarch64") else "darwin-x64"
    if mach in ("arm64", "aarch64"):
        return "linux-arm64"
    return "linux-x64"

# ── 辅助函数 ──────────────────────────────────────────────────────────────────

def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()

def ensure_frontend_dist():
    dist_dir   = os.path.join(PLUGIN_DIR, "dist")
    entry_file = os.path.join(dist_dir, "index.js")
    os.makedirs(dist_dir, exist_ok=True)
    if not os.path.exists(entry_file):
        with open(entry_file, "w", encoding="utf-8") as f:
            f.write(
                "// Netcatty CMDB Plugin Webview Entry\n"
                "export function activate(context) {\n"
                "  console.log('[Netcatty-CMDB] Webview extension activated');\n"
                "}\n"
                "export function deactivate() {\n"
                "  console.log('[Netcatty-CMDB] Webview extension deactivated');\n"
                "}\n"
            )
        print(f"[Pack] 初始化 Webview 入口: {entry_file}")

def generate_manifest(platform_id, platform_info, binary_sha256):
    """生成仅含当前平台二进制的 netcatty.plugin.json。"""
    binary = platform_info["binary"]
    manifest = {
        "$schema": "../../build/netcatty-final/packages/plugin-contract/schema/plugin-contract.schema.json",
        "manifestVersion": 1,
        "id": "com.netcatty.cmdb",
        "name": "netcatty-cmdb",
        "displayName": {"en": "CMDB Asset Platform", "zh-CN": "CMDB 资产管理"},
        "description": "常州中级人民法院资产与服务器全景管理平台",
        "version": VERSION,
        "publisher": "czfy",
        "license": "GPL-3.0-or-later",
        "engines": {
            "netcatty": ">=0.0.0",
            "api": ">=0.1.0-internal <0.2.0",
        },
        "main": {"browser": "dist/index.js", "node": "embed_loader.js"},
        "permissions": {
            "required": [
                "views",
                "commands",
                "menus",
                "runtime.advanced",
                {"permission": "companion.execute", "resources": ["com.netcatty.cmdb.server"]},
            ],
            "optional": [],
        },
        "companionExecutables": [
            {
                "id": "com.netcatty.cmdb.server",
                "variants": [
                    {
                        "path": f"backend/{binary}",
                        "platforms": platform_info["ncpkg_platforms"],
                        "sha256": binary_sha256,
                    }
                ],
            }
        ],
        "contributes": {
            "views": [
                {
                    "id": "com.netcatty.cmdb.workspace",
                    "title": {"zh-CN": "CMDB", "en": "CMDB"},
                    "entry": "dist/index.js",
                    "icon": {"kind": "package", "light": "icon.svg"},
                    "location": "aside",
                }
            ],
            "commands": [
                {
                    "id": "com.netcatty.cmdb.open",
                    "title": {"zh-CN": "打开 CMDB 资产管理", "en": "Open CMDB"},
                },
                {
                    "id": "com.netcatty.cmdb.syncHosts",
                    "title": {"zh-CN": "同步 CMDB 主机至 Netcatty", "en": "Sync CMDB Hosts to Netcatty"},
                },
            ],
            "menus": [
                {"command": "com.netcatty.cmdb.open",      "location": "commandPalette", "group": "cmdb", "order": 1},
                {"command": "com.netcatty.cmdb.syncHosts", "location": "commandPalette", "group": "cmdb", "order": 2},
            ],
        },
    }
    manifest_path = os.path.join(PLUGIN_DIR, "netcatty.plugin.json")
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
    print(f"[Pack] 生成 manifest ({platform_id}): {manifest_path}")

def pack_platform(platform_id):
    """打包单个平台，产出带安装器的发布目录。"""
    info = PLATFORMS[platform_id]
    binary_name = info["binary"]
    binary_path = os.path.join(PLUGIN_DIR, "backend", binary_name)

    if not os.path.exists(binary_path):
        print(f"[Pack] ⚠  跳过 {platform_id}：未找到 {binary_path}")
        return None

    size_mb = os.path.getsize(binary_path) / 1024 / 1024
    print(f"\n[Pack] ── 平台: {platform_id} ({info['label']}, {size_mb:.1f} MB) ──")

    # 计算二进制 SHA256
    binary_sha = sha256_file(binary_path)
    print(f"[Pack] binary sha256: {binary_sha[:16]}...")

    # 生成单平台 manifest
    generate_manifest(platform_id, info, binary_sha)

    # 确保 dist/ 入口存在
    ensure_frontend_dist()

    # 输出路径
    release_name = f"netcatty-cmdb-{VERSION}-{platform_id}"
    release_dir  = os.path.join(DIST_ROOT, release_name)
    ncpkg_name   = f"{release_name}.ncpkg"
    ncpkg_path   = os.path.join(release_dir, ncpkg_name)

    os.makedirs(release_dir, exist_ok=True)

    # 调用 plugin-cli 打包
    if not os.path.exists(CLI_PATH):
        print(f"[Pack] ⚠  未找到 plugin-cli ({CLI_PATH})，跳过 validate 和 pack")
        print(f"[Pack]    可手动打包: node {CLI_PATH} pack {PLUGIN_DIR} --out {ncpkg_path}")
    else:
        # validate
        res_v = subprocess.run(
            ["node", CLI_PATH, "validate", PLUGIN_DIR],
            cwd=BUILD_DIR, capture_output=True, text=True, encoding="utf-8", errors="replace"
        )
        if res_v.returncode != 0:
            print(f"[Pack] 校验失败:\n{res_v.stdout}\n{res_v.stderr}")
            return None
        print(f"[Pack] 校验通过: {res_v.stdout.strip()}")

        # pack
        res_p = subprocess.run(
            ["node", CLI_PATH, "pack", PLUGIN_DIR, "--out", ncpkg_path],
            cwd=BUILD_DIR, capture_output=True, text=True, encoding="utf-8", errors="replace"
        )
        if res_p.returncode != 0:
            print(f"[Pack] 打包失败:\n{res_p.stdout}\n{res_p.stderr}")
            return None
        print(f"[Pack] 打包成功: {res_p.stdout.strip()}")

    # 复制安装器文件到发布目录
    installer_files = ["install.mjs", "install.bat", "install.sh", "README.md"]
    for fn in installer_files:
        src = os.path.join(INSTALLER_DIR, fn)
        if os.path.exists(src):
            shutil.copy2(src, os.path.join(release_dir, fn))
    print(f"[Pack] 安装器已复制到: {release_dir}")

    # 显示体积
    if os.path.exists(ncpkg_path):
        ncpkg_mb = os.path.getsize(ncpkg_path) / 1024 / 1024
        print(f"[Pack] 产物: {ncpkg_path} ({ncpkg_mb:.1f} MB)")
    else:
        print(f"[Pack] 产物目录: {release_dir}")

    return release_dir

# ── 入口 ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Netcatty-CMDB 插件打包器")
    group = parser.add_mutually_exclusive_group()
    group.add_argument(
        "--platform",
        choices=list(PLATFORMS.keys()),
        default=None,
        help=f"目标平台（默认自动检测当前机器：{detect_host_platform()}）",
    )
    group.add_argument(
        "--all-platforms",
        action="store_true",
        help="打全部平台（用于 GitHub Release）",
    )
    args = parser.parse_args()

    print(f"[Pack] Netcatty-CMDB 插件打包器  版本: {VERSION}")
    print(f"[Pack] 项目根: {PROJECT_ROOT}")
    print(f"[Pack] 输出根: {DIST_ROOT}")

    if args.all_platforms:
        targets = list(PLATFORMS.keys())
        print(f"[Pack] 模式: 全平台 ({len(targets)} 个)")
    else:
        plat = args.platform or detect_host_platform()
        targets = [plat]
        print(f"[Pack] 模式: 单平台 ({plat})")

    os.makedirs(DIST_ROOT, exist_ok=True)

    results = []
    for platform_id in targets:
        out = pack_platform(platform_id)
        if out:
            results.append((platform_id, out))

    print(f"\n[Pack] {'='*50}")
    print(f"[Pack] 完成：{len(results)}/{len(targets)} 个平台打包成功")
    for pid, out_dir in results:
        ncpkg = next(
            (f for f in os.listdir(out_dir) if f.endswith(".ncpkg")),
            None
        )
        if ncpkg:
            size_mb = os.path.getsize(os.path.join(out_dir, ncpkg)) / 1024 / 1024
            print(f"  {pid:14s}  {ncpkg}  ({size_mb:.1f} MB)")
        else:
            print(f"  {pid:14s}  {out_dir}")

    if len(results) < len(targets):
        sys.exit(1)

if __name__ == "__main__":
    main()

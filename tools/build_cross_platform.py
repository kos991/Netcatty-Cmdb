import os
import subprocess
import hashlib

PROJECT_ROOT = r"d:\全景项目\常州中级人民法院\Netcatty-Cmdb"
PLUGIN_BACKEND_DIR = os.path.join(PROJECT_ROOT, "plugins", "netcatty-cmdb", "backend")
os.makedirs(PLUGIN_BACKEND_DIR, exist_ok=True)

TARGETS = [
    {"goos": "windows", "goarch": "amd64", "out": "cmdb-server.exe", "platform": "win32-x64"},
    {"goos": "linux", "goarch": "amd64", "out": "cmdb-server-linux-amd64", "platform": "linux-x64"},
    {"goos": "linux", "goarch": "arm64", "out": "cmdb-server-linux-arm64", "platform": "linux-arm64"},
    {"goos": "darwin", "goarch": "arm64", "out": "cmdb-server-darwin-arm64", "platform": "darwin-arm64"},
    {"goos": "darwin", "goarch": "amd64", "out": "cmdb-server-darwin-amd64", "platform": "darwin-x64"},
]

def build_all():
    print("[Build] 开始全平台交叉编译 CMDB 后端二进制 (CGO=0)...")
    results = {}
    for t in TARGETS:
        env = os.environ.copy()
        env["CGO_ENABLED"] = "0"
        env["GOOS"] = t["goos"]
        env["GOARCH"] = t["goarch"]

        out_path = os.path.join(PLUGIN_BACKEND_DIR, t["out"])
        cmd = ["go", "build", "-ldflags=-s -w", "-o", out_path, "."]
        
        print(f" -> 正在编译 {t['goos']}/{t['goarch']} -> {t['out']}...")
        res = subprocess.run(cmd, cwd=PROJECT_ROOT, env=env, capture_output=True, text=True)
        if res.returncode != 0:
            print(f"编译失败 {t['goos']}/{t['goarch']}:", res.stderr)
            raise RuntimeError(f"Build failed for {t['goos']}/{t['goarch']}")
        
        with open(out_path, "rb") as f:
            sha256 = hashlib.sha256(f.read()).hexdigest()
        
        size_mb = os.path.getsize(out_path) / (1024 * 1024)
        print(f"   [OK] {t['out']} ({size_mb:.2f} MB), SHA256: {sha256[:16]}...")
        results[t["platform"]] = {
            "path": f"backend/{t['out']}",
            "sha256": sha256,
            "platform": t["platform"],
        }
    return results

if __name__ == "__main__":
    build_all()

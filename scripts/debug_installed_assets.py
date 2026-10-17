import os
import glob

installed_dir = r"C:\Users\Administrator\AppData\Local\Programs\Netcatty"
print("Scanning:", installed_dir)

matches = []
for root, dirs, files in os.walk(installed_dir):
    for f in files:
        if "TerminalAssets" in f:
            p = os.path.join(root, f)
            matches.append((p, os.path.getsize(p), os.path.getmtime(p)))

for m in matches:
    print(m)

# Also check index.html in installed dir
for root, dirs, files in os.walk(installed_dir):
    for f in files:
        if f == "index.html":
            p = os.path.join(root, f)
            print("Found index.html at:", p, "size:", os.path.getsize(p), "mtime:", os.path.getmtime(p))
            with open(p, "r", encoding="utf-8", errors="ignore") as fp:
                c = fp.read()
                for line in c.splitlines():
                    if "script" in line:
                        print("  script line:", line[:120])

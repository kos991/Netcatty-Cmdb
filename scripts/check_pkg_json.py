import os

app_dir = r"C:\Users\Administrator\AppData\Local\Programs\Netcatty\resources\app"
pkg_json = os.path.join(app_dir, "package.json")
with open(pkg_json, "r", encoding="utf-8", errors="ignore") as f:
    print(f.read()[:1000])

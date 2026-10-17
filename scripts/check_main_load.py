import os

main_cjs = r"C:\Users\Administrator\AppData\Local\Programs\Netcatty\resources\app\electron\main.cjs"
with open(main_cjs, "r", encoding="utf-8", errors="ignore") as f:
    c = f.read()

for line in c.splitlines():
    if "loadURL" in line or "loadFile" in line or "dist" in line or "index.html" in line:
        print(line)

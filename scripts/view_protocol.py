import os

main_cjs = r"C:\Users\Administrator\AppData\Local\Programs\Netcatty\resources\app\electron\main.cjs"
with open(main_cjs, "r", encoding="utf-8", errors="ignore") as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if "resolveAppProtocolCacheControl" in line:
        for j in range(max(0, i-5), min(len(lines), i+30)):
            print(f"{j+1}: {lines[j].rstrip()}")
        break

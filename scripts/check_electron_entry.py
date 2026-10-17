import os

electron_main = r"C:\Users\Administrator\AppData\Local\Programs\Netcatty\resources\app\electron\main.js"
if os.path.exists(electron_main):
    print("Found electron/main.js")
    with open(electron_main, "r", encoding="utf-8", errors="ignore") as f:
        print(f.read()[:500])

for root, dirs, files in os.walk(r"C:\Users\Administrator\AppData\Local\Programs\Netcatty\resources\app\electron"):
    for f in files:
        print(os.path.join(root, f))

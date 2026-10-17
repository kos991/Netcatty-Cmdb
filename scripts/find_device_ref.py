import os

assets_dir = r"C:\Users\Administrator\AppData\Local\Programs\Netcatty\resources\app\dist\assets"
for f in os.listdir(assets_dir):
    if f.endswith(".js"):
        p = os.path.join(assets_dir, f)
        with open(p, "r", encoding="utf-8", errors="ignore") as fp:
            c = fp.read()
            if "DeviceAssets" in c:
                print(f"File {f} mentions DeviceAssets")

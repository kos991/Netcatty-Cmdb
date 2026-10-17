import os

appdata = r"C:\Users\Administrator\AppData\Roaming\netcatty"
for item in os.listdir(appdata):
    if "cache" in item.lower() or "gpu" in item.lower():
        p = os.path.join(appdata, item)
        print(item, os.path.isdir(p))

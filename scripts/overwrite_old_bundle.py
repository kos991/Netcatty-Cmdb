import os

dist_assets = r"C:\Users\Administrator\AppData\Local\Programs\Netcatty\resources\app\dist\assets"

old_bundle = "TerminalAssets-CHltmGSV.js"
new_bundle = "TerminalAssets-CRagJogh.js"

old_path = os.path.join(dist_assets, old_bundle)
new_path = os.path.join(dist_assets, new_bundle)

if os.path.exists(old_path) and os.path.exists(new_path):
    with open(new_path, "rb") as f:
        new_content = f.read()
    with open(old_path, "wb") as f:
        f.write(new_content)
    print("Overwrote", old_bundle, "with", new_bundle)
else:
    print("Paths not found:", old_path, new_path)

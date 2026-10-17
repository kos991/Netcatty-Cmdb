import os

main_entry = r"C:\Users\Administrator\AppData\Local\Programs\Netcatty\resources\app\dist\assets\index-DXkrSWsE.js"
with open(main_entry, "r", encoding="utf-8", errors="ignore") as f:
    c = f.read()

print("Does index-DXkrSWsE refer to TerminalAssets-CRagJogh?", "TerminalAssets-CRagJogh" in c)
print("Does index-DXkrSWsE refer to TerminalAssets-CHltmGSV?", "TerminalAssets-CHltmGSV" in c)

# Find any references to TerminalAssets
import re
for m in re.finditer(r"TerminalAssets-[A-Za-z0-9_-]+\.js", c):
    print("Found ref:", m.group(0))

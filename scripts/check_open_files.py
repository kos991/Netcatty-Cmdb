import os
import psutil

# Check all open files of Netcatty processes
found = []
for p in psutil.process_iter(['pid', 'name', 'exe']):
    try:
        if 'netcatty' in (p.info['name'] or '').lower():
            for f in p.open_files():
                found.append((p.info['pid'], f.path))
    except Exception:
        pass

for pid, path in set(found):
    if 'dist' in path or 'assets' in path or 'html' in path or 'js' in path:
        print(f"PID {pid}: {path}")

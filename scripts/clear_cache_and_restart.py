import os
import shutil
import subprocess
import time

print("Stopping Netcatty and cmdb-server processes...")
subprocess.run(["taskkill", "/F", "/IM", "Netcatty.exe"], capture_output=True)
subprocess.run(["taskkill", "/F", "/IM", "cmdb-server.exe"], capture_output=True)
subprocess.run(["taskkill", "/F", "/IM", "cmdb-server-native-ui.exe"], capture_output=True)
time.sleep(2)

src_server = r"d:\全景项目\常州中级人民法院\Netcatty-Cmdb\build\cmdb-server.exe"
dest_servers = [
    r"C:\Users\Administrator\AppData\Local\Programs\Netcatty\resources\cmdb\cmdb-server.exe",
    r"d:\全景项目\常州中级人民法院\Netcatty-Cmdb\build\netcatty-final\cmdb-server.exe",
    r"d:\全景项目\常州中级人民法院\Netcatty-Cmdb\plugins\netcatty-cmdb\backend\cmdb-server.exe",
]

for dest in dest_servers:
    try:
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        shutil.copy2(src_server, dest)
        print("Updated backend binary:", dest)
    except Exception as e:
        print("Failed to update backend:", dest, e)

appdata = r"C:\Users\Administrator\AppData\Roaming\netcatty"
cache_dirs = ["Cache", "Code Cache", "DawnGraphiteCache", "DawnWebGPUCache", "GPUCache"]

for d in cache_dirs:
    target = os.path.join(appdata, d)
    if os.path.exists(target):
        try:
            shutil.rmtree(target)
            print("Removed cache dir:", d)
        except Exception as e:
            print("Failed to remove", d, e)

print("Restarting Netcatty...")
exe_path = r"C:\Users\Administrator\AppData\Local\Programs\Netcatty\Netcatty.exe"
subprocess.Popen([exe_path], close_fds=True)
print("Done!")

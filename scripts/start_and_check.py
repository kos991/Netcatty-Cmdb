import os, subprocess, time

exe = r"C:\Users\Administrator\AppData\Local\Programs\Netcatty\Netcatty.exe"
print("Exists:", os.path.exists(exe))

# Start using cmd /c start ""
subprocess.run(f'cmd /c start "" "{exe}"', shell=True)
time.sleep(3)

# Check processes
out = subprocess.check_output(['tasklist'], shell=True).decode('gbk', errors='ignore')
for line in out.splitlines():
    if 'netcatty' in line.lower() or 'cmdb' in line.lower():
        print(line)

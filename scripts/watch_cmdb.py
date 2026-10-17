import subprocess, time

for i in range(15):
    out = subprocess.check_output(['wmic', 'process', 'where', "name like '%cmdb%'", 'get', 'ProcessId,CommandLine']).decode('gbk', errors='ignore')
    lines = [l.strip() for l in out.splitlines() if l.strip()]
    if len(lines) > 1:
        print("Found:", lines)
        break
    time.sleep(1)
else:
    print("Not found in 15s")

net = subprocess.check_output(['netstat', '-ano']).decode('gbk', errors='ignore')
for line in net.splitlines():
    if ':1808' in line:
        print(line)

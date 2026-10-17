import subprocess

try:
    out = subprocess.check_output(['wmic', 'process', 'where', "name like '%cmdb%'", 'get', 'ProcessId,CommandLine,ExecutablePath']).decode('gbk', errors='ignore')
    print(out)
except Exception as e:
    print('WMIC error:', e)

try:
    out2 = subprocess.check_output(['netstat', '-ano']).decode('gbk', errors='ignore')
    for line in out2.splitlines():
        if ':18080' in line:
            print(line)
except Exception as e:
    print('Netstat error:', e)

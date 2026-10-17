import subprocess

cmd = ['powershell', '-NoProfile', '-Command', "Get-CimInstance Win32_Process | Where-Object { $_.Name -like '*netcatty*' } | Select-Object ProcessId, Name, CommandLine | Format-List"]
res = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='ignore')
print(res.stdout)

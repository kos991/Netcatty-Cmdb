import subprocess, time, urllib.request, json

proc = subprocess.Popen([r'd:\全景项目\常州中级人民法院\Netcatty-Cmdb\build\cmdb-server.exe', '-port', '18089', '-db', r'C:\Users\Administrator\AppData\Roaming\netcatty\assets.db', '-api-only'])
time.sleep(1)

try:
    data = json.dumps({'ids': [158], 'changes': {'os_type': '统信 UOS'}}).encode('utf-8')
    req = urllib.request.Request('http://127.0.0.1:18089/api/assets/batch', data=data, headers={'Content-Type': 'application/json'}, method='POST')
    with urllib.request.urlopen(req) as resp:
        print('Status:', resp.status, resp.read().decode('utf-8'))
except urllib.error.HTTPError as e:
    print('HTTP Error:', e.code, e.read().decode('utf-8'))
except Exception as e:
    print('Error:', e)
finally:
    proc.terminate()

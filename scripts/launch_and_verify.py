import subprocess, time, urllib.request, json

print("Launching Netcatty...")
subprocess.Popen([r"C:\Users\Administrator\AppData\Local\Programs\Netcatty\Netcatty.exe"], close_fds=True)

print("Waiting for cmdb service to become ready on 18080...")
ready = False
for i in range(20):
    time.sleep(1)
    try:
        with urllib.request.urlopen("http://127.0.0.1:18080/api/health", timeout=1) as resp:
            if resp.status == 200:
                print("Cmdb service is healthy!")
                ready = True
                break
    except Exception:
        pass

if not ready:
    print("Warning: cmdb service not ready within 20s")
else:
    print("Testing POST /api/assets/batch on live service...")
    data = json.dumps({"ids": [158], "changes": {"status": "在用"}}).encode('utf-8')
    req = urllib.request.Request("http://127.0.0.1:18080/api/assets/batch", data=data, headers={'Content-Type': 'application/json'}, method='POST')
    try:
        with urllib.request.urlopen(req) as resp:
            print("Batch API response:", resp.status, resp.read().decode('utf-8'))
    except Exception as e:
        print("Batch API test failed:", e)

print("All done!")

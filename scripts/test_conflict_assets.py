import urllib.request, json

# 测试更新截图中的 14 台机器（包含 158邓兰铭 138.64.7.122，以及 IP 为“外网”的资产）
# 模拟批量设置分类为 "云桌面终端"
ids = [158, 147]  # 158: 138.64.7.122, 147: 外网
data = json.dumps({"ids": ids, "changes": {"device_type": "云桌面终端"}}).encode('utf-8')
req = urllib.request.Request("http://127.0.0.1:18080/api/assets/batch", data=data, headers={'Content-Type': 'application/json'}, method='POST')

try:
    with urllib.request.urlopen(req) as resp:
        print("Batch category update:", resp.status, resp.read().decode('utf-8'))
except Exception as e:
    print("Batch category update failed:", e)

# 模拟批量设置操作系统为 "统信 UOS"
data_os = json.dumps({"ids": ids, "changes": {"os_type": "统信 UOS", "os_version": "1050u2"}}).encode('utf-8')
req_os = urllib.request.Request("http://127.0.0.1:18080/api/assets/batch", data=data_os, headers={'Content-Type': 'application/json'}, method='POST')

try:
    with urllib.request.urlopen(req_os) as resp:
        print("Batch OS update:", resp.status, resp.read().decode('utf-8'))
except Exception as e:
    print("Batch OS update failed:", e)

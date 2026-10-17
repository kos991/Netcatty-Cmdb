import urllib.request, json

data = json.dumps({"ids": [158], "changes": {"group_id": 1}}).encode('utf-8')
req = urllib.request.Request('http://127.0.0.1:18080/api/assets/batch', data=data, headers={'Content-Type': 'application/json'}, method='POST')
try:
    with urllib.request.urlopen(req) as resp:
        print('Status:', resp.status, resp.read().decode('utf-8'))
except urllib.error.HTTPError as e:
    print('HTTP Error:', e.code, e.read().decode('utf-8'))
except Exception as e:
    print('Error:', e)

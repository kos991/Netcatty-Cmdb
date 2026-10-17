import sqlite3

conn = sqlite3.connect(r'C:\Users\Administrator\AppData\Roaming\Netcatty\assets.db')
c = conn.cursor()

print('--- Search 138.64.7.122 ---')
c.execute("SELECT id, asset_code, ip, terminal_ip, user_name, department, device_type FROM assets WHERE ip LIKE '%122%' OR terminal_ip LIKE '%122%'")
for row in c.fetchall():
    print(row)

print('--- Search 外网 ---')
c.execute("SELECT id, asset_code, ip, terminal_ip, user_name, department, device_type FROM assets WHERE ip='外网' OR terminal_ip='外网'")
for row in c.fetchall():
    print(row)

print('--- Count duplicates in assets ---')
c.execute("SELECT ip, count(*) FROM assets WHERE ip != '' GROUP BY ip HAVING count(*) > 1")
print("Duplicate IPs in assets:", c.fetchall()[:20])

c.execute("SELECT terminal_ip, count(*) FROM assets WHERE terminal_ip != '' GROUP BY terminal_ip HAVING count(*) > 1")
print("Duplicate terminal_ips in assets:", c.fetchall()[:20])

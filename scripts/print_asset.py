import sqlite3, json

conn = sqlite3.connect(r'C:\Users\Administrator\AppData\Roaming\Netcatty\assets.db')
conn.row_factory = sqlite3.Row
c = conn.cursor()

c.execute("SELECT * FROM assets WHERE id IN (158, 166, 147)")
rows = [dict(r) for r in c.fetchall()]
for r in rows:
    print(json.dumps(r, ensure_ascii=False, indent=2))

import sqlite3
import os

db_path = os.path.expandvars(r'%APPDATA%\netcatty\assets.db')
con = sqlite3.connect(db_path)
cur = con.cursor()
cur.execute("SELECT id, name, department, department_id, org_id FROM cmdb_persons LIMIT 15")
for r in cur.fetchall():
    print(r)
con.close()

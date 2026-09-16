#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Netcatty 与 CMDB 主机双向同步工具
将 CMDB 中的资产（统信 UOS / 银河麒麟 / 虚拟机等）一键导出为 Netcatty 可导入的 JSON 格式或直接同步
"""

import sys
import os
import json
import sqlite3
import argparse
from datetime import datetime

def get_cmdb_db():
    candidates = [
        os.path.join(os.path.dirname(__file__), "..", "assets.db"),
        os.path.abspath("assets.db"),
        os.path.expanduser("~/assets.db")
    ]
    for c in candidates:
        if os.path.exists(c):
            return c
    return candidates[0]

def export_netcatty_hosts(os_filter=None):
    """
    导出为 Netcatty 兼容的主机列表数据结构
    """
    db_path = get_cmdb_db()
    if not os.path.exists(db_path):
        print(f"[ERROR] 找不到 CMDB 数据库: {db_path}")
        return []

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    query = """
    SELECT id, name, asset_code, 
           COALESCE(NULLIF(manage_ip,''), NULLIF(biz_ip,''), NULLIF(mgmt_ip,'')) AS ip,
           os_type, os_version, department, owner, device_type
    FROM cmdb_assets
    WHERE 1=1
    """
    params = []
    if os_filter:
        if os_filter.lower() == 'uos':
            query += " AND (LOWER(os_type) LIKE '%uos%' OR LOWER(name) LIKE '%uos%')"
        elif os_filter.lower() == 'kylin':
            query += " AND (LOWER(os_type) LIKE '%kylin%' OR LOWER(name) LIKE '%kylin%' OR LOWER(name) LIKE '%麒麟%')"

    cursor.execute(query, params)
    rows = cursor.fetchall()

    netcatty_hosts = []
    for r in rows:
        ip = r['ip']
        if not ip or ip == '-':
            continue

        host_entry = {
            "id": f"cmdb-{r['id']}",
            "name": f"{r['name']} ({r['owner'] or r['department'] or 'CMDB'})",
            "host": ip,
            "port": 22,
            "username": "root",
            "group": f"CMDB/{r['department'] or '虚拟资源池'}",
            "tags": [
                "CMDB",
                r['os_type'] if r['os_type'] else "Linux",
                r['device_type'] if r['device_type'] else "虚拟机"
            ],
            "notes": f"CMDB 资产编号: {r['asset_code']} | 负责人: {r['owner']} | 系统版本: {r['os_version']}",
            "createdAt": int(datetime.now().timestamp() * 1000)
        }
        netcatty_hosts.append(host_entry)

    conn.close()
    return netcatty_hosts

def main():
    parser = argparse.ArgumentParser(description="CMDB 资产导出至 Netcatty 主机列表")
    parser.add_argument("--os", choices=["uos", "kylin", "all"], default="all", help="筛选操作系统")
    parser.add_argument("--output", "-o", default="netcatty_cmdb_hosts.json", help="导出 JSON 文件路径")
    args = parser.parse_args()

    hosts = export_netcatty_hosts(None if args.os == "all" else args.os)
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(hosts, f, ensure_ascii=False, indent=2)

    print(f"[SUCCESS] 已成功导出 {len(hosts)} 台主机至: {args.output}")
    print("在 Netcatty 客户端中点击 [设置] -> [导入/导出] 即可一键载入所有主机！")

if __name__ == "__main__":
    main()

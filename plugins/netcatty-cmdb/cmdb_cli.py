#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Netcatty CMDB 运维与补丁盘点插件 CLI 驱动
支持统信 UOS、银河麒麟（KylinOS）等虚拟机/服务器的批量探针下发、安装包统计与安全补丁盘点
"""

import sys
import os
import json
import sqlite3
import argparse
import subprocess
from datetime import datetime

# Windows 终端 UTF-8 编码兼容
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

PLUGIN_DIR = os.path.dirname(os.path.abspath(__file__))
PROBES_DIR = os.path.join(PLUGIN_DIR, "probes")
UOS_PROBE_SCRIPT = os.path.join(PROBES_DIR, "uos_probe.sh")
KYLIN_PROBE_SCRIPT = os.path.join(PROBES_DIR, "kylin_probe.sh")

def get_db_path():
    """获取 CMDB SQLite 数据库路径"""
    if os.environ.get("CMDB_DB_PATH"):
        return os.environ.get("CMDB_DB_PATH")
    
    candidates = [
        os.path.join(PLUGIN_DIR, "..", "..", "assets.db"),
        os.path.join(PLUGIN_DIR, "assets.db"),
        os.path.join(os.getcwd(), "assets.db"),
        os.path.expanduser("~/assets.db")
    ]
    for c in candidates:
        abs_p = os.path.abspath(c)
        if os.path.exists(abs_p):
            return abs_p
    return os.path.abspath(candidates[0])

def get_db_connection():
    db_path = get_db_path()
    if not os.path.exists(db_path):
        return None, f"找不到 CMDB 数据库文件: {db_path}"
    try:
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        return conn, None
    except Exception as e:
        return None, str(e)

def list_cmdb_assets(os_filter=None, keyword=None):
    """从 CMDB 中查询设备/虚拟机资产"""
    conn, err = get_db_connection()
    if err:
        return {"error": err, "assets": [], "total": 0}
    
    cursor = conn.cursor()
    query = """
    SELECT 
        id, IFNULL(asset_code,'') AS asset_code, IFNULL(name,'') AS name, 
        IFNULL(device_type,'') AS device_type, 
        COALESCE(NULLIF(manage_ip,''), NULLIF(biz_ip,''), NULLIF(mgmt_ip,''), '') AS ip, 
        IFNULL(os_type,'') AS os_type, IFNULL(os_version,'') AS os_version, 
        IFNULL(department,'') AS department, IFNULL(owner,'') AS owner, 
        IFNULL(status,'') AS status, IFNULL(custom_fields,'') AS custom_fields
    FROM cmdb_assets 
    WHERE 1=1
    """
    params = []
    
    if os_filter:
        if os_filter.lower() in ['uos', 'deepin', 'debian', 'ubuntu']:
            query += " AND (LOWER(os_type) LIKE '%uos%' OR LOWER(os_version) LIKE '%uos%' OR LOWER(name) LIKE '%uos%')"
        elif os_filter.lower() in ['kylin', 'kylinos', 'redhat', 'centos']:
            query += " AND (LOWER(os_type) LIKE '%kylin%' OR LOWER(os_version) LIKE '%kylin%' OR LOWER(name) LIKE '%kylin%' OR LOWER(name) LIKE '%麒麟%')"
        else:
            query += " AND (LOWER(os_type) LIKE ? OR LOWER(os_version) LIKE ?)"
            params.extend([f"%{os_filter.lower()}%", f"%{os_filter.lower()}%"])
            
    if keyword:
        query += " AND (name LIKE ? OR manage_ip LIKE ? OR biz_ip LIKE ? OR owner LIKE ? OR department LIKE ?)"
        params.extend([f"%{keyword}%", f"%{keyword}%", f"%{keyword}%", f"%{keyword}%", f"%{keyword}%"])
        
    query += " ORDER BY id DESC"
    cursor.execute(query, params)
    rows = cursor.fetchall()
    
    assets = []
    for r in rows:
        custom_data = {}
        if r['custom_fields']:
            try:
                custom_data = json.loads(r['custom_fields'])
            except:
                pass
        assets.append({
            "id": r['id'],
            "asset_code": r['asset_code'],
            "name": r['name'],
            "device_type": r['device_type'],
            "ip": r['ip'],
            "os_type": r['os_type'] or "未知",
            "os_version": r['os_version'] or "-",
            "department": r['department'] or "-",
            "owner": r['owner'] or "-",
            "status": r['status'],
            "installed_apps_count": custom_data.get("installed_packages_count", "-"),
            "security_patches_count": custom_data.get("security_patches_count", "-"),
            "last_inspect_time": custom_data.get("last_inspect_time", "-")
        })
    conn.close()
    return {"assets": assets, "total": len(assets)}

def update_asset_probe_data(asset_id, probe_json):
    """将探针检测出来的程序清单与补丁信息回写进 CMDB 资产自定义字段"""
    conn, err = get_db_connection()
    if err:
        return False, err
    
    cursor = conn.cursor()
    cursor.execute("SELECT custom_fields FROM cmdb_assets WHERE id = ?", (asset_id,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        return False, f"未找到 ID 为 {asset_id} 的资产"
    
    custom_dict = {}
    if row['custom_fields']:
        try:
            custom_dict = json.loads(row['custom_fields'])
        except:
            pass
            
    # 存入盘点信息
    custom_dict['os_family'] = probe_json.get('os_info', {}).get('name')
    custom_dict['os_kernel'] = probe_json.get('os_info', {}).get('kernel')
    custom_dict['installed_packages_count'] = probe_json.get('installed_packages', {}).get('total_count', 0)
    custom_dict['security_patches_count'] = probe_json.get('security_patches', {}).get('security_count', 0)
    custom_dict['upgradable_packages_count'] = probe_json.get('security_patches', {}).get('upgradable_count', 0)
    custom_dict['last_inspect_time'] = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    
    # 取前 50 个已安装包概要
    sample_pkgs = probe_json.get('installed_packages', {}).get('packages', [])[:50]
    custom_dict['installed_packages_sample'] = sample_pkgs
    
    # 待安装补丁列表
    patch_list = probe_json.get('security_patches', {}).get('list', [])[:50]
    custom_dict['security_patches_list'] = patch_list
    
    new_custom_json = json.dumps(custom_dict, ensure_ascii=False)
    
    # 回写 OS 信息
    os_name = probe_json.get('os_info', {}).get('name', '')
    os_ver = probe_json.get('os_info', {}).get('version', '')
    
    cursor.execute("""
        UPDATE cmdb_assets 
        SET custom_fields = ?, 
            os_type = CASE WHEN ? != '' THEN ? ELSE os_type END,
            os_version = CASE WHEN ? != '' THEN ? ELSE os_version END,
            updated_at = ?
        WHERE id = ?
    """, (new_custom_json, os_name, os_name, os_ver, os_ver, datetime.now().strftime('%Y-%m-%d %H:%M:%S'), asset_id))
    
    conn.commit()
    conn.close()
    return True, None

def run_local_probe(os_type="uos"):
    """本地执行探针（用于测试）"""
    script = UOS_PROBE_SCRIPT if "uos" in os_type.lower() else KYLIN_PROBE_SCRIPT
    if not os.path.exists(script):
        return {"error": f"找不到探针脚本: {script}"}
    
    try:
        res = subprocess.run(["bash", script], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=60)
        if res.returncode != 0:
            return {"error": f"探针执行失败: {res.stderr}"}
        return json.loads(res.stdout)
    except Exception as e:
        return {"error": f"执行异常: {str(e)}"}

def main():
    parser = argparse.ArgumentParser(description="Netcatty CMDB 运维与虚拟机补丁/程序盘点工具")
    subparsers = parser.add_subparsers(dest="subcommand", help="子命令")
    
    # list 命令
    list_p = subparsers.add_parser("list", help="列出 CMDB 资产与盘点概要")
    list_p.add_argument("--os", choices=["uos", "kylin", "all"], default="all", help="按操作系统筛选")
    list_p.add_argument("--kw", help="按关键字搜索 (名称/IP/负责人)")
    list_p.add_argument("--json", action="store_true", help="以 JSON 格式输出")
    
    # inspect 命令 (执行探测并回填)
    insp_p = subparsers.add_parser("inspect", help="对指定主机或模拟下发探针并回写 CMDB")
    insp_p.add_argument("--id", type=int, required=True, help="CMDB 资产 ID")
    insp_p.add_argument("--os-type", choices=["uos", "kylin"], default="uos", help="探针类型")
    insp_p.add_argument("--mock", action="store_true", help="使用模拟盘点数据测试回填")
    insp_p.add_argument("--probe-json", help="直接传入探针生成的 JSON 文件路径")
    
    # script-path 命令 (获取探针脚本绝对路径，供 Netcatty 执行远程推流)
    path_p = subparsers.add_parser("probe-path", help="输出探针脚本路径")
    path_p.add_argument("--type", choices=["uos", "kylin"], default="uos", help="操作系统探针类型")
    
    args = parser.parse_args()
    
    if args.subcommand == "list" or not args.subcommand:
        os_filter = getattr(args, "os", "all")
        if os_filter == "all": os_filter = None
        kw = getattr(args, "kw", None)
        res = list_cmdb_assets(os_filter, kw)
        
        if getattr(args, "json", False):
            print(json.dumps(res, ensure_ascii=False, indent=2))
            return
            
        print(f"\n===== CMDB 资产列表 ({res['total']} 台) =====")
        print(f"{'ID':<6} {'资产名称':<20} {'IP 地址':<18} {'操作系统':<16} {'已安装程序':<10} {'待修复补丁':<10} {'负责人':<10}")
        print("-" * 96)
        for a in res['assets']:
            print(f"{a['id']:<6} {a['name'][:18]:<20} {a['ip']:<18} {a['os_type'][:14]:<16} {str(a['installed_apps_count']):<10} {str(a['security_patches_count']):<10} {a['owner'][:8]:<10}")
        print("")
        
    elif args.subcommand == "probe-path":
        if args.type == "uos":
            print(os.path.abspath(UOS_PROBE_SCRIPT))
        else:
            print(os.path.abspath(KYLIN_PROBE_SCRIPT))
            
    elif args.subcommand == "inspect":
        probe_data = None
        if args.mock:
            # 模拟统信 UOS / 银河麒麟返回数据
            probe_data = {
                "os_info": {
                    "name": "UnionTech OS 20" if args.os_type == "uos" else "Kylin Linux Advanced Server V10",
                    "version": "1050" if args.os_type == "uos" else "SP2",
                    "kernel": "5.10.0-amd64-desktop",
                    "arch": "x86_64"
                },
                "installed_packages": {
                    "total_count": 1428,
                    "packages": [
                        {"name": "nginx", "version": "1.18.0", "description": "High performance web server"},
                        {"name": "openssh-server", "version": "8.4p1", "description": "SSH remote access server"},
                        {"name": "systemd", "version": "247.3", "description": "System and Service Manager"},
                        {"name": "python3", "version": "3.9.2", "description": "Interactive object-oriented language"}
                    ]
                },
                "security_patches": {
                    "upgradable_count": 18,
                    "security_count": 5,
                    "list": [
                        {"package": "linux-image-5.10", "current_version": "5.10.0-10", "candidate_version": "5.10.0-18", "type": "security"},
                        {"package": "openssl", "current_version": "1.1.1k-1", "candidate_version": "1.1.1n-0+deb11u5", "type": "security"},
                        {"package": "curl", "current_version": "7.74.0-1.3", "candidate_version": "7.74.0-1.3+deb11u7", "type": "security"}
                    ]
                }
            }
        elif args.probe_json:
            with open(args.probe_json, "r", encoding="utf-8") as f:
                probe_data = json.load(f)
        else:
            print("[INFO] 执行本机探针采集...")
            probe_data = run_local_probe(args.os_type)
            if "error" in probe_data:
                print(f"[ERROR] 探针执行失败: {probe_data['error']}")
                return
                
        # 回写数据库
        ok, err = update_asset_probe_data(args.id, probe_data)
        if ok:
            print(f"[SUCCESS] 资产 #{args.id} 盘点完成并已成功回填 CMDB！")
            print(f"  - 操作系统: {probe_data.get('os_info', {}).get('name')}")
            print(f"  - 内核版本: {probe_data.get('os_info', {}).get('kernel')}")
            print(f"  - 安装程序数: {probe_data.get('installed_packages', {}).get('total_count')} 个")
            print(f"  - 安全补丁数: {probe_data.get('security_patches', {}).get('security_count')} 个 (可升级包: {probe_data.get('security_patches', {}).get('upgradable_count')} 个)")
        else:
            print(f"[ERROR] 回填 CMDB 失败: {err}")

if __name__ == "__main__":
    main()

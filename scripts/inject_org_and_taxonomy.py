import sys
import sqlite3
import openpyxl
import os
import uuid
import datetime

# 1. Read Excel files
files = [
    r'D:\全景项目\常州中级人民法院\资产\常州中院-云桌面帐号及IP规划.xlsx',
    r'D:\全景项目\常州中级人民法院\资产\中院云桌面资产标签.xlsx',
    r'D:\全景项目\常州中级人民法院\资产\常州市中级人民法院深信服设备连线及管理信息20260206.xlsx'
]

departments = set()
person_dict = {} # name -> {dept, room, ip}

wb1 = openpyxl.load_workbook(files[0], data_only=True)
for sname in ['专网7段', '专网8段', '专网9段', '专网10段']:
    sh = wb1[sname]
    for r in list(sh.iter_rows(values_only=True))[1:]:
        dept = str(r[1]).strip() if r[1] else ''
        ip = str(r[2]).strip() if r[2] else ''
        user = str(r[3]).strip() if r[3] else ''
        if dept:
            departments.add(dept)
        if user and user not in ['公用', '空', '备用']:
            if user not in person_dict:
                person_dict[user] = {'name': user, 'department': dept, 'ip': ip, 'room': ''}
            elif dept and not person_dict[user]['department']:
                person_dict[user]['department'] = dept

sh_out = wb1['外网 IP']
for r in list(sh_out.iter_rows(values_only=True))[2:]:
    dept = str(r[3]).strip() if len(r) > 3 and r[3] else ''
    room = str(r[4]).strip() if len(r) > 4 and r[4] else ''
    user = str(r[5]).strip() if len(r) > 5 and r[5] else ''
    if dept:
        departments.add(dept)
    if user and user not in ['公用', '空', '备用', '模板临时使用']:
        if user not in person_dict:
            person_dict[user] = {'name': user, 'department': dept, 'room': room, 'ip': ''}
        else:
            if dept and not person_dict[user]['department']:
                person_dict[user]['department'] = dept
            if room and not person_dict[user]['room']:
                person_dict[user]['room'] = room

wb2 = openpyxl.load_workbook(files[1], data_only=True)
sh_box = wb2['盒子登记']
for r in list(sh_box.iter_rows(values_only=True))[1:]:
    user = str(r[3]).strip() if len(r) > 3 and r[3] else ''
    room = str(r[2]).strip() if len(r) > 2 and r[2] else ''
    if user and user not in ['公用', '空', '备用']:
        if user not in person_dict:
            person_dict[user] = {'name': user, 'department': '', 'room': room, 'ip': ''}
        else:
            if room and not person_dict[user]['room']:
                person_dict[user]['room'] = room

clean_depts = sorted([d for d in departments if d not in ['其它', '未使用', '']])

# 2. Extract topology links
wb3 = openpyxl.load_workbook(files[2], data_only=True)
links_to_insert = []
for sheet_name in ['互联网云桌面', '专网云桌面', '互联网超融合', '防火墙', '准入']:
    sheet = wb3[sheet_name]
    cur_biz = sheet_name
    cur_local_dev = ''
    cur_local_loc = ''
    for r in sheet.iter_rows(values_only=True):
        if not any(r):
            continue
        if r[0] == '业务分类' or r[1] == '设备名称':
            continue
        if r[0] is not None and str(r[0]).strip():
            cur_biz = str(r[0]).strip()
        if r[1] is not None and str(r[1]).strip():
            cur_local_dev = str(r[1]).strip()
        if r[2] is not None and str(r[2]).strip():
            cur_local_loc = str(r[2]).strip()
        
        local_port = str(r[3]).strip() if r[3] is not None else ''
        local_media = str(r[4]).strip() if r[4] is not None else ''
        peer_dev = str(r[5]).strip() if r[5] is not None else ''
        peer_loc = str(r[6]).strip() if r[6] is not None else ''
        peer_port = str(r[7]).strip() if r[7] is not None else ''
        peer_media = str(r[8]).strip() if r[8] is not None else ''
        remark = str(r[9]).strip() if len(r) > 9 and r[9] is not None else ''
        
        if cur_local_dev and local_port and peer_dev:
            links_to_insert.append({
                'biz': cur_biz,
                'local_dev': cur_local_dev,
                'local_loc': cur_local_loc,
                'local_port': local_port,
                'local_media': local_media,
                'peer_dev': peer_dev,
                'peer_loc': peer_loc,
                'peer_port': peer_port,
                'peer_media': peer_media,
                'remark': remark
            })

db_paths = ['assets.db', os.path.expandvars(r'%APPDATA%\netcatty\assets.db')]

for db_path in db_paths:
    if not os.path.exists(db_path):
        continue
    con = sqlite3.connect(db_path)
    cur = con.cursor()
    now = datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')
    now_dt = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    # A. 确保默认基础设施分类存在并关联到 cmdb_assets
    infra_categories = [
        ('超融合一体机', 'hyperconverged'),
        ('桌面云平台', 'server'),
        ('下一代防火墙', 'security_device'),
        ('网络准入系统', 'security_device'),
        ('核心交换机', 'switch'),
        ('汇聚交换机', 'switch'),
        ('应用服务器', 'server'),
        ('存储设备', 'storage')
    ]
    cat_map = {}
    for cat_name, scope in infra_categories:
        cur.execute("SELECT id FROM cmdb_device_categories WHERE project_id=1 AND name=? AND asset_scope='infrastructure'", (cat_name,))
        row = cur.fetchone()
        if row:
            cat_map[cat_name] = row[0]
        else:
            sync_id = str(uuid.uuid4())
            cur.execute("""
                INSERT INTO cmdb_device_categories (name, parent_id, sort_order, created_at, updated_at, asset_scope, project_id, sync_id, revision)
                VALUES (?, 0, 0, ?, ?, 'infrastructure', 1, ?, 1)
            """, (cat_name, now, now, sync_id))
            cat_map[cat_name] = cur.lastrowid

    # 终端资产分类
    cur.execute("SELECT id FROM cmdb_device_categories WHERE project_id=1 AND name='云桌面终端' AND asset_scope='terminal'")
    if not cur.fetchone():
        sync_id = str(uuid.uuid4())
        cur.execute("""
            INSERT INTO cmdb_device_categories (name, parent_id, sort_order, created_at, updated_at, asset_scope, project_id, sync_id, revision)
            VALUES ('云桌面终端', 0, 1, ?, ?, 'terminal', 1, ?, 1)
        """, (now, now, sync_id))

    # 更新 cmdb_assets 对应 category_id
    cur.execute("""
        UPDATE cmdb_assets
        SET category_id = CASE
            WHEN name LIKE '%HCI%' OR model LIKE '%超融合%' THEN ?
            WHEN name LIKE '%AF%' OR name LIKE '%防火墙%' THEN ?
            WHEN name LIKE '%准入%' THEN ?
            WHEN name LIKE '%VDS%' OR name LIKE '%VDC%' OR name LIKE '%桌面%' THEN ?
            WHEN name LIKE '%交换机%' OR name LIKE '%S5130%' OR name LIKE '%S5590%' OR name LIKE '%S6520%' THEN ?
            ELSE ?
        END
        WHERE project_id=1 AND source_type='legacy_server'
    """, (cat_map['超融合一体机'], cat_map['下一代防火墙'], cat_map['网络准入系统'], cat_map['桌面云平台'], cat_map['汇聚交换机'], cat_map['应用服务器']))

    # B. 建立组织架构树 (cmdb_org_nodes & cmdb_orgs)
    cur.execute("SELECT id FROM cmdb_org_nodes WHERE project_id=1 AND node_type='organization'")
    root_org = cur.fetchone()
    if root_org:
        root_org_id = root_org[0]
        cur.execute("UPDATE cmdb_org_nodes SET name='常州市中级人民法院' WHERE id=?", (root_org_id,))
    else:
        sync_id = str(uuid.uuid4())
        cur.execute("""
            INSERT INTO cmdb_org_nodes (project_id, sync_id, parent_id, node_type, name, sort_order, revision, created_at, updated_at)
            VALUES (1, ?, 0, 'organization', '常州市中级人民法院', 0, 1, ?, ?)
        """, (sync_id, now, now))
        root_org_id = cur.lastrowid

    dept_node_map = {}
    org_table_map = {}

    for idx, dname in enumerate(clean_depts):
        cur.execute("SELECT id FROM cmdb_org_nodes WHERE project_id=1 AND parent_id=? AND name=?", (root_org_id, dname))
        d_row = cur.fetchone()
        if d_row:
            dept_node_map[dname] = d_row[0]
        else:
            sync_id = str(uuid.uuid4())
            cur.execute("""
                INSERT INTO cmdb_org_nodes (project_id, sync_id, parent_id, node_type, name, sort_order, revision, created_at, updated_at)
                VALUES (1, ?, ?, 'department', ?, ?, 1, ?, ?)
            """, (sync_id, root_org_id, dname, idx + 1, now, now))
            dept_node_map[dname] = cur.lastrowid
        
        cur.execute("SELECT id FROM cmdb_orgs WHERE project_id=1 AND name=?", (dname,))
        o_row = cur.fetchone()
        if o_row:
            org_table_map[dname] = o_row[0]
        else:
            sync_id = str(uuid.uuid4())
            cur.execute("""
                INSERT INTO cmdb_orgs (name, parent_id, sort_order, created_at, updated_at, sync_id, revision, project_id)
                VALUES (?, 0, ?, ?, ?, ?, 1, 1)
            """, (dname, idx + 1, now_dt, now_dt, sync_id))
            org_table_map[dname] = cur.lastrowid

    # C. 录入人员列表到 cmdb_persons
    person_inserted = 0
    person_updated = 0
    for name, pdata in person_dict.items():
        dept_name = pdata['department']
        dept_node_id = dept_node_map.get(dept_name, 0)
        # cmdb_persons.org_id 引用 cmdb_org_nodes 的组织根节点，不能写入旧 cmdb_orgs.id。
        org_id = root_org_id
        room = pdata.get('room', '')
        remark = f"房间: {room}" if room else ""

        cur.execute("SELECT id FROM cmdb_persons WHERE project_id=1 AND name=?", (name,))
        exist_p = cur.fetchone()
        if exist_p:
            cur.execute("""
                UPDATE cmdb_persons
                SET department=?, department_id=?, org_id=?, org_name='常州市中级人民法院',
                    remark=CASE WHEN remark='' OR remark IS NULL THEN ? ELSE remark END,
                    updated_at=?
                WHERE id=?
            """, (dept_name, dept_node_id, org_id, remark, now, exist_p[0]))
            person_updated += 1
        else:
            sync_id = str(uuid.uuid4())
            p_code = f"FY{1000 + len(person_dict) + person_inserted}"
            cur.execute("""
                INSERT INTO cmdb_persons (person_code, name, org_name, group_name, department, title, phone, email, status, remark,
                                          created_at, updated_at, group_id, org_id, department_id, project_id, sync_id, revision)
                VALUES (?, ?, '常州市中级人民法院', '', ?, '', '', '', '在职', ?, ?, ?, 0, ?, ?, 1, ?, 1)
            """, (p_code, name, dept_name, remark, now_dt, now, org_id, dept_node_id, sync_id))
            person_inserted += 1

    # D. 回填 cmdb_assets 的 org_id 与 department
    cur.execute("""
        UPDATE cmdb_assets
        SET org_id = (SELECT id FROM cmdb_orgs WHERE cmdb_orgs.name = cmdb_assets.department AND cmdb_orgs.project_id=1)
        WHERE project_id=1 AND department IS NOT NULL AND department != '' AND (org_id IS NULL OR org_id=0)
    """)

    # E. 连线拓扑联动 (cmdb_asset_links & 对端交换机基础设施)
    # 为连线中的对端交换机自动建档（如 H3C S5590X, H3C S6520X, H3C-S12504 等），以便建立完整拓扑链路
    peer_switch_names = set(l['peer_dev'] for l in links_to_insert if l['peer_dev'])
    for ps_name in peer_switch_names:
        cur.execute("SELECT id FROM cmdb_assets WHERE project_id=1 AND name=?", (ps_name,))
        if not cur.fetchone():
            sync_id = str(uuid.uuid4())
            code = f"SW-{abs(hash(ps_name)) % 100000:05d}"
            cur.execute("""
                INSERT INTO cmdb_assets (project_id, sync_id, asset_code, name, status, asset_class, device_type, category_id, vendor, model, source_type, created_at, updated_at)
                VALUES (1, ?, ?, ?, '在线', 'physical', 'switch', ?, 'H3C', ?, 'manual', ?, ?)
            """, (sync_id, code, ps_name, cat_map['汇聚交换机'], ps_name, now, now))

    # 获取所有资产名称/管理IP与 ID 的映射
    cur.execute("SELECT id, name, mgmt_ip FROM cmdb_assets WHERE project_id=1")
    asset_rows = cur.fetchall()
    name_to_id = {r[1]: r[0] for r in asset_rows}
    
    # 建立别名规则辅助匹配
    # 例如 HCI-01 -> HCI01管理, VDS-01 -> VDS01管理, 安全管理区AF -> 安全管理区AF
    alias_map = {
        'HCI-01': 'HCI01管理', 'HCI-02': 'HCI02管理', 'HCI-03': 'HCI03管理',
        'HCI-2管理': 'HCI02管理', 'HCI-6管理': 'HCI06管理',
        'HCI-02存储': 'HCI02管理', 'HCI-06存储': 'HCI06管理',
        'VDS-01': 'VDS01管理', 'VDS-02': 'VDS02管理',
        '深信服防火墙': '安全管理区AF', '云桌面管理': 'VDC管理',
        '仲裁节点': 'ASERVER-GZ-300Z仲裁节点', 'ASM-S-6570L': '准入'
    }

    links_created = 0
    for lk in links_to_insert:
        local_name = alias_map.get(lk['local_dev'], lk['local_dev'])
        local_id = name_to_id.get(local_name) or name_to_id.get(lk['local_dev'])
        peer_name = alias_map.get(lk['peer_dev'], lk['peer_dev'])
        peer_id = name_to_id.get(peer_name) or name_to_id.get(lk['peer_dev'])

        if local_id and peer_id:
            # 查是否已有此连线
            cur.execute("""
                SELECT id FROM cmdb_asset_links
                WHERE project_id=1 AND local_asset_id=? AND local_port=? AND peer_asset_id=?
            """, (local_id, lk['local_port'], peer_id))
            if not cur.fetchone():
                sync_id = str(uuid.uuid4())
                cur.execute("""
                    INSERT INTO cmdb_asset_links (project_id, sync_id, local_asset_id, local_port, direction, peer_asset_id, peer_port, status, remark, created_at, updated_at)
                    VALUES (1, ?, ?, ?, 'uplink', ?, ?, '在线', ?, ?, ?)
                """, (sync_id, local_id, lk['local_port'], peer_id, lk['peer_port'], f"{lk['biz']} | {lk['remark']}", now, now))
                links_created += 1

    con.commit()
    con.close()
    sys.stdout.buffer.write((f"Processed {db_path}:\n  Categories: {len(cat_map)}\n  Departments: {len(dept_node_map)}\n  Persons: inserted={person_inserted}, updated={person_updated}\n  Links created: {links_created}\n").encode('utf-8'))

print("Completed successfully!")

// 向隔离验收数据库写入可复现的验收数据：台式机、笔记本、业务系统。
// 每次从纯净基线数据库重建，因此可重复执行且不残留上一轮记录。
// 用法：node scripts/seed-acceptance-data.cjs [--data <dir>] [--server <exe>] [--base <db>] [--port <n>]
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { ensureWorkOrderFixtures } = require('./acceptance-work-orders.cjs');

const root = path.resolve(__dirname, '..');
const buildDir = path.join(root, 'build');

const args = process.argv.slice(2);
const readFlag = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const data = path.resolve(readFlag('--data', path.join(buildDir, 'prototype-ci-preview')));
const server = path.resolve(readFlag('--server', path.join(buildDir, 'cmdb-server-prototype-ci.exe')));
const baseDb = path.resolve(readFlag('--base', path.join(buildDir, 'acceptance-base.db')));
// 独立端口：避免与正在运行的验收客户端（默认 18974）抢同一数据库。
const port = Number(readFlag('--port', '18976'));
const dbPath = path.join(data, 'assets.db');

if (!fs.existsSync(baseDb)) {
  const fallbackBase = path.join(buildDir, 'ci-rack-preview', 'assets.db');
  if (fs.existsSync(fallbackBase)) {
    fs.copyFileSync(fallbackBase, baseDb);
    console.log(`已从 ${fallbackBase} 创建基线数据库 ${baseDb}`);
  } else {
    console.error(`缺少纯净基线数据库：${baseDb}\n请先复制一份隔离数据作为基线，不能指向正式安装数据。`);
    process.exit(1);
  }
}
fs.mkdirSync(data, { recursive: true });
// 每次从基线重建，保证可重复执行且不残留上一轮验收记录（含已归档记录占用的 IP）。
try {
  for (const suffix of ['', '-shm', '-wal']) {
    const file = `${dbPath}${suffix}`;
    if (fs.existsSync(file)) fs.rmSync(file, { force: true });
  }
  fs.copyFileSync(baseDb, dbPath);
} catch (error) {
  if (error.code === 'EPERM' || error.code === 'EBUSY') {
    console.error('验收数据库正被占用：请先关闭正在运行的验收客户端（Cmdb 窗口），再重新执行本脚本。');
    process.exit(1);
  }
  throw error;
}

const DESKTOP = {
  asset_name: '验收台式机', asset_code: 'VERIFY-DESKTOP-01', device_type: '台式电脑',
  vendor: '联想', model: 'ThinkCentre M90t', cpu_info: 'Intel Core i5-12500', memory_mb: 16384, disk_info: '512 GB SSD',
  ip: '192.168.10.201', net_type: '内网', os_type: 'Windows 11', os_version: '22H2', status: '在用', room: '验收室',
};
const LAPTOP = {
  asset_name: '验收笔记本', asset_code: 'VERIFY-LAPTOP-01', device_type: '笔记本电脑',
  vendor: 'Dell', model: 'Latitude 5440', cpu_info: 'Intel Core i5-1345U', memory_mb: 16384, disk_info: '1 TB SSD',
  ip: '192.168.10.202', net_type: '内网', os_type: 'Windows 10', status: '在用', room: '验收室',
};
const APP = {
  app_name: '验收业务系统', asset_code: 'VERIFY-APP-01', app_type: '业务应用',
  status: '正常运行', service_ip: '192.168.10.203',
};

// 机房与机柜（cmdb_locations 位置目录）：location_type='room' 为机房，'cabinet' 为机柜。
const ROOM = { name: '验收主机房', location_type: 'room', remark: '验收用机房', sort_order: 1 };
const CABINETS = [
  { name: '验收主机房 / A01', location_type: 'cabinet', data_center: '验收主机房', cabinet_name: 'A01', rack_units: 42, remark: '验收用机柜', sort_order: 1 },
  { name: '验收主机房 / A02', location_type: 'cabinet', data_center: '验收主机房', cabinet_name: 'A02', rack_units: 42, remark: '验收用机柜', sort_order: 2 },
];

// 网段定义（ip_subnets）：category 决定业务系统网络类型解析结果。
const SUBNETS = [
  { name: '验收内网业务地址池', category: '内网', cidr: '192.168.10.0/24', gateway: '192.168.10.1', vlan: '10', purpose: '验收内网业务地址', sort_order: 1 },
  { name: '验收专网地址池', category: '专网', cidr: '10.20.30.0/24', gateway: '10.20.30.1', vlan: '30', purpose: '验收专网地址', sort_order: 2 },
];
const IPS = [
  { subnet: '验收内网业务地址池', ip: '192.168.10.201', department: '验收部门', room: '验收室', account: '验收台式机', status: '在用', remark: '验收终端资产' },
  { subnet: '验收内网业务地址池', ip: '192.168.10.202', department: '验收部门', room: '验收室', account: '验收笔记本', status: '在用', remark: '验收终端资产' },
  { subnet: '验收内网业务地址池', ip: '192.168.10.203', department: '验收部门', room: '验收主机房', account: '', status: '空闲', remark: '验收业务 IP：由业务系统占用' },
  { subnet: '验收内网业务地址池', ip: '192.168.10.211', department: '验收部门', room: '验收主机房', account: '', status: '空闲', remark: '验收空闲地址' },
  { subnet: '验收专网地址池', ip: '10.20.30.11', department: '验收部门', room: '验收主机房', account: '', status: '空闲', remark: '验收空闲地址' },
];

// 基础设施：交换机、服务器、安全设备、存储、超融合、虚拟机；覆盖原型中的类型分布。
const INFRASTRUCTURE = [
  {
    name: '验收核心交换机', asset_code: 'VERIFY-INFRA-SW-01', device_type: '交换机', category_id: 5,
    vendor: 'H3C', model: 'S6850-56HF', sn: 'VERIFY-SN-SW-01', provider: '验收网络服务商',
    status: '在线', mgmt_ip: '192.168.10.11', manage_ip: '192.168.10.11', net_type: '内网', mac: '00-11-22-33-44-01', mac_address: '00-11-22-33-44-01',
    data_center: '验收主机房', cabinet_name: 'A01', cabinet_row: 'A 排', cabinet_col: 1, start_u: 39, height_u: 2, u_height: 2, u_start: 39,
    room: '验收主机房', floor: '2 层', department: '验收部门', owner: '验收管理员', port_count: 48,
    remark: '验收示例：实体交换机已上架，机房/机柜/U 位分别记录。',
  },
  {
    name: '验收接入交换机', asset_code: 'VERIFY-INFRA-SW-02', device_type: '交换机', category_id: 6,
    vendor: '华为', model: 'S5735-L48T4X', sn: 'VERIFY-SN-SW-02', provider: '验收网络服务商',
    status: '维护中', mgmt_ip: '192.168.10.12', manage_ip: '192.168.10.12', net_type: '专网',
    data_center: '验收主机房', cabinet_name: 'A01', cabinet_row: 'A 排', cabinet_col: 1, start_u: 36, height_u: 1, u_height: 1, u_start: 36,
    room: '验收主机房', floor: '2 层', department: '验收部门', owner: '验收管理员',
    remark: '验收示例：维护中仍保留机柜位置和管理 IP。',
  },
  {
    name: '验收虚拟化物理服务器', asset_code: 'VERIFY-INFRA-SRV-01', device_type: '物理服务器', category_id: 7,
    vendor: 'Dell', model: 'PowerEdge R750', sn: 'VERIFY-SN-SRV-01', provider: '验收计算服务商',
    status: '在线', mgmt_ip: '192.168.10.21', manage_ip: '192.168.10.21', biz_ip: '10.20.30.21', net_type: '内网',
    cpu_info: '2 × Intel Xeon Gold 6338', memory_mb: 262144, disk_info: '2 × 960 GB SSD / RAID 1',
    os_type: 'VMware ESXi', os_version: '8.0', mac: '00-11-22-33-44-21', mac_address: '00-11-22-33-44-21',
    data_center: '验收主机房', cabinet_name: 'A01', cabinet_row: 'A 排', cabinet_col: 1, start_u: 21, height_u: 2, u_height: 2, u_start: 21,
    room: '验收主机房', floor: '2 层', department: '验收部门', owner: '验收管理员',
    remark: '验收示例：管理 IP 与业务 IP 使用不同网络类型，不能相互借用。',
  },
  {
    name: '验收数据库物理服务器', asset_code: 'VERIFY-INFRA-SRV-02', device_type: '物理服务器', category_id: 7,
    vendor: 'H3C', model: 'UniServer R4900 G5', sn: 'VERIFY-SN-SRV-02', provider: '验收计算服务商',
    status: '离线', mgmt_ip: '192.168.10.22', manage_ip: '192.168.10.22', net_type: '内网',
    cpu_info: '2 × Intel Xeon Silver 4314', memory_mb: 65536, disk_info: '4 × 1.92 TB SSD / RAID 10',
    os_type: 'openEuler', os_version: '24.03',
    data_center: '验收主机房', cabinet_name: '', cabinet_row: '', cabinet_col: 0, start_u: 0, height_u: 2, u_height: 2, u_start: 0,
    room: '', floor: '2 层', department: '验收部门', owner: '验收管理员',
    remark: '验收示例：只登记机房，机柜留空；起始 U 为 0，不伪造已上架位置。',
  },
  {
    name: '验收下一代防火墙', asset_code: 'VERIFY-INFRA-SEC-01', device_type: '安全设备', category_id: 3,
    vendor: '深信服', model: 'AF-2000-B2100', sn: 'VERIFY-SN-SEC-01', provider: '验收安全服务商',
    status: '在线', mgmt_ip: '192.168.10.31', manage_ip: '192.168.10.31', biz_ip: '10.20.30.31', net_type: '专网',
    security_software: 'AF 8.0.17', os_type: 'Linux', mac: '00-11-22-33-44-31', mac_address: '00-11-22-33-44-31',
    data_center: '验收主机房', cabinet_name: 'A02', cabinet_row: 'A 排', cabinet_col: 2, start_u: 30, height_u: 1, u_height: 1, u_start: 30,
    room: '验收主机房', floor: '2 层', department: '验收部门', owner: '验收管理员',
    remark: '验收示例：安全设备按网络设备展示，不显示主机 CPU/内存。',
  },
  {
    name: '验收网络准入系统', asset_code: 'VERIFY-INFRA-SEC-02', device_type: '安全设备', category_id: 4,
    vendor: '深信服', model: 'SIP-1000-B1200', sn: 'VERIFY-SN-SEC-02', provider: '验收安全服务商',
    status: '在线', mgmt_ip: '192.168.10.32', manage_ip: '192.168.10.32', net_type: '内网',
    security_software: 'SIP 3.0.85', os_type: 'Linux',
    data_center: '验收主机房', cabinet_name: 'A02', cabinet_row: 'A 排', cabinet_col: 2, start_u: 28, height_u: 1, u_height: 1, u_start: 28,
    room: '验收主机房', floor: '2 层', department: '验收部门', owner: '验收管理员',
    remark: '验收示例：准入系统覆盖安全设备类型筛选。',
  },
  {
    name: '验收文件存储阵列', asset_code: 'VERIFY-INFRA-STORAGE-01', device_type: '存储设备', category_id: 8,
    vendor: '华为', model: 'OceanStor 5300', sn: 'VERIFY-SN-STORAGE-01', provider: '验收存储服务商',
    status: '在线', mgmt_ip: '192.168.10.41', manage_ip: '192.168.10.41', biz_ip: '10.20.30.41', net_type: '内网',
    disk_info: '24 × 8 TB SAS / 双控制器',
    data_center: '验收主机房', cabinet_name: 'A02', cabinet_row: 'A 排', cabinet_col: 2, start_u: 9, height_u: 4, u_height: 4, u_start: 9,
    room: '验收主机房', floor: '2 层', department: '验收部门', owner: '验收管理员',
    remark: '验收示例：存储设备显示磁盘配置，不显示服务器 CPU。',
  },
  {
    name: '验收超融合一体机', asset_code: 'VERIFY-INFRA-HCI-01', device_type: '超融合', category_id: 1,
    vendor: '深信服', model: 'aCloud HCI-2205', sn: 'VERIFY-SN-HCI-01', provider: '验收计算服务商',
    status: '在线', mgmt_ip: '192.168.10.51', manage_ip: '192.168.10.51', net_type: '内网',
    cpu_info: '2 × Intel Xeon Gold 5318Y', memory_mb: 524288, disk_info: '6 × 3.84 TB NVMe',
    os_type: 'aCloud 6.8', data_center: '验收主机房', cabinet_name: 'A01', cabinet_row: 'A 排', cabinet_col: 1, start_u: 10, height_u: 4, u_height: 4, u_start: 10,
    room: '验收主机房', floor: '2 层', department: '验收部门', owner: '验收管理员',
    remark: '验收示例：超融合按服务器类展示计算资源。',
  },
  {
    name: '验收应用虚拟机', asset_code: 'VERIFY-INFRA-VM-01', device_type: 'virtual_machine', category_id: 7,
    asset_class: 'virtual', vendor: '', model: '', sn: 'VERIFY-SN-VM-01', provider: '验收虚拟化平台',
    status: '在线', mgmt_ip: '192.168.10.61', manage_ip: '192.168.10.61', biz_ip: '10.20.30.61', net_type: '内网',
    vcpu: 8, memory_mb: 16384, disk_info: '200 GB 虚拟磁盘', os_type: 'Windows Server', os_version: '2022',
    department: '验收部门', owner: '验收管理员',
    remark: '验收示例：虚拟机只记录计算资源，不填写机房、机柜或 U 位。',
  },
  {
    name: '验收已注销历史服务器', asset_code: 'VERIFY-INFRA-ARCHIVED-01', device_type: '物理服务器', category_id: 7,
    vendor: '联想', model: 'ThinkSystem SR550', sn: 'VERIFY-SN-ARCHIVED-01', provider: '验收计算服务商',
    status: '已注销', net_type: '未配置',
    cpu_info: '1 × Intel Xeon Silver 4210', memory_mb: 32768, disk_info: '2 × 1 TB HDD',
    os_type: 'Windows Server', os_version: '2019',
    room: '验收回收暂存间', floor: '1 层', department: '验收部门', owner: '验收管理员',
    remark: '验收示例：注销后保留资产档案和履历，可通过状态筛选查回。',
  },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForService(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/meta`);
      if (response.ok) return true;
    } catch { /* 服务尚未就绪 */ }
    await sleep(500);
  }
  return false;
}

async function request(method, urlPath, body) {
  const response = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  if (!response.ok) throw new Error(`${method} ${urlPath} -> ${response.status} ${text.slice(0, 200)}`);
  return parsed;
}

async function main() {
  const alreadyRunning = await waitForService(1500);
  let child = null;
  if (!alreadyRunning) {
    child = spawn(server, ['-db', dbPath, '-port', String(port)], { stdio: 'ignore', detached: false });
    if (!(await waitForService())) {
      child?.kill();
      console.error(`Cmdb 服务未在端口 ${port} 就绪。`);
      process.exit(1);
    }
  }

  try {
    // 1. 机房与机柜目录（机柜与网络 → 设备机柜）
    await request('POST', '/api/cmdb/config/locations', ROOM);
    console.log(`已写入机房：${ROOM.name}`);
    for (const cabinet of CABINETS) {
      await request('POST', '/api/cmdb/config/locations', cabinet);
      console.log(`已写入机柜：${cabinet.name}（${cabinet.rack_units}U）`);
    }

    // 2. 网段定义与地址池（机柜与网络 → 地址池）
    for (const subnet of SUBNETS) {
      await request('POST', '/api/ip_subnets', subnet);
      console.log(`已写入网段：${subnet.name}（${subnet.cidr} / ${subnet.category}）`);
    }
    for (const entry of IPS) {
      await request('POST', '/api/ip_pool', entry);
      console.log(`已写入地址：${entry.ip}（${entry.status}）`);
    }

    // 3. 基础设施（设备资产 → 基础设施）：交换机、服务器、安全设备、存储、超融合、虚拟机
    for (const asset of INFRASTRUCTURE) {
      await request('POST', '/api/cmdb/assets', asset);
      console.log(`已写入基础设施：${asset.name}（${asset.asset_code} · ${asset.device_type}）`);
    }

    // 4. 终端资产（设备资产 → 终端资产）
    for (const asset of [DESKTOP, LAPTOP]) {
      await request('POST', '/api/assets', asset);
      console.log(`已写入终端资产：${asset.asset_name}（${asset.asset_code}）`);
    }

    // 5. 业务系统（设备资产 → 业务系统）
    await request('POST', '/api/apps', APP);
    console.log(`已写入业务系统：${APP.app_name}（${APP.asset_code}）`);
    await ensureWorkOrderFixtures(`http://127.0.0.1:${port}`);
    console.log('验收数据写入完成（数据库已从基线重置）。');
  } finally {
    if (child) child.kill();
  }
}

main().catch((error) => {
  console.error(`写入验收数据失败：${error.message}`);
  process.exit(1);
});

(() => {
  const cloud = (row) => /云桌面|云盒|盒子/.test(row.type || '');
  const computer = (row) => /台式|笔记本/.test(row.type || '');
  const branded = (row) => computer(row) || /打印机/.test(row.type || '');
  const printerBrands = ['奔图 PANTUM', '立思辰', '联想', '得力', '映美', '惠普', '佳能', '爱普生', '兄弟', '富士胶片', '理光', '京瓷'];
  const vendorOptions = () => [...new Set([
    ...(window.cmdbSettingsPreviewCatalogs?.models?.entries || []).map((entry) => entry.vendor),
    ...Object.values(window.assetPrototypePages || {}).flatMap((page) => page.rows.map((row) => row.vendor)),
    ...printerBrands,
  ].filter(Boolean))];
  const hardwareExamples = {
    '台式机': { vendor: '联想', model: 'ThinkCentre M90t（示例）', cpu_info: 'Intel Core i5-12500', memory_mb: 16384, disk_info: '512 GB SSD' },
    '笔记本': { vendor: 'Dell', model: 'Latitude 5440（示例）', cpu_info: 'Intel Core i5-1345U', memory_mb: 16384, disk_info: '1 TB SSD' },
  };
  const examples = [
    { name: '示例云桌面 01', type: '云桌面', person: '示例人员甲', department: '民事部门（示例）', room: '1008 室', ip: '10.20.30.21', physical_ip: '192.168.10.21', network: '专网', os: '统信 UOS', status: '使用' },
    { name: '示例云桌面 02', type: '云桌面', person: '示例人员乙', department: '民事部门（示例）', room: '1010 室', ip: '10.20.30.22', physical_ip: '192.168.10.22', network: '专网', os: '银河麒麟', status: '使用' },
    { name: '示例台式机 03', type: '台式机', person: '示例人员丙', department: '行政部门（示例）', room: '201 室', ip: '192.168.10.31', network: '内网', os: 'Windows 11', status: '使用' },
    { name: '示例笔记本 04', type: '笔记本', person: '示例人员丁', department: '行政部门（示例）', room: '202 室', ip: '192.168.10.32', network: '内网', os: 'Windows 11', status: '使用' },
    { name: '示例网络打印机 05', type: '打印机', vendor: '奔图 PANTUM', model: 'P2500（示例）', person: '示例人员戊', department: '立案部门（示例）', room: '103 室', ip: '192.168.10.40', network: '内网', os: '不适用', status: '使用' },
    { name: '示例备用台式机 06', type: '台式机', person: '', department: '信息部门（示例）', room: '设备库', ip: '', network: '未配置', os: '统信 UOS', status: '闲置' },
    { name: '示例故障云盒 07', type: '云盒', person: '示例人员己', department: '民事部门（示例）', room: '1021 室', ip: '10.20.30.27', physical_ip: '192.168.10.27', network: '专网', os: '统信 UOS', status: '维修中' },
    { name: '示例长名称终端－综合事务室公共查询与远程会议终端设备', type: '云桌面', person: '示例人员庚', department: '综合部门（示例）', room: '综合事务室', ip: '10.20.30.28', physical_ip: '192.168.10.28', network: '专网', os: '统信 UOS', status: '使用', code: 'TERM-EXAMPLE-2026-ADMINISTRATIVE-SERVICE-ROOM-000008', sn: 'EXAMPLE-SN-LONG-TERMINAL-2026-000008-000000000000000000' },
    { name: '示例独立打印机 09', type: '打印机', vendor: '联想', model: 'LJ2205（示例）', person: '', department: '立案部门（示例）', room: '104 室', ip: '', network: '未配置', os: '不适用', status: '闲置' },
    { name: '示例笔记本 10', type: '笔记本', person: '示例人员辛', department: '综合部门（示例）', room: '305 室', ip: '192.168.10.42', network: '内网', os: 'Windows 10', status: '使用' },
    { name: '示例云桌面 11', type: '云桌面', person: '示例人员壬', department: '信息部门（示例）', room: '302 室', ip: '10.20.30.29', physical_ip: '192.168.10.29', network: '专网', os: '统信 UOS', status: '使用' },
    { name: '示例已注销台式机 12', type: '台式机', person: '原示例人员癸', department: '行政部门（示例）', room: '回收库', ip: '', network: '未配置', os: 'Windows 10', status: '已注销' },
  ];
  const rows = examples.map((record, index) => {
    const row = { id: 'terminal-example-' + String(index + 1).padStart(2, '0'), code: 'TERM-EXAMPLE-' + String(index + 1).padStart(3, '0'), sn: 'SN-EXAMPLE-TERM-' + String(index + 1).padStart(3, '0'), physical_ip: '', display_sn: '', os_version: '示例版本', remark: '仅为设计原型示例，不对应真实资产。', ...record };
    if (computer(row)) Object.assign(row, hardwareExamples[row.type]);
    row.vendor_model = [row.vendor, row.model].filter(Boolean).join(' / ');
    if (cloud(row)) row.display_sn = 'SN-EXAMPLE-DISPLAY-' + String(index + 1).padStart(3, '0');
    row.serial_summary = row.code + ' · ' + row.sn;
    row.relations = row.ip ? [{ label: 'IP 地址池', value: row.ip + '（示例）', href: 'network-preview.html' }] : [];
    row.history = [{ date: '2026-09-01', title: '示例入库', text: row.code + ' 登记为' + row.type + '。' }, { date: '2026-10-01', title: row.status === '已注销' ? '示例注销' : '示例资料更新', text: '保留设备资料及历史记录；此处仅展示履历样式。' }];
    return row;
  });
  window.assetPrototypePages = window.assetPrototypePages || {};
  window.assetPrototypePages.terminal = {
    label: '终端资产',
    rows,
    columns: [
      { key: 'name', label: '名称 / 编码 / SN', headerTitle: '设备名称 / 资产编号 / 设备SN', width: 190, kind: 'asset', secondary: 'serial_summary' },
      { key: 'type', label: '设备类型', width: 90 },
      { key: 'vendor_model', label: '品牌 / 型号', width: 140 },
      { key: 'person', label: '使用人 / 部门', width: 140, secondary: 'department' },
      { key: 'room', label: '房间 / 位置', width: 90 },
      { key: 'ip', label: 'IP 地址', width: 145, secondary: 'physical_ip' },
      { key: 'network', label: '网络类型', width: 85 },
      { key: 'os', label: '操作系统', width: 110 },
      { key: 'status', label: '设备状态', width: 80, kind: 'status' },
    ],
    filters: [{ key: 'type', label: '设备类型' }, { key: 'department', label: '部门' }, { key: 'status', label: '设备状态' }, { key: 'network', label: '网络类型' }],
    groups: [
      { title: '设备档案', fields: [
        { key: 'name', label: '设备名称' }, { key: 'code', label: '资产编号' },
        { key: 'type', label: '设备类型', kind: 'select', options: ['云桌面', '云盒', '台式机', '笔记本', '打印机'], required: true },
        { key: 'sn', label: '设备 SN', when: (row) => !cloud(row) },
        { key: 'sn', label: '终端主机 SN', when: cloud }, { key: 'display_sn', label: '显示器 SN', when: cloud },
        { key: 'status', label: '设备状态', kind: 'select', options: ['使用', '闲置', '维修中', '已注销'] },
      ] },
      { title: '硬件信息', fields: [
        { key: 'vendor', label: '品牌 / 厂商', suggestions: vendorOptions, when: branded },
        { key: 'model', label: '型号', when: branded },
        { key: 'cpu_info', label: 'CPU 配置', when: computer },
        { key: 'memory_mb', label: '内存（MB）', kind: 'number', when: computer },
        { key: 'disk_info', label: '硬盘 / 磁盘配置', when: computer },
      ] },
      { title: '人员与位置', fields: [{ key: 'person', label: '当前使用人' }, { key: 'department', label: '部门', kind: 'select', options: ['民事部门（示例）', '行政部门（示例）', '立案部门（示例）', '信息部门（示例）', '综合部门（示例）'] }, { key: 'room', label: '房间 / 位置' }] },
      { title: '网络与系统', fields: [
        { key: 'ip', label: '设备 IP', when: (row) => !cloud(row) }, { key: 'ip', label: '业务 / 虚拟机 IP', when: cloud },
        { key: 'physical_ip', label: '终端物理 IP', when: cloud },
        { key: 'network', label: 'IP 网络类型', kind: 'select', options: ['专网', '内网', '外网', '未配置'] },
        { key: 'os', label: '操作系统', kind: 'select', options: ['统信 UOS', '银河麒麟', 'Windows 11', 'Windows 10', '不适用'] },
        { key: 'os_version', label: '系统版本' }, { key: 'remark', label: '备注', kind: 'textarea' },
      ] },
    ],
    operations: [
      { id: 'edit', label: '编辑' },
      { id: 'transfer', label: '调换使用人', fields: [{ key: 'to_person', label: '新使用人', required: true }, { key: 'to_department', label: '新部门' }, { key: 'to_room', label: '新房间 / 位置' }, { key: 'new_ip', label: '新 IP' }, { key: 'description', label: '交接说明', kind: 'textarea' }] },
      { id: 'maintenance', label: '维修换件', fields: [
        { key: 'part', label: '维修部件', kind: 'select', options: ['设备', '整机维修排障'], when: (row) => !cloud(row) },
        { key: 'part', label: '维修部件', kind: 'select', options: ['终端主机', '显示器', '整机维修排障'], when: cloud },
        { key: 'old_sn', label: '换下件 SN' }, { key: 'new_sn', label: '换上件 SN' },
        { key: 'description', label: '维修说明', kind: 'textarea' },
      ] },
      { id: 'history', label: '履历' },
      { id: 'archive', label: '注销归档', fields: [{ key: 'reason', label: '注销说明', kind: 'textarea' }] },
    ],
  };
})();

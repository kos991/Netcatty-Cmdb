(function () {
  'use strict';

  // 全部记录、人员和地址均为设计示例；本文件不读取或保存业务数据。
  // 类型选择优先于旧 asset_class，编辑时从虚拟机切回实体类型即可显示位置字段。
  const isVirtual = (values) => values.type
    ? /虚拟机|virtual|云主机|容器/i.test(values.type)
    : values.asset_class === 'virtual';
  const isPhysical = (values) => !isVirtual(values);
  const isServer = (values) => !isVirtual(values) && /服务器|server|超融合/i.test(values.type || '');
  const hasCompute = (values) => isVirtual(values) || isServer(values);
  const hasDisk = (values) => hasCompute(values) || /存储|storage/i.test(values.type || '');

  window.assetPrototypePages = window.assetPrototypePages || {};
  window.assetPrototypePages.infrastructure = {
    label: '基础设备',
    columns: [
      { key: 'name', label: '设备名 / 资产编号', width: 23, kind: 'asset', secondary: 'code' },
      { key: 'type', label: '设备类型', width: 8 },
      { key: 'vendor_model', label: '品牌 / 型号', width: 13 },
      { key: 'mgmt_ip', label: 'IP 地址', width: 12 },
      { key: 'net_type', label: '网络类型', width: 8 },
      { key: 'location', label: '位置', width: 20 },
      { key: 'person', label: '负责人', width: 9 },
      { key: 'status', label: '状态', width: 7, kind: 'status' }
    ],
    filters: [
      { key: 'type', label: '设备类型' },
      { key: 'department', label: '部门' },
      { key: 'person', label: '负责人' },
      { key: 'vendor', label: '品牌' },
      { key: 'model', label: '型号' },
      { key: 'os_type', label: '操作系统' },
      { key: 'net_type', label: '网络类型' },
      { key: 'location', label: '位置' },
      { key: 'room', label: '房间' },
      { key: 'data_center', label: '机房' },
      { key: 'cabinet_name', label: '机柜' },
      { key: 'floor', label: '楼层' },
      { key: 'cabinet_row', label: '机柜排' },
      { key: 'cabinet_col', label: '机柜列' },
      { key: 'start_u', label: '起始 U 位' },
      { key: 'status', label: '设备状态' }
    ],
    groups: [
      {
        title: '基础信息',
        fields: [
          { key: 'name', label: '设备名称', required: true },
          { key: 'code', label: '资产标签编号（可选）' },
          { key: 'type', label: '设备类型', kind: 'select', options: ['交换机', '物理服务器', '存储设备', '虚拟机'], required: true },
          { key: 'status', label: '设备状态', kind: 'select', options: ['在线', '在库', '维护中', '离线', '故障', '已注销'], required: true },
          { key: 'sn', label: 'SN' },
          { key: 'vendor', label: '品牌 / 厂商', when: isPhysical },
          { key: 'model', label: '型号', when: isPhysical },
          { key: 'provider', label: '供应商' },
          { key: 'remark', label: '备注（原型示例）', kind: 'textarea' }
        ]
      },
      {
        title: '归属关系',
        fields: [
          { key: 'organization', label: '所属组织', kind: 'select', options: ['示例信息中心', '示例测试中心'] },
          { key: 'department', label: '部门', kind: 'select', options: ['示例网络组', '示例运维组', '示例存储组', '示例测试组'] },
          { key: 'person', label: '负责人', kind: 'select', options: ['示例管理员甲', '示例管理员乙', '示例管理员丙', '示例管理员丁', '未分配负责人'] }
        ]
      },
      {
        title: '安装位置（仅实体设备）',
        fields: [
          { key: 'room', label: '房间 / 具体位置', when: isPhysical },
          { key: 'data_center', label: '所属机房（不含机柜名）', when: isPhysical },
          { key: 'cabinet_name', label: '机柜名称（可留空）', when: isPhysical },
          { key: 'floor', label: '楼层', when: isPhysical },
          { key: 'cabinet_row', label: '机柜排', when: isPhysical },
          { key: 'cabinet_col', label: '机柜列', kind: 'number', when: isPhysical },
          { key: 'start_u', label: '起始 U 位（0 表示未上架）', kind: 'number', when: isPhysical },
          { key: 'height_u', label: '占用 U 数', kind: 'number', when: isPhysical }
        ]
      },
      {
        title: '网络配置',
        fields: [
          { key: 'mgmt_ip', label: '管理 IP（可留空）' },
          { key: 'net_type', label: '管理 IP 网络类型', kind: 'select', options: ['内网', '专网', '外网', '未配置'] },
          { key: 'biz_ip', label: '业务 IP（兼容字段）' },
          { key: 'business_network_type', label: '业务 IP 网络类型', kind: 'select', options: ['内网', '专网', '外网', '未配置'] }
        ]
      },
      {
        title: '硬件、计算与系统',
        fields: [
          { key: 'vcpu', label: 'vCPU（核）', kind: 'number', when: isVirtual },
          { key: 'cpu_info', label: 'CPU 配置', when: isServer },
          { key: 'memory_mb', label: '内存（MB）', kind: 'number', when: hasCompute },
          { key: 'disk_info', label: '硬盘 / 磁盘配置', when: hasDisk },
          { key: 'os_type', label: '操作系统类型', kind: 'select', options: ['VMware ESXi', 'Windows Server', 'openEuler', 'Ubuntu', 'Rocky Linux'], when: hasCompute },
          { key: 'os_version', label: '操作系统版本', when: hasCompute }
        ]
      }
    ],
    operations: [
      { id: 'edit', label: '编辑' },
      { id: 'history', label: '履历', fields: [{ key: 'history', label: '示例履历（仅预览）', kind: 'textarea' }] },
      { id: 'clone', label: '克隆设备', fields: [{ key: 'name', label: '新设备名称', required: true }, { key: 'code', label: '新资产标签编号' }] },
      { id: 'archive', label: '注销归档', fields: [{ key: 'archive_reason', label: '注销说明（保留资产及履历）', kind: 'textarea', required: true }] }
    ],
    rows: [
      {
        id: 'infra-example-01', name: '示例核心交换机 A', code: 'DEMO-NET-SW-001', type: '交换机', asset_class: 'physical',
        vendor: 'H3C', model: 'S6850-56HF', vendor_model: 'H3C / S6850-56HF', sn: 'DEMO-SW-2026-0001', provider: '示例网络服务商',
        organization: '示例信息中心', department: '示例网络组', person: '示例管理员甲', status: '在线',
        mgmt_ip: '192.0.2.11', net_type: '内网', biz_ip: '', business_network_type: '未配置',
        location: '示例主机房 / A01 / 39U–40U', room: '示例设备间 201', data_center: '示例主机房', cabinet_name: 'A01', floor: '2 层', cabinet_row: 'A 排', cabinet_col: 1, start_u: 39, height_u: 2,
        remark: '设计示例：实体交换机已上架；机房、机柜和 U 位分别记录。',
        history: '2026-09-02 示例：登记设备并上架 A01 的 39U–40U。\n2026-10-08 示例：更新管理网络资料，状态保持在线。',
        relations: [{ label: '机柜（示例）', value: '示例主机房 / A01', href: 'rack-layout-preview.html#rack' }, { label: '管理 IP（示例）', value: '192.0.2.11 / 示例地址池', href: 'network-preview.html' }]
      },
      {
        id: 'infra-example-02', name: '示例接入交换机 B', code: 'DEMO-NET-SW-002', type: '交换机', asset_class: 'physical',
        vendor: '华为', model: 'S5735-L48T4X', vendor_model: '华为 / S5735-L48T4X', sn: 'DEMO-SW-2026-0002', provider: '示例网络服务商',
        organization: '示例信息中心', department: '示例网络组', person: '示例管理员甲', status: '维护中',
        mgmt_ip: '192.0.2.12', net_type: '专网', biz_ip: '', business_network_type: '未配置',
        location: '示例接入机房 / B02 / 35U', room: '示例设备间 301', data_center: '示例接入机房', cabinet_name: 'B02', floor: '3 层', cabinet_row: 'B 排', cabinet_col: 2, start_u: 35, height_u: 1,
        remark: '设计示例：维护中仍保留机柜位置和管理 IP。',
        history: '2026-08-16 示例：登记接入交换机。\n2026-10-12 示例：进入维护窗口，核对接口配置。',
        relations: [{ label: '维护记录（示例）', value: '示例接口配置核查 / 维护中' }, { label: '管理 IP（示例）', value: '192.0.2.12', href: 'network-preview.html' }]
      },
      {
        id: 'infra-example-03', name: '示例备用交换机', code: 'DEMO-NET-SPARE-003', type: '交换机', asset_class: 'physical',
        vendor: '锐捷', model: 'RG-S2910', vendor_model: '锐捷 / RG-S2910', sn: 'DEMO-SPARE-0003', provider: '示例网络服务商',
        organization: '示例信息中心', department: '示例网络组', person: '未分配负责人', status: '在库',
        mgmt_ip: '', net_type: '未配置', biz_ip: '', business_network_type: '未配置',
        location: '未配置位置', room: '', data_center: '', cabinet_name: '', floor: '', cabinet_row: '', cabinet_col: 0, start_u: 0, height_u: 1,
        remark: '设计示例：尚未配置位置、IP 和关联对象，可用于未配置筛选。',
        history: '2026-10-01 示例：备用设备入库，尚未分配负责人或网络地址。', relations: []
      },
      {
        id: 'infra-example-04', name: '示例虚拟化宿主机', code: 'DEMO-SRV-HOST-004', type: '物理服务器', asset_class: 'physical',
        vendor: 'Dell', model: 'PowerEdge R750', vendor_model: 'Dell / PowerEdge R750', sn: 'DEMO-SERVER-0004', provider: '示例计算服务商',
        organization: '示例信息中心', department: '示例运维组', person: '示例管理员乙', status: '在线',
        mgmt_ip: '192.0.2.21', net_type: '内网', biz_ip: '198.51.100.21', business_network_type: '专网',
        location: '示例主机房 / A01 / 21U–22U', room: '示例设备间 201', data_center: '示例主机房', cabinet_name: 'A01', floor: '2 层', cabinet_row: 'A 排', cabinet_col: 1, start_u: 21, height_u: 2,
        cpu_info: '2 × Intel Xeon Gold / 示例配置', memory_mb: 262144, disk_info: '2 × 960 GB SSD / 示例 RAID 1', os_type: 'VMware ESXi', os_version: '8.0（示例）',
        remark: '设计示例：管理 IP 与业务 IP 使用不同网络类型，不能相互借用。',
        history: '2026-07-20 示例：完成宿主机上架。\n2026-09-15 示例：关联两台示例虚拟机。',
        relations: [{ label: '机柜（示例）', value: '示例主机房 / A01', href: 'rack-layout-preview.html#rack' }, { label: '管理 IP（示例）', value: '192.0.2.21', href: 'network-preview.html' }, { label: '虚拟机（示例）', value: '示例应用虚拟机、示例测试虚拟机' }]
      },
      {
        id: 'infra-example-05', name: '示例跨区域灾备数据同步与长期归档物理服务器（长名称截断展示）', code: 'DEMO-INFRASTRUCTURE-PHYSICAL-SERVER-DISASTER-RECOVERY-2026-000000000005', type: '物理服务器', asset_class: 'physical',
        vendor: '联想', model: 'ThinkSystem SR650 V3', vendor_model: '联想 / ThinkSystem SR650 V3', sn: 'DEMO-SN-LONG-DISASTER-RECOVERY-SERVER-2026-ABCDEFGHIJKLMNOPQRSTUVWXYZ-0005', provider: '示例计算服务商',
        organization: '示例信息中心', department: '示例运维组', person: '示例管理员乙', status: '在线',
        mgmt_ip: '192.0.2.22', net_type: '专网', biz_ip: '198.51.100.22', business_network_type: '专网',
        location: '示例灾备机房 / DR01 / 13U–14U', room: '示例灾备设备间', data_center: '示例灾备机房', cabinet_name: 'DR01', floor: '1 层', cabinet_row: 'D 排', cabinet_col: 1, start_u: 13, height_u: 2,
        cpu_info: '2 × Intel Xeon Silver / 示例配置', memory_mb: 131072, disk_info: '8 × 4 TB SAS / 示例 RAID 6', os_type: 'Rocky Linux', os_version: '9.4（示例）',
        remark: '设计示例：同时覆盖长名称、长资产编号和长 SN 的详情查看。',
        history: '2026-06-03 示例：登记灾备设备。\n2026-09-24 示例：核对长资产编号与 SN，不改变网络配置。',
        relations: [{ label: '业务系统（示例）', value: '示例归档服务' }, { label: '管理 IP（示例）', value: '192.0.2.22', href: 'network-preview.html' }]
      },
      {
        id: 'infra-example-06', name: '示例待上架数据库服务器', code: 'DEMO-SRV-PENDING-006', type: '物理服务器', asset_class: 'physical',
        vendor: 'H3C', model: 'UniServer R4900 G5', vendor_model: 'H3C / UniServer R4900 G5', sn: 'DEMO-SERVER-0006', provider: '示例计算服务商',
        organization: '示例信息中心', department: '示例运维组', person: '示例管理员乙', status: '离线',
        mgmt_ip: '192.0.2.23', net_type: '内网', biz_ip: '', business_network_type: '未配置',
        location: '示例主机房 / 未分配机柜 / 未上架', room: '', data_center: '示例主机房', cabinet_name: '', floor: '2 层', cabinet_row: '', cabinet_col: 0, start_u: 0, height_u: 2,
        cpu_info: '2 × Intel Xeon / 示例配置', memory_mb: 65536, disk_info: '4 × 1.92 TB SSD / 示例 RAID 10', os_type: 'openEuler', os_version: '24.03（示例）',
        remark: '设计示例：只记录机房，机柜留空；起始 U 为 0，不伪造已上架位置。',
        history: '2026-10-09 示例：登记所属机房，等待分配机柜及上架。', relations: []
      },
      {
        id: 'infra-example-07', name: '示例文件存储阵列', code: 'DEMO-STORAGE-007', type: '存储设备', asset_class: 'physical',
        vendor: '华为', model: 'OceanStor 5300', vendor_model: '华为 / OceanStor 5300', sn: 'DEMO-STORAGE-0007', provider: '示例存储服务商',
        organization: '示例信息中心', department: '示例存储组', person: '示例管理员丙', status: '在线',
        mgmt_ip: '192.0.2.31', net_type: '内网', biz_ip: '198.51.100.31', business_network_type: '专网',
        location: '示例主机房 / A02 / 9U–12U', room: '示例设备间 201', data_center: '示例主机房', cabinet_name: 'A02', floor: '2 层', cabinet_row: 'A 排', cabinet_col: 2, start_u: 9, height_u: 4,
        disk_info: '24 × 8 TB SAS / 示例双控制器',
        remark: '设计示例：存储设备显示磁盘配置，不显示服务器 CPU 或虚拟机 vCPU。',
        history: '2026-05-12 示例：存储阵列上架。\n2026-08-30 示例：扩充示例磁盘配置。',
        relations: [{ label: '关联服务器（示例）', value: '示例虚拟化宿主机' }, { label: '机柜（示例）', value: '示例主机房 / A02', href: 'rack-layout-preview.html#rack' }]
      },
      {
        id: 'infra-example-08', name: '示例故障备份存储', code: 'DEMO-STORAGE-FAULT-008', type: '存储设备', asset_class: 'physical',
        vendor: 'Dell', model: 'PowerVault ME5024', vendor_model: 'Dell / PowerVault ME5024', sn: 'DEMO-STORAGE-0008', provider: '示例存储服务商',
        organization: '示例信息中心', department: '示例存储组', person: '示例管理员丙', status: '故障',
        mgmt_ip: '', net_type: '未配置', biz_ip: '', business_network_type: '未配置',
        location: '示例维修间 / 工作台（未上架）', room: '示例维修间 / 工作台', data_center: '', cabinet_name: '', floor: '1 层', cabinet_row: '', cabinet_col: 0, start_u: 0, height_u: 2,
        disk_info: '12 × 4 TB HDD / 示例故障待检',
        remark: '设计示例：设备已下架，只有明确房间位置，无 IP 或机柜关联。',
        history: '2026-09-18 示例：检测到控制器故障。\n2026-09-19 示例：下架至维修工作台，清除已停用地址关联。', relations: []
      },
      {
        id: 'infra-example-09', name: '示例应用虚拟机', code: 'DEMO-VM-APP-009', type: '虚拟机', asset_class: 'virtual',
        vendor: '', model: '', vendor_model: '不适用（虚拟资源）', sn: 'DEMO-VM-UUID-0009', provider: '示例虚拟化平台',
        organization: '示例信息中心', department: '示例运维组', person: '示例管理员乙', status: '在线',
        mgmt_ip: '192.0.2.41', net_type: '内网', biz_ip: '198.51.100.41', business_network_type: '专网', location: '无实体位置',
        vcpu: 8, memory_mb: 16384, disk_info: '200 GB / 示例虚拟磁盘', os_type: 'Windows Server', os_version: '2022（示例）',
        remark: '设计示例：虚拟机仅记录计算资源，不填写实体机房、机柜或 U 位。',
        history: '2026-08-01 示例：创建应用虚拟机。\n2026-10-05 示例：由 4 vCPU 调整为 8 vCPU。',
        relations: [{ label: '宿主机（示例）', value: '示例虚拟化宿主机' }, { label: '业务系统（示例）', value: '示例应用服务' }, { label: '管理 IP（示例）', value: '192.0.2.41', href: 'network-preview.html' }]
      },
      {
        id: 'infra-example-10', name: '示例测试虚拟机', code: 'DEMO-VM-TEST-010', type: '虚拟机', asset_class: 'virtual',
        vendor: '', model: '', vendor_model: '不适用（虚拟资源）', sn: 'DEMO-VM-UUID-0010', provider: '示例虚拟化平台',
        organization: '示例测试中心', department: '示例测试组', person: '示例管理员丁', status: '在线',
        mgmt_ip: '', net_type: '未配置', biz_ip: '', business_network_type: '未配置', location: '无实体位置',
        vcpu: 2, memory_mb: 4096, disk_info: '60 GB / 示例虚拟磁盘', os_type: 'Ubuntu', os_version: '24.04（示例）',
        remark: '设计示例：隔离测试虚拟机尚未分配 IP；无宿主机关联不等于实体位置未配置。',
        history: '2026-10-10 示例：登记隔离测试资源，等待关联宿主机。', relations: []
      },
      {
        id: 'infra-example-11', name: '示例外网代理虚拟机', code: 'DEMO-VM-PROXY-011', type: '虚拟机', asset_class: 'virtual',
        vendor: '', model: '', vendor_model: '不适用（虚拟资源）', sn: 'DEMO-VM-UUID-0011', provider: '示例云资源服务商',
        organization: '示例测试中心', department: '示例测试组', person: '示例管理员丁', status: '在线',
        mgmt_ip: '2001:db8:1234:5678:abcd:ef01:2345:6789', net_type: '外网', biz_ip: '203.0.113.51', business_network_type: '外网', location: '无实体位置',
        vcpu: 4, memory_mb: 8192, disk_info: '100 GB / 示例云磁盘', os_type: 'openEuler', os_version: '24.03（示例）',
        remark: '设计示例：使用文档专用 IPv6 与 IPv4 地址，覆盖长地址截断及外网筛选。',
        history: '2026-09-06 示例：登记外网代理虚拟资源。\n2026-10-11 示例：补录文档专用 IPv6 地址。',
        relations: [{ label: '承载平台（示例）', value: '示例云资源平台 / 非实体机柜' }, { label: '管理 IP（示例）', value: '2001:db8:1234:5678:abcd:ef01:2345:6789', href: 'network-preview.html' }]
      },
      {
        id: 'infra-example-12', name: '示例已注销历史服务器', code: 'DEMO-SRV-ARCHIVED-012', type: '物理服务器', asset_class: 'physical',
        vendor: '联想', model: 'ThinkSystem SR550', vendor_model: '联想 / ThinkSystem SR550', sn: 'DEMO-SERVER-HISTORY-0012', provider: '示例计算服务商',
        organization: '示例信息中心', department: '示例运维组', person: '示例管理员乙', status: '已注销',
        mgmt_ip: '', net_type: '未配置', biz_ip: '', business_network_type: '未配置',
        location: '示例回收暂存间 / 待回收区（未上架）', room: '示例回收暂存间 / 待回收区', data_center: '', cabinet_name: '', floor: '1 层', cabinet_row: '', cabinet_col: 0, start_u: 0, height_u: 2,
        cpu_info: '1 × Intel Xeon / 示例历史配置', memory_mb: 32768, disk_info: '2 × 1 TB HDD / 示例历史配置', os_type: 'Windows Server', os_version: '2019（示例）',
        remark: '设计示例：注销后保留资产档案和履历；地址已释放，当前状态通过筛选查回。',
        archive_reason: '示例：设备到期退役，已完成资料核对并移交回收。',
        history: '2024-03-12 示例：历史服务器登记。\n2026-09-27 示例：下架并释放地址，原机柜为示例主机房 A02 的 25U–26U。\n2026-09-30 示例：注销归档，保留资产资料与履历。',
        relations: [{ label: '归档记录（示例）', value: '示例设备到期退役 / 2026-09-30' }]
      }
    ]
  };
})();

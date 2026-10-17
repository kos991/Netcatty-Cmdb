(function () {
  'use strict';

  window.assetPrototypePages = window.assetPrototypePages || {};

  window.assetPrototypePages.systems = {
    label: '业务系统',
    columns: [
      { key: 'name', label: '系统名称 / 资产编号', width: 16, kind: 'asset', secondary: 'code' },
      { key: 'type', label: '系统类型', width: 8 },
      { key: 'version', label: '版本', width: 7 },
      { key: 'server_name', label: '承载设备', width: 12 },
      { key: 'access_url', label: '访问地址', width: 22, kind: 'address' },
      { key: 'service_ip', label: '业务 IP', width: 13 },
      { key: 'network_type', label: '网络类型', width: 7 },
      { key: 'person', label: '负责人', width: 8 },
      { key: 'status', label: '状态', width: 9, kind: 'status' }
    ],
    filters: [
      { key: 'type', label: '系统类型' },
      { key: 'provider', label: '供应商' },
      { key: 'department', label: '部门' },
      { key: 'person', label: '负责人' },
      { key: 'server_name', label: '承载设备' },
      { key: 'host_linked', label: '承载关联' },
      { key: 'network_type', label: '网络类型' },
      { key: 'status', label: '状态' }
    ],
    groups: [
      {
        title: '系统配置',
        fields: [
          { key: 'name', label: '系统名称', required: true },
          { key: 'code', label: '资产编号', required: true },
          { key: 'type', label: '系统类型', kind: 'select', required: true, options: ['业务应用', '门户系统', '数据库服务', '基础支撑', '运维平台'] },
          { key: 'version', label: '版本' },
          { key: 'provider', label: '供应商' },
          { key: 'deployment', label: '部署方式', kind: 'select', options: ['虚拟机部署', '物理机部署', '容器部署', '托管服务', '待部署'] },
          { key: 'port', label: '端口' },
          { key: 'access_url', label: '访问入口' },
          { key: 'middleware', label: '中间件' },
          { key: 'database_info', label: '数据库' },
          { key: 'status', label: '状态', kind: 'select', options: ['正常运行', '维护中', '待上线', '已停用', '已注销'] }
        ]
      },
      {
        title: '归属与承载',
        fields: [
          { key: 'person', label: '负责人' },
          { key: 'department', label: '所属部门' },
          { key: 'server_name', label: '承载设备（可选）', kind: 'select', options: ['未关联', '示例应用虚拟机 A', '示例门户虚拟机 B', '示例数据库服务器 C', '示例容器节点 D', '示例备份服务器 E', '示例运维虚拟机 F'] },
          { key: 'deployment_location', label: '部署位置' },
          { key: 'description', label: '说明', kind: 'textarea' },
          { key: 'remark', label: '备注', kind: 'textarea' }
        ]
      },
      {
        title: '系统自身业务地址',
        fields: [
          { key: 'service_ip', label: '业务 IP（非承载设备管理 IP）' },
          { key: 'network_type', label: '网络类型（由业务 IP 所属地址池确认）' },
          { key: 'network_source', label: '网络类型来源' },
          { key: 'ipam', label: '地址池关联' }
        ]
      },
      {
        title: '运维履历（示例）',
        fields: [{ key: 'history', label: '履历记录', kind: 'textarea' }]
      }
    ],
    operations: [
      { id: 'edit', label: '编辑' },
      { id: 'history', label: '履历', fields: [{ key: 'history', label: '履历记录（示例，只读预览）', kind: 'textarea' }] },
      { id: 'archive', label: '注销归档', fields: [{ key: 'archive_reason', label: '注销原因（示例）', kind: 'textarea', required: true }] }
    ],
    rows: [
      {
        id: 'sys-example-01', name: '示例审判协同系统', code: 'DEMO-SYS-001', type: '业务应用',
        department: '示例业务一部', person: '示例负责人甲', status: '正常运行',
        version: '5.2.1', provider: '示例软件供应商 A', deployment: '虚拟机部署',
        server_name: '示例应用虚拟机 A', host_linked: '已关联', deployment_location: '示例主机房 · 应用资源池 A',
        service_ip: '10.28.60.21', network_type: '专网', network_source: '示例专网业务地址池 10.28.60.0/24', ipam: '已纳入示例专网业务地址池',
        port: '8443', access_url: 'https://trial.demo.example:8443/', middleware: 'Tomcat 10', database_info: 'PostgreSQL 15 · 示例协同库',
        description: '示例：业务 IP 为系统服务入口，不是承载虚拟机的管理地址。', remark: '纯设计样例，不连接真实系统。',
        history: '2026-10-12 示例：升级至 5.2.1。\n2026-09-18 示例：关联应用虚拟机 A。',
        relations: [
          { label: '承载设备', value: '示例应用虚拟机 A', href: 'device-assets-preview.html#infrastructure' },
          { label: '业务地址', value: '10.28.60.21 · 示例专网业务地址池', href: 'network-preview.html' }
        ]
      },
      {
        id: 'sys-example-02', name: '示例统一信息门户', code: 'DEMO-SYS-002', type: '门户系统',
        department: '示例综合部', person: '示例负责人乙', status: '正常运行',
        version: '3.8.0', provider: '示例软件供应商 B', deployment: '虚拟机部署',
        server_name: '示例门户虚拟机 B', host_linked: '已关联', deployment_location: '示例主机房 · 门户资源池',
        service_ip: '192.0.2.22', network_type: '外网', network_source: '示例互联网发布地址池 192.0.2.0/24', ipam: '已纳入示例互联网发布地址池',
        port: '443', access_url: 'https://portal.demo.example/', middleware: 'Nginx 1.26', database_info: 'MySQL 8 · 示例门户库',
        description: '示例：使用文档保留网段展示发布地址，不代表真实公网服务。', remark: '域名为示例专用域名。',
        history: '2026-10-09 示例：更新门户访问入口。\n2026-08-20 示例：创建系统档案。',
        relations: [
          { label: '承载设备', value: '示例门户虚拟机 B', href: 'device-assets-preview.html#infrastructure' },
          { label: '业务地址', value: '192.0.2.22 · 示例互联网发布地址池', href: 'network-preview.html' }
        ]
      },
      {
        id: 'sys-example-03', name: '示例电子卷宗数据库', code: 'DEMO-SYS-003', type: '数据库服务',
        department: '示例数据部', person: '示例负责人丙', status: '维护中',
        version: 'DM8', provider: '示例数据库供应商', deployment: '物理机部署',
        server_name: '示例数据库服务器 C', host_linked: '已关联', deployment_location: '示例主机房 · A02 柜 · U18–U21',
        service_ip: '10.28.70.31', network_type: '内网', network_source: '示例数据服务地址池 10.28.70.0/24', ipam: '已纳入示例数据服务地址池',
        port: '5236', access_url: 'dm://10.28.70.31:5236/demo_archive', middleware: '不适用', database_info: 'DM8 · 示例卷宗库',
        description: '示例：数据库服务维护窗口，保留现有承载与业务地址。', remark: '连接串不包含用户名或密码。',
        history: '2026-10-14 示例：进入维护窗口，执行索引维护。\n2026-07-11 示例：登记数据库服务。',
        relations: [
          { label: '承载设备', value: '示例数据库服务器 C', href: 'device-assets-preview.html#infrastructure' },
          { label: '业务地址', value: '10.28.70.31 · 示例数据服务地址池', href: 'network-preview.html' }
        ]
      },
      {
        id: 'sys-example-04', name: '示例消息交换服务', code: 'DEMO-SYS-004', type: '基础支撑',
        department: '示例技术部', person: '示例负责人丁', status: '正常运行',
        version: '3.13.7', provider: '示例开源维护团队', deployment: '容器部署',
        server_name: '示例容器节点 D', host_linked: '已关联', deployment_location: '示例容器集群 · support 命名空间',
        service_ip: '10.28.60.44', network_type: '专网', network_source: '示例专网业务地址池 10.28.60.0/24', ipam: '已纳入示例专网业务地址池',
        port: '5672 / 15672', access_url: 'https://message.demo.example/', middleware: 'RabbitMQ', database_info: '不适用',
        description: '示例：容器服务使用独立业务入口，不将容器节点管理 IP 视作服务 IP。', remark: '不展示消息凭证。',
        history: '2026-10-08 示例：滚动升级消息服务。\n2026-09-01 示例：迁入容器节点 D。',
        relations: [
          { label: '承载设备', value: '示例容器节点 D', href: 'device-assets-preview.html#infrastructure' },
          { label: '业务地址', value: '10.28.60.44 · 示例专网业务地址池', href: 'network-preview.html' }
        ]
      },
      {
        id: 'sys-example-05', name: '示例预约服务（待部署）', code: 'DEMO-SYS-005', type: '业务应用',
        department: '示例服务部', person: '示例负责人戊', status: '待上线',
        version: '1.0.0-rc.2', provider: '示例软件供应商 A', deployment: '待部署',
        server_name: '未关联', host_linked: '未关联', deployment_location: '未配置',
        service_ip: '', network_type: '未配置', network_source: '无业务 IP，未解析网络类型', ipam: '未关联',
        port: '未配置', access_url: '', middleware: '待选型', database_info: '待选型',
        description: '示例：尚未分配业务 IP、承载设备和部署位置；不得借用其他设备地址。', remark: '用于预览无 IP、无承载关联的完整详情与录入。',
        history: '2026-10-13 示例：登记待上线系统，承载资源待确认。', relations: []
      },
      {
        id: 'sys-example-06', name: '示例历史接口网关', code: 'DEMO-SYS-006', type: '基础支撑',
        department: '示例技术部', person: '示例负责人丁', status: '正常运行',
        version: '2.7.4', provider: '示例软件供应商 C', deployment: '虚拟机部署',
        server_name: '示例应用虚拟机 A', host_linked: '已关联', deployment_location: '示例主机房 · 应用资源池 A',
        service_ip: '10.99.14.6', network_type: '未配置', network_source: '业务 IP 尚无匹配地址池；不借用承载设备网络类型', ipam: '未纳入地址池',
        port: '8080', access_url: 'https://legacy-gateway.demo.example/api/', middleware: 'Spring Cloud Gateway', database_info: '无独立数据库',
        description: '示例：已关联承载设备且有业务 IP，但没有可靠网络类型来源，明确显示未配置。', remark: '承载关联不代表业务地址已经纳入 IPAM。',
        history: '2026-10-10 示例：补录遗留系统业务 IP；地址池待维护。',
        relations: [{ label: '承载设备', value: '示例应用虚拟机 A', href: 'device-assets-preview.html#infrastructure' }]
      },
      {
        id: 'sys-example-07', name: '示例托管文书校验服务', code: 'DEMO-SYS-007', type: '业务应用',
        department: '示例业务二部', person: '示例负责人己', status: '正常运行',
        version: '2026.10', provider: '示例托管供应商', deployment: '托管服务',
        server_name: '未关联', host_linked: '未关联', deployment_location: '示例供应商托管环境',
        service_ip: '198.51.100.27', network_type: '未配置', network_source: '仅登记托管服务入口 IP，尚无本项目匹配地址池', ipam: '未纳入地址池',
        port: '443', access_url: 'https://verify.demo.example/v2/documents/', middleware: '供应商托管，未配置', database_info: '供应商托管，未配置',
        description: '示例：外部托管服务没有本地承载设备；不能根据公网样式的地址猜测网络类型。', remark: '198.51.100.0/24 为文档保留网段。',
        history: '2026-09-25 示例：登记托管服务访问入口。', relations: []
      },
      {
        id: 'sys-example-08', name: '示例跨部门电子卷宗目录汇聚与长期归档检索协同服务平台（长名称截断展示）',
        code: 'DEMO-SYSTEM-ARCHIVE-COLLABORATION-2026-VERY-LONG-ASSET-CODE-000008', type: '业务应用',
        department: '示例数据部', person: '示例负责人丙', status: '正常运行',
        version: '2026.10.14-release', provider: '示例软件供应商 B', deployment: '容器部署',
        server_name: '示例容器节点 D', host_linked: '已关联', deployment_location: '示例容器集群 · archive-search 命名空间',
        service_ip: '10.28.60.88', network_type: '专网', network_source: '示例专网业务地址池 10.28.60.0/24', ipam: '已纳入示例专网业务地址池',
        port: '443', access_url: 'https://archive-collaboration.demo.example/application/long-term-document-archive/catalog-search/department-workspace?workspace=example-only&view=complete-record',
        middleware: 'Nginx / Spring Boot', database_info: 'PostgreSQL 15 · 示例检索库',
        description: '示例：用于查看长名称、长资产编号的截断，以及列表中长访问地址的完整换行展示。', remark: 'URL 参数为示例标识，不含令牌。',
        history: '2026-10-14 示例：发布归档检索协同版本。\n2026-09-12 示例：完成目录服务登记。',
        relations: [
          { label: '承载设备', value: '示例容器节点 D', href: 'device-assets-preview.html#infrastructure' },
          { label: '业务地址', value: '10.28.60.88 · 示例专网业务地址池', href: 'network-preview.html' }
        ]
      },
      {
        id: 'sys-example-09', name: '示例离线备份调度', code: 'DEMO-SYS-009', type: '运维平台',
        department: '示例技术部', person: '示例负责人庚', status: '正常运行',
        version: '4.1.2', provider: '示例备份供应商', deployment: '物理机部署',
        server_name: '示例备份服务器 E', host_linked: '已关联', deployment_location: '示例备机房 · B01 柜 · U10–U13',
        service_ip: '', network_type: '未配置', network_source: '离线调度任务无独立业务 IP，不使用承载设备管理地址', ipam: '无业务 IP',
        port: '不适用', access_url: '', middleware: '本地任务调度器', database_info: 'SQLite · 示例任务索引',
        description: '示例：已关联承载设备，但系统本身无业务 IP 和 Web 入口。', remark: '由本地定时任务运行，不能复制承载设备地址填充。',
        history: '2026-10-07 示例：调整离线备份计划。',
        relations: [{ label: '承载设备', value: '示例备份服务器 E', href: 'device-assets-preview.html#infrastructure' }]
      },
      {
        id: 'sys-example-10', name: '示例监控告警平台', code: 'DEMO-SYS-010', type: '运维平台',
        department: '示例技术部', person: '示例负责人庚', status: '维护中',
        version: '7.0.3', provider: '示例开源维护团队', deployment: '虚拟机部署',
        server_name: '示例运维虚拟机 F', host_linked: '已关联', deployment_location: '示例主机房 · 运维资源池',
        service_ip: '10.28.70.110', network_type: '内网', network_source: '示例数据服务地址池 10.28.70.0/24', ipam: '已纳入示例数据服务地址池',
        port: '443', access_url: 'https://monitor.demo.example/', middleware: 'Nginx / PHP-FPM', database_info: 'PostgreSQL 15 · 示例监控库',
        description: '示例：维护期间保留系统地址及负责人信息。', remark: '未配置任何真实监控凭证。',
        history: '2026-10-15 示例：进入监控模板维护窗口。\n2026-08-05 示例：配置监控业务入口。',
        relations: [
          { label: '承载设备', value: '示例运维虚拟机 F', href: 'device-assets-preview.html#infrastructure' },
          { label: '业务地址', value: '10.28.70.110 · 示例数据服务地址池', href: 'network-preview.html' }
        ]
      },
      {
        id: 'sys-example-11', name: '示例旧版公告门户', code: 'DEMO-SYS-011', type: '门户系统',
        department: '示例综合部', person: '示例负责人乙', status: '已注销',
        version: '1.6.0', provider: '示例软件供应商 B', deployment: '虚拟机部署',
        server_name: '未关联', host_linked: '未关联', deployment_location: '已下线，历史部署于示例门户资源池',
        service_ip: '', network_type: '未配置', network_source: '业务 IP 已释放，不保留有效网络类型', ipam: '已释放，无当前地址关联',
        port: '443（历史）', access_url: 'https://retired-portal.demo.example/', middleware: 'Tomcat 8（历史）', database_info: '历史库已归档',
        description: '示例：注销后保留系统资料和履历；访问入口仅作历史记录，不代表可访问。', remark: '可通过状态筛选查看已注销记录。',
        archive_reason: '示例：已由统一信息门户替代，资料归档、业务 IP 释放。',
        history: '2026-10-01 示例：注销归档，释放业务 IP，解除当前承载关联。\n2026-09-20 示例：迁移至统一信息门户。\n2025-03-10 示例：创建旧版门户档案。',
        relations: []
      },
      {
        id: 'sys-example-12', name: '示例 IPv6 访问门户', code: 'DEMO-SYS-012', type: '门户系统',
        department: '示例服务部', person: '示例负责人戊', status: '已停用',
        version: '2.0.0-beta.4', provider: '示例软件供应商 C', deployment: '虚拟机部署',
        server_name: '示例门户虚拟机 B', host_linked: '已关联', deployment_location: '示例主机房 · 门户资源池',
        service_ip: '2001:db8:28:60::126', network_type: '外网', network_source: '示例 IPv6 发布地址池 2001:db8:28:60::/64', ipam: '已纳入示例 IPv6 发布地址池',
        port: '443', access_url: 'https://ipv6-portal.demo.example/', middleware: 'Nginx 1.26', database_info: '无独立数据库',
        description: '示例：IPv6 地址使用文档保留前缀，停用不等于注销，仍保留当前承载关联。', remark: '用于检查较长业务地址的展示。',
        history: '2026-10-11 示例：暂停 IPv6 门户试运行，保留部署资料。\n2026-09-03 示例：登记 IPv6 业务入口。',
        relations: [
          { label: '承载设备', value: '示例门户虚拟机 B', href: 'device-assets-preview.html#infrastructure' },
          { label: '业务地址', value: '2001:db8:28:60::126 · 示例 IPv6 发布地址池', href: 'network-preview.html' }
        ]
      }
    ]
  };
}());

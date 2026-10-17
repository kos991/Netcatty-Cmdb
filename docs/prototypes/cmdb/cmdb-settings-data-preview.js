(() => {
  'use strict';
  // Project-directory fixtures only; these are not records or statistics from a project.
  // Fields follow Taxonomy / ConfigCenter and the taxonomy / config store contracts.
  const basic = [
    { key: 'name', label: '名称', required: true },
    { key: 'remark', label: '说明', type: 'textarea' },
    { key: 'sort_order', label: '排序', type: 'number', min: 0 },
  ];
  const taxonomy = [
    { key: 'name', label: '名称', required: true },
    { key: 'parent_id', label: '上级', type: 'parent' },
    { key: 'sort_order', label: '排序', type: 'number', min: 0 },
  ];
  window.cmdbSettingsPreviewCatalogs = {
    terminal: {
      title: '终端资产分类', kind: 'taxonomy',
      fields: [...taxonomy, { key: 'short_code', label: '设备简称', description: '用于终端自动命名，例如 PC、VDI。' }],
      entries: [
        { id: 1100, parent_id: 0, name: '计算终端', sort_order: 10, short_code: '' },
        { id: 1110, parent_id: 1100, name: '办公电脑', sort_order: 10, short_code: '' },
        { id: 1111, parent_id: 1110, name: '台式机', sort_order: 10, short_code: 'PC' },
        { id: 1112, parent_id: 1110, name: '笔记本', sort_order: 20, short_code: 'NB' },
        { id: 1120, parent_id: 1100, name: '云桌面', sort_order: 20, short_code: 'VDI' },
        { id: 1130, parent_id: 1100, name: '云盒', sort_order: 30, short_code: 'BOX' },
        { id: 1200, parent_id: 0, name: '办公外设', sort_order: 20, short_code: '' },
        { id: 1210, parent_id: 1200, name: '打印机', sort_order: 10, short_code: 'PRT' },
        { id: 1220, parent_id: 1200, name: '扫描仪', sort_order: 20, short_code: 'SCAN' },
      ],
    },
    infrastructure: {
      title: '基础设施分类', kind: 'taxonomy', fields: taxonomy,
      entries: [
        { id: 2100, parent_id: 0, name: '网络设备', sort_order: 10 },
        { id: 2110, parent_id: 2100, name: '交换机', sort_order: 10 },
        { id: 2120, parent_id: 2100, name: '路由器', sort_order: 20 },
        { id: 2200, parent_id: 0, name: '计算与存储', sort_order: 20 },
        { id: 2210, parent_id: 2200, name: '物理服务器', sort_order: 10 },
        { id: 2220, parent_id: 2200, name: '虚拟机', sort_order: 20 },
        { id: 2230, parent_id: 2200, name: '存储设备', sort_order: 30 },
        { id: 2240, parent_id: 2200, name: '超融合', sort_order: 40 },
      ],
    },
    systems: {
      title: '业务系统分类', kind: 'taxonomy', fields: taxonomy,
      entries: [
        { id: 3100, parent_id: 0, name: '业务应用', sort_order: 10 },
        { id: 3110, parent_id: 3100, name: '内部办公', sort_order: 10 },
        { id: 3120, parent_id: 3100, name: '门户系统', sort_order: 20 },
        { id: 3200, parent_id: 0, name: '基础支撑', sort_order: 20 },
        { id: 3210, parent_id: 3200, name: '数据库服务', sort_order: 10 },
        { id: 3220, parent_id: 3200, name: '运维平台', sort_order: 20 },
      ],
    },
    network: {
      title: '网络类型', kind: 'list', fields: basic,
      entries: [
        { id: 4100, name: '专网', remark: '专用业务网络', sort_order: 10 },
        { id: 4200, name: '外网', remark: '互联网访问网络', sort_order: 20 },
        { id: 4300, name: '内网', remark: '内部办公网络', sort_order: 30 },
      ],
    },
    models: {
      title: '型号库', kind: 'list',
      fields: [{ key: 'vendor', label: '品牌 / 厂商', required: true }, { key: 'model', label: '型号', required: true }],
      entries: [
        { id: 5100, vendor: 'H3C', model: 'S6850-56HF' },
        { id: 5200, vendor: '华为', model: 'S5735-L48T4X' },
        { id: 5300, vendor: '锐捷', model: 'RG-S2910' },
        { id: 5400, vendor: 'Dell', model: 'PowerEdge R750' },
        { id: 5500, vendor: '联想', model: 'ThinkSystem SR650 V3' },
      ],
    },
    categories: {
      title: '工单类别', kind: 'list', fields: basic,
      entries: [
        { id: 6100, name: '故障处理', remark: '处理设备或系统故障', sort_order: 10 },
        { id: 6200, name: '日常维护', remark: '例行检查与维护', sort_order: 20 },
        { id: 6300, name: '变更操作', remark: '配置和部署变更', sort_order: 30 },
        { id: 6400, name: '资产调配', remark: '资产交付与调配', sort_order: 40 },
      ],
    },
    operations: {
      title: '运维类型', kind: 'list', fields: basic,
      entries: [
        { id: 7100, name: '排障', remark: '定位与处理问题', sort_order: 10 },
        { id: 7200, name: '优化', remark: '性能与配置优化', sort_order: 20 },
        { id: 7300, name: '响应', remark: '业务支持与响应', sort_order: 30 },
        { id: 7400, name: '值守', remark: '现场与远程值守', sort_order: 40 },
      ],
    },
    priorities: {
      title: '优先级', kind: 'list', fields: basic,
      entries: [
        { id: 8100, name: 'P1（紧急）', remark: '关键业务中断', sort_order: 10 },
        { id: 8200, name: 'P2（较高）', remark: '重要业务受影响', sort_order: 20 },
        { id: 8300, name: 'P3（普通）', remark: '一般运维请求', sort_order: 30 },
        { id: 8400, name: 'P4（较低）', remark: '计划性维护事项', sort_order: 40 },
      ],
    },
  };
})();

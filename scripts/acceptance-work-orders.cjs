// 隔离测试机的工单布局验收数据；通过正式接口创建和逐步流转，不重置现有数据。
async function ensureWorkOrderFixtures(baseUrl) {
  async function request(method, path, body) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const value = await response.json();
    if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${JSON.stringify(value)}`);
    return value;
  }
  const catalogs = {
    'work-order-categories': ['故障处理', '日常维护', '变更操作', '资产调配'],
    'work-order-types': ['排障', '优化', '响应', '值守'],
    'work-order-priorities': ['P1（紧急）', 'P2（较高）', 'P3（普通）', 'P4（较低）'],
  };
  for (const [kind, names] of Object.entries(catalogs)) {
    const existing = await request('GET', `/api/cmdb/config/${kind}`);
    for (const [sort_order, name] of names.entries()) {
      if (!existing.list.some(item => item.name === name)) await request('POST', `/api/cmdb/config/${kind}`, { name, sort_order });
    }
  }
  const infrastructure = await request('GET', '/api/cmdb/assets?scope=infrastructure&page=1&page_size=500');
  const terminals = await request('GET', '/api/assets?page=1&page_size=500');
  const applications = await request('GET', '/api/apps?page=1&page_size=500');
  const refs = [
    ...infrastructure.list.map(item => ({ asset_type: 'infrastructure', asset_id: item.id, asset_name: item.name, code: item.asset_code })),
    ...terminals.list.map(item => ({ asset_type: 'terminal', asset_id: item.id, asset_name: item.asset_name, code: item.asset_code })),
    ...applications.list.map(item => ({ asset_type: 'application', asset_id: item.id, asset_name: item.app_name, code: item.asset_code })),
  ];
  const fixtures = [
    ['验收核心交换机端口间歇中断', 'VERIFY-INFRA-SW-01', '处理中'],
    ['验收笔记本无法访问业务系统', 'VERIFY-LAPTOP-01', '新建'],
    ['验收台式机硬件资料核对', 'VERIFY-DESKTOP-01', '新建'],
    ['验收防火墙访问策略调整', 'VERIFY-INFRA-SEC-01', '已解决'],
    ['验收主机房例行巡检', 'VERIFY-INFRA-SRV-01', '已关闭'],
    ['验收虚拟化宿主机维护', 'VERIFY-INFRA-SRV-01', '处理中'],
    ['验收准入终端策略响应', 'VERIFY-INFRA-SEC-02', '新建'],
    ['验收接入交换机配置核对', 'VERIFY-INFRA-SW-02', '已解决'],
    ['验收业务系统发布窗口值守', 'VERIFY-APP-01', '处理中'],
    ['验收存储阵列容量核查', 'VERIFY-INFRA-STORAGE-01', '已关闭'],
    ['验收超融合节点资源优化', 'VERIFY-INFRA-HCI-01', '已解决'],
    ['验收应用虚拟机补丁安装', 'VERIFY-INFRA-VM-01', '新建'],
    ['验收数据库服务器上架准备', 'VERIFY-INFRA-SRV-02', '新建'],
    ['验收专网访问故障排查', 'VERIFY-INFRA-SEC-01', '处理中'],
    ['验收台式机交接资料归档', 'VERIFY-DESKTOP-01', '已关闭'],
    ['验收维护窗口取消', 'VERIFY-INFRA-SW-02', '已取消'],
  ];
  const existing = await request('GET', '/api/cmdb/work-orders?page=1&page_size=500');
  const now = new Date();
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  let created = 0;
  for (const [index, [subject, code, status]] of fixtures.entries()) {
    if (existing.list.some(item => item.subject === subject)) continue;
    const ref = refs.find(item => item.code === code);
    if (!ref) throw new Error(`验收工单缺少关联资源：${code}`);
    const body = {
      subject, status: '新建', priority: catalogs['work-order-priorities'][index % 4],
      biz_type: catalogs['work-order-categories'][index % 4], operation_type: catalogs['work-order-types'][index % 4],
      plan_time: `${day} 09:${String(index * 3).padStart(2, '0')}:00`,
      owner: '验收负责人', maintainer: ['验收管理员甲', '验收管理员乙', '验收管理员丙'][index % 3],
      remark: '隔离测试数据：用于核对原型布局和真实工单流转。',
      assets: [{ asset_type: ref.asset_type, asset_id: ref.asset_id, asset_name: ref.asset_name }],
    };
    const saved = await request('POST', '/api/cmdb/work-orders', body);
    const path = `/api/cmdb/work-orders/${saved.id}`;
    const steps = status === '已取消' ? ['已取消'] : ['处理中', '已解决', '已关闭'].slice(0, ['新建', '处理中', '已解决', '已关闭'].indexOf(status));
    for (const next of steps) {
      const current = await request('GET', path);
      await request('PUT', path, { ...current, status: next, ...(next === '已关闭' ? { result: '验收完成：已核对关联资源与维护结果。' } : {}) });
    }
    if (index === 0) await request('POST', `${path}/logs`, { content: '已检查关联设备，正在核查接口状态。', operator: '验收管理员甲' });
    created++;
  }
  console.log(`工单验收场景已就绪：新增 ${created} 张，重复执行保留现有验收修改。`);
}
module.exports = { ensureWorkOrderFixtures };

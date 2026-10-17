(() => {
  'use strict';
  const stages = ['新建', '处理中', '已解决', '已关闭'];
  const categories = ['故障处理', '日常维护', '变更操作', '资产调配'];
  const operations = ['排障', '优化', '响应', '值守'];
  const priorities = ['P1（紧急）', 'P2（较高）', 'P3（普通）', 'P4（较低）'];
  const results = ['处理成功', '临时规避', '未发现异常', '未解决', '已升级处理', '需二次维护'];
  const canonical = (status) => status === '已分配' ? '新建' : status;
  const assets = Object.entries(window.assetPrototypePages).flatMap(([view, page]) => page.rows
    .filter((row) => row.status !== '已注销').map((row) => ({
      key: view + ':' + row.id, view, row, label: page.label,
      href: 'device-assets-preview.html?asset=' + encodeURIComponent(row.id) + '#' + view,
    })));
  const assetByKey = new Map(assets.map((asset) => [asset.key, asset]));
  const clock = () => {
    const date = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
      + 'T' + pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds());
  };
  const minutes = (order) => {
    if (!order.started_at || !order.resolved_at) return null;
    const start = Date.parse(order.started_at), end = Date.parse(order.resolved_at);
    return Number.isFinite(start) && Number.isFinite(end) && end >= start ? Math.round((end - start) / 60000) : null;
  };
  const sampleAsset = (view, index) => assets.filter((asset) => asset.view === view)[index].key;
  function seed() {
    const statuses = ['处理中', '新建', '新建', '已解决', '已关闭', '处理中', '新建', '已解决', '处理中', '已关闭', '已分配', '已解决', '新建', '已关闭', '处理中', '已取消'];
    const subjects = ['示例核心交换机端口间歇中断', '示例云桌面无法连接', '示例打印机补充耗材', '示例业务门户访问缓慢', '示例主机房例行巡检', '示例虚拟化宿主机维护', '示例备用终端资产调配', '示例交换机配置核对', '示例系统发布窗口值守', '示例存储容量核查', '示例历史分配工单', '示例待结单数据库服务器排障', '示例笔记本系统升级', '示例缺少起止时间的历史结单', '示例跨区域灾备同步链路与业务应用协同维护（长主题展示）', '示例已取消的维护窗口'];
    const keys = [sampleAsset('infrastructure', 0), sampleAsset('terminal', 0), sampleAsset('terminal', 4), sampleAsset('systems', 1), sampleAsset('infrastructure', 0), sampleAsset('infrastructure', 3), sampleAsset('terminal', 5), sampleAsset('infrastructure', 1), sampleAsset('systems', 0), sampleAsset('infrastructure', 6), sampleAsset('terminal', 1), sampleAsset('infrastructure', 5), sampleAsset('terminal', 3), sampleAsset('infrastructure', 4), sampleAsset('systems', 2), sampleAsset('infrastructure', 2)];
    return statuses.map((status, index) => {
      const stage = stages.indexOf(canonical(status));
      const time = (hour) => '2026-10-09T' + String(hour).padStart(2, '0') + ':' + String(index * 3 % 60).padStart(2, '0') + ':00';
      const historyMissing = index === 13;
      const order = {
        id: index + 1, order_no: 'DEMO-WO-20261009-' + String(index + 1).padStart(3, '0'),
        subject: subjects[index], status, priority: priorities[index % 4], biz_type: categories[index % 4],
        operation_type: operations[index % 4], project_name: '示例项目', plan_time: time(8),
        maintainer: ['示例管理员甲', '示例管理员乙', '示例管理员丙'][index % 3], owner: '示例负责人',
        description: '虚构场景：' + subjects[index] + '。请核对影响范围、关联资源与处理记录；不代表真实故障。',
        assets: index === 14 ? [keys[index], sampleAsset('infrastructure', 4)] : [keys[index]],
        attachments: index === 0 ? [{ name: '示例端口排查记录.txt', size: 2048, demo: true }] : [],
        started_at: stage >= 1 && !historyMissing ? time(9) : null,
        resolved_at: stage >= 2 && !historyMissing ? time(10) : null,
        closed_at: stage === 3 ? time(11) : null,
        result: stage >= 2 ? '示例：已核对配置、复测访问与相关资源状态。' : '',
        result_type: stage >= 2 ? '处理成功' : '', events: [],
      };
      if (historyMissing) order.events.push({ time: time(11), title: '历史结单导入（示例）', text: '原记录缺少可靠开始与解决时间，不补造处理时长。', actor: order.maintainer });
      else {
        order.events.push({ time: order.plan_time, title: status === '已分配' ? '已分配（旧记录）' : '提交工单', text: '示例关联资源已登记。', actor: '示例提交人' });
        if (order.started_at) order.events.push({ time: order.started_at, title: '开始处理', text: '示例维护人员已受理，开始核对影响范围。', actor: order.maintainer });
        if (order.resolved_at) order.events.push({ time: order.resolved_at, title: '标记已解决', text: order.result, actor: order.maintainer });
        if (order.closed_at) order.events.push({ time: order.closed_at, title: '验收结单', text: '示例处理结果已确认。', actor: order.owner });
        if (status === '已取消') order.events.push({ time: time(9), title: '取消工单', text: '示例维护计划撤销，保留原记录。', actor: order.owner });
      }
      return order;
    });
  }
  function match(order, filters, includeStatus = true) {
    const includes = (text, query) => !query || String(text || '').toLowerCase().includes(query.trim().toLowerCase());
    const assetNames = order.assets.map((key) => assetByKey.get(key)).map((asset) => asset.row.name + ' ' + asset.row.code).join(' ');
    return includes(order.order_no + ' ' + order.subject + ' ' + order.description + ' ' + assetNames, filters.keyword)
      && (!filters.category || order.biz_type === filters.category)
      && (!filters.operation || order.operation_type === filters.operation)
      && (!filters.priority || order.priority === filters.priority)
      && (!filters.result || order.result_type === filters.result)
      && includes(order.maintainer, filters.maintainer) && includes(order.owner, filters.owner)
      && includes(assetNames, filters.asset)
      && (!filters.from || order.plan_time.slice(0, 10) >= filters.from)
      && (!filters.to || order.plan_time.slice(0, 10) <= filters.to)
      && (!includeStatus || !filters.status || (filters.status === '已分配' ? order.status === '已分配' : canonical(order.status) === filters.status));
  }
  function transition(order, target, payload = {}) {
    const from = canonical(order.status);
    if (['已关闭', '已取消'].includes(from)) throw Error('已结束的工单不能继续流转。');
    if (target !== '已取消' && stages[stages.indexOf(from) + 1] !== target) throw Error('只能进入下一阶段，不能跨阶段。');
    const note = String(payload.note || '').trim();
    if (['已解决', '已关闭', '已取消'].includes(target) && !note) throw Error(target === '已取消' ? '请填写取消原因。' : '请填写处理结果。');
    const time = clock();
    order.status = target;
    if (target === '处理中') order.started_at = time;
    if (target === '已解决') { order.resolved_at = time; order.result = note; order.result_type = payload.result_type; }
    if (target === '已关闭') { order.closed_at = time; order.result = note; order.result_type = payload.result_type; }
    order.events.push({ time, title: { '处理中': '开始处理', '已解决': '标记已解决', '已关闭': '验收结单', '已取消': '取消工单' }[target], text: note || '原型演示：维护人员受理，开始处理。', actor: order.maintainer || '原型演示者' });
    return from;
  }
  window.workOrderPreviewModel = { stages, categories, operations, priorities, results, assets, assetByKey, canonical, clock, minutes, seed, match, transition };
})();

(() => {
  'use strict';
  const model = window.workOrderPreviewModel;
  const byId = (id) => document.getElementById(id);
  const element = (tag, className = '', text = '') => {
    const node = document.createElement(tag); node.className = className; node.textContent = text; return node;
  };
  const button = (text, action, className = 'work-link') => {
    const node = element('button', className, text); node.type = 'button'; node.addEventListener('click', action); return node;
  };
  function actionIcon(symbol, label, action) {
    const node = element('button', 'icon quiet'); node.type = 'button'; node.title = label; node.setAttribute('aria-label', label);
    if (action) node.addEventListener('click', action); else node.disabled = true;
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use'); use.setAttribute('href', '#' + symbol);
    icon.append(use); node.append(icon); return node;
  }
  const state = { orders: model.seed(), selected: new Set(), page: 1, currentId: null, editingId: null, action: null, files: [], newAssets: new Set() };
  let toastTimer;
  function toast(message) {
    clearTimeout(toastTimer);
    const node = byId('work-toast');
    const host = [...document.querySelectorAll('dialog[open]')].at(-1) || document.body;
    host.append(node); node.hidden = false; node.textContent = message;
    toastTimer = setTimeout(() => { node.hidden = true; node.textContent = ''; }, 5500);
  }
  const filters = () => Object.fromEntries(['category', 'operation', 'priority', 'status', 'result', 'maintainer', 'owner', 'asset', 'from', 'to'].map((key) => [key, byId('filter-' + key).value.trim()]).concat([['keyword', byId('work-search').value.trim()]]));
  const matching = () => state.orders.filter((order) => model.match(order, filters()));
  const selectedOrders = () => state.orders.filter((order) => state.selected.has(order.id));
  const formatTime = (time) => time ? time.replace('T', ' ').slice(0, 16) : '未记录';
  function statusPill(order) {
    const node = element('span', 'work-status', model.canonical(order.status));
    node.dataset.status = model.canonical(order.status);
    node.title = order.status === '已分配' ? '旧状态：已分配，兼容显示为新建' : order.status;
    if (order.status === '已分配') node.append(element('small', '', ' · 原已分配'));
    return node;
  }
  function renderTable() {
    const currentFilters = filters();
    const base = state.orders.filter((order) => model.match(order, currentFilters, false));
    document.querySelectorAll('#work-summary [data-status]').forEach((node) => {
      node.querySelector('[data-count]').textContent = base.filter((order) => model.canonical(order.status) === node.dataset.status).length;
      node.setAttribute('aria-pressed', String(currentFilters.status === node.dataset.status));
    });
    const orders = matching(), size = Number(byId('work-page-size').value), pages = Math.max(1, Math.ceil(orders.length / size));
    state.page = Math.min(Math.max(state.page, 1), pages);
    const visible = orders.slice((state.page - 1) * size, state.page * size);
    const root = byId('work-table-body'); root.replaceChildren();
    for (const order of visible) {
      const row = element('tr'); row.dataset.orderId = order.id;
      const checkbox = element('input'); checkbox.type = 'checkbox'; checkbox.checked = state.selected.has(order.id);
      checkbox.setAttribute('aria-label', '选择 ' + order.order_no);
      checkbox.addEventListener('change', () => { checkbox.checked ? state.selected.add(order.id) : state.selected.delete(order.id); renderTable(); });
      const number = button(order.order_no, () => openDetail(order.id), 'work-number'); number.dataset.openOrder = order.id; number.title = order.order_no;
      const priority = element('span', 'work-priority', order.priority); priority.dataset.priority = order.priority.slice(0, 2);
      const subject = element('span', 'work-subject', order.subject); subject.title = order.subject;
      const assetNames = order.assets.map((key) => model.assetByKey.get(key).row.name).join('、');
      const asset = element('span', '', assetNames || '未关联'); asset.title = assetNames;
      const maintenance = element('div'); maintenance.append(element('span', '', order.biz_type), element('small', '', order.operation_type));
      const processingTime = element('div'); processingTime.append(element('time', '', formatTime(order.closed_at || order.resolved_at || order.started_at || order.plan_time)), element('small', '', order.closed_at ? '关闭时间' : order.resolved_at ? '解决时间' : order.started_at ? '开始处理' : '发生时间'));
      const actions = element('div', 'work-actions');
      actions.append(button('详情', () => openDetail(order.id)), actionIcon('edit', order.status === '已取消' ? '已取消工单只读' : '编辑演示工单 ' + order.order_no, order.status === '已取消' ? null : () => openCreate(order.biz_type, order)), actionIcon('trash', '删除（原型未接入）'));
      const cells = [checkbox, number, priority, subject, maintenance, asset, processingTime, element('span', '', order.maintainer || '未分配'), statusPill(order), actions];
      cells.forEach((content) => { const cell = element('td'); cell.append(content); row.append(cell); }); root.append(row);
    }
    byId('work-empty').hidden = orders.length > 0;
    byId('work-count').textContent = '共 ' + orders.length + ' 条 · 第 ' + state.page + ' / ' + pages + ' 页';
    byId('work-prev').disabled = state.page <= 1; byId('work-next-page').disabled = state.page >= pages;
    const checked = visible.filter((order) => state.selected.has(order.id)).length;
    byId('work-select-all').checked = visible.length > 0 && checked === visible.length;
    byId('work-select-all').indeterminate = checked > 0 && checked < visible.length;
    byId('work-select-all').disabled = visible.length === 0;
    byId('work-selection').replaceChildren(document.createTextNode('已选 ' + state.selected.size + ' 张'));
    if (state.selected.size) byId('work-selection').append(button('清空选择', () => { state.selected.clear(); renderTable(); }, 'quiet'));
    const canClose = state.selected.size > 0 && selectedOrders().every((order) => model.canonical(order.status) === '已解决');
    byId('work-bulk-close').disabled = !canClose;
    byId('work-bulk-close').title = canClose ? '逐张填写处理结果后演示结单' : '仅允许全部所选工单处于已解决阶段';
  }
  function renderHistory(order) {
    byId('detail-history-count').textContent = order.events.length + ' 条';
    byId('detail-history').replaceChildren();
    for (const event of order.events) {
      const item = element('li');
      item.append(element('strong', '', event.title), element('time', '', formatTime(event.time)), element('p', '', event.text), element('small', '', event.actor));
      byId('detail-history').append(item);
    }
  }
  function renderDetail(order) {
    byId('detail-subject').textContent = order.subject; byId('detail-number').textContent = order.order_no;
    byId('detail-priority').textContent = order.priority; byId('detail-priority').dataset.priority = order.priority.slice(0, 2);
    byId('detail-status').replaceChildren(statusPill(order)); byId('detail-description').textContent = order.description || '未填写故障内容';
    const duration = model.minutes(order);
    const durationText = duration !== null ? duration + ' 分钟' : model.canonical(order.status) === '新建' ? '未开始' : order.status === '处理中' ? '处理中，解决后结算' : '未记录（缺少可靠起止时间）';
    const info = [['当前项目', order.project_name], ['工单类别', order.biz_type], ['运维类型', order.operation_type], ['维护人员', order.maintainer || '未分配'], ['负责人', order.owner || '未分配'], ['发生时间', formatTime(order.plan_time)], ['开始处理', formatTime(order.started_at)], ['解决时间', formatTime(order.resolved_at)], ['关闭时间', formatTime(order.closed_at)], ['处理工时', durationText]];
    byId('detail-info').replaceChildren();
    for (const [label, value] of info) { const pair = element('div'); pair.append(element('dt', '', label), element('dd', '', value)); byId('detail-info').append(pair); }
    byId('detail-assets').replaceChildren();
    for (const key of order.assets) {
      const asset = model.assetByKey.get(key), row = asset.row;
      const card = element('div', 'work-asset'); const link = element('a', 'work-link', row.name); link.href = asset.href; link.target = '_blank'; link.rel = 'noopener';
      card.append(link, element('small', '', asset.label + ' · ' + row.code));
      const ip = row.mgmt_ip || row.service_ip || row.ip || '未配置';
      const network = row.net_type || row.network_type || row.network || '未配置';
      const details = element('dl', 'asset-meta');
      for (const [label, value] of [['设备/系统类型', row.type], ['IP 地址', ip], ['网络类型', network], ['位置 / 部署', row.location || row.deployment_location || row.room || '未配置']]) {
        const pair = element('div'); pair.append(element('dt', '', label), element('dd', '', value)); details.append(pair);
      }
      card.append(details); byId('detail-assets').append(card);
    }
    if (!order.assets.length) byId('detail-assets').append(element('p', 'muted', '未关联资源'));
    byId('detail-attachments').replaceChildren();
    for (const file of order.attachments) byId('detail-attachments').append(element('div', 'attachment-item', file.name + ' · ' + Math.ceil(file.size / 1024) + ' KiB · ' + (file.demo ? '虚构附件' : '仅文件名预览，未上传')));
    if (!order.attachments.length) byId('detail-attachments').append(element('p', 'muted', '暂无附件'));
    byId('detail-result').textContent = order.result ? (order.result_type || '处理结果') + '：' + order.result : '尚未填写处理结果';
    renderHistory(order);
    const stage = model.stages.indexOf(model.canonical(order.status));
    byId('detail-action-next').hidden = stage < 0 || stage === 3;
    byId('detail-action-next').textContent = ['开始处理', '标记解决', '验收结单'][stage] || '流程已结束';
    byId('detail-action-cancel').hidden = stage < 0 || stage === 3;
    byId('detail-note-form').hidden = stage < 0 || stage === 3;
    byId('work-detail').querySelector('.detail-footer').hidden = stage < 0 || stage === 3;
  }
  function openDetail(id) {
    state.currentId = id;
    const order = state.orders.find((item) => item.id === id);
    renderDetail(order); byId('detail-note-form').reset();
    byId('detail-records').open = false;
    if (!byId('work-detail').open) byId('work-detail').showModal();
    byId('work-detail').querySelector('.dialog-body').scrollTop = 0;
  }
  function renderAssetOptions() {
    const query = byId('create-asset-search').value.trim().toLowerCase(), type = byId('create-asset-type').value;
    byId('create-assets').replaceChildren();
    for (const asset of model.assets.filter((item) => (!type || item.view === type) && (!query || (item.row.name + ' ' + item.row.code).toLowerCase().includes(query)))) {
      const label = element('label', 'asset-option'); const checkbox = element('input'); checkbox.type = 'checkbox'; checkbox.value = asset.key; checkbox.checked = state.newAssets.has(asset.key);
      checkbox.addEventListener('change', () => { checkbox.checked ? state.newAssets.add(asset.key) : state.newAssets.delete(asset.key); });
      const text = element('span'); text.append(element('strong', '', asset.row.name), element('small', '', asset.label + ' · ' + asset.row.code)); label.append(checkbox, text); byId('create-assets').append(label);
    }
    if (!byId('create-assets').childElementCount) byId('create-assets').append(element('p', 'muted', '没有匹配的示例资源'));
  }
  function renderFiles() {
    byId('create-file-list').replaceChildren();
    state.files.forEach((file, index) => {
      const row = element('div', 'attachment-item'); row.append(element('span', '', file.name + ' · ' + Math.ceil(file.size / 1024) + ' KiB'), button('移除', () => { state.files.splice(index, 1); renderFiles(); }, 'quiet')); byId('create-file-list').append(row);
    });
  }
  function openCreate(category, order = null) {
    if (order?.status === '已取消') { toast('已取消工单只读。'); return; }
    byId('work-new-menu').open = false; byId('work-create-form').reset(); state.newAssets.clear(); state.files = [];
    state.editingId = order?.id ?? null;
    byId('create-subject').setCustomValidity('');
    byId('work-create-heading').textContent = order ? '编辑演示工单' : '新建工单';
    byId('work-create-form').querySelector('button[type="submit"]').textContent = order ? '更新演示工单' : '提交演示工单';
    byId('create-status-field').hidden = !order; byId('create-status').value = order ? model.canonical(order.status) : '新建';
    byId('create-number').value = order?.order_no || '';
    byId('create-category').value = category; byId('create-priority').value = order?.priority || 'P3（普通）'; byId('create-operation').value = order?.operation_type || '排障';
    byId('create-time').value = (order?.plan_time || model.clock()).slice(0, 16);
    for (const key of ['subject', 'maintainer', 'owner', 'description']) byId('create-' + key).value = order?.[key] || '';
    if (order) { state.newAssets = new Set(order.assets); state.files = order.attachments.map((file) => ({ ...file })); }
    renderAssetOptions(); renderFiles();
    byId('work-create').showModal(); byId('work-create').querySelector('.dialog-body').scrollTop = 0; byId('create-subject').focus({ preventScroll: true });
  }
  function openAction(ids, target) {
    state.action = { ids, target }; const root = byId('action-fields'); root.replaceChildren();
    byId('action-heading').textContent = target === '已取消' ? '取消演示工单' : target === '已解决' ? '填写解决说明' : ids.length > 1 ? '批量演示结单' : '验收演示结单';
    byId('action-hint').textContent = '仅修改当前页面的虚构工单。' + (target === '已关闭' ? '每张工单都必须填写处理结果，不会跳过验收。' : '处理记录会同步到时间线。');
    byId('action-result-type').closest('.field').hidden = target === '已取消';
    byId('action-result-type').value = state.orders.find((order) => order.id === ids[0]).result_type || '处理成功';
    for (const id of ids) {
      const order = state.orders.find((item) => item.id === id); const field = element('div', 'field full');
      const label = element('label', '', order.order_no + ' · ' + (target === '已取消' ? '取消原因' : '处理结果') + ' *');
      const input = element('textarea'); input.id = 'action-result-' + id; input.required = true; input.rows = 3; input.value = target === '已取消' ? '' : order.result;
      label.htmlFor = input.id; field.append(label, element('p', 'dialog-note', order.subject), input); root.append(field);
    }
    byId('action-confirm').textContent = target === '已取消' ? '确认取消（演示）' : target === '已解决' ? '标记已解决（演示）' : '确认结单（演示）';
    byId('work-action').showModal(); byId('work-action').querySelector('.dialog-body').scrollTop = 0;
  }
  byId('work-create-form').addEventListener('submit', (event) => {
    event.preventDefault(); const subject = byId('create-subject').value.trim();
    if (!subject) { byId('create-subject').setCustomValidity('请填写工单主题，不能只有空格。'); byId('create-subject').reportValidity(); return; }
    const time = model.clock();
    const values = { subject, biz_type: byId('create-category').value, operation_type: byId('create-operation').value, priority: byId('create-priority').value, plan_time: byId('create-time').value, maintainer: byId('create-maintainer').value.trim(), owner: byId('create-owner').value.trim(), description: byId('create-description').value.trim(), assets: [...state.newAssets], attachments: state.files.map((file) => ({ name: file.name, size: file.size, demo: file.demo || false })) };
    let order;
    if (state.editingId !== null) {
      order = state.orders.find((item) => item.id === state.editingId);
      Object.assign(order, values);
      order.events.push({ time, title: '编辑资料（演示）', text: '仅更新主题、人员与关联资源等资料，保留编号、实际状态及处理时间。', actor: '原型演示者' });
    } else {
      const id = Math.max(...state.orders.map((item) => item.id)) + 1;
      order = { ...values, id, order_no: 'DEMO-WO-' + values.plan_time.slice(0, 10).replaceAll('-', '') + '-' + String(id).padStart(3, '0'), project_name: '示例项目', status: '新建', started_at: null, resolved_at: null, closed_at: null, result: '', result_type: '', events: [{ time, title: '提交工单（演示）', text: '只新增到当前页面内存，未写入数据库。', actor: '原型演示者' }] };
      state.orders.unshift(order);
    }
    state.editingId = null; resetFilters(); byId('work-create').close(); openDetail(order.id); toast('演示工单资料已更新，仅当前页面有效。');
  });
  byId('create-subject').addEventListener('input', () => byId('create-subject').setCustomValidity(''));
  byId('work-action-form').addEventListener('submit', (event) => {
    event.preventDefault(); const { ids, target } = state.action;
    const orders = ids.map((id) => state.orders.find((order) => order.id === id));
    const notes = ids.map((id) => byId('action-result-' + id).value.trim());
    if (notes.some((note) => !note)) { toast('请为每张工单填写非空处理结果或取消原因。'); return; }
    if (target === '已关闭' && orders.some((order) => model.canonical(order.status) !== '已解决')) { toast('只有已解决工单可以结单。'); return; }
    orders.forEach((order, index) => model.transition(order, target, { note: notes[index], result_type: byId('action-result-type').value }));
    byId('work-action').close(); state.selected.clear(); renderTable();
    if (byId('work-detail').open) renderDetail(state.orders.find((order) => order.id === state.currentId));
    toast('已演示' + target + ' · ' + ids.length + ' 张，仅当前页面有效。');
  });
  byId('detail-action-next').addEventListener('click', () => {
    const order = state.orders.find((item) => item.id === state.currentId), index = model.stages.indexOf(model.canonical(order.status)), target = model.stages[index + 1];
    if (target === '处理中') { model.transition(order, target); renderTable(); renderDetail(order); toast('开始处理时间已在本页演示记录，未写入真实工单。'); }
    else openAction([order.id], target);
  });
  byId('detail-action-cancel').addEventListener('click', () => openAction([state.currentId], '已取消'));
  byId('detail-note-form').addEventListener('submit', (event) => {
    event.preventDefault(); const text = byId('detail-note').value.trim(); if (!text) { toast('请填写处理记录，不能只有空格。'); return; }
    const order = state.orders.find((item) => item.id === state.currentId);
    order.events.push({ time: model.clock(), title: '补充处理记录', text, actor: order.maintainer || '原型演示者' }); renderHistory(order); byId('detail-note-form').reset(); toast('处理记录已在本页演示添加。');
  });
  byId('work-bulk-close').addEventListener('click', () => openAction(selectedOrders().map((order) => order.id), '已关闭'));
  byId('work-select-all').addEventListener('change', (event) => {
    const size = Number(byId('work-page-size').value); matching().slice((state.page - 1) * size, state.page * size).forEach((order) => { event.target.checked ? state.selected.add(order.id) : state.selected.delete(order.id); }); renderTable();
  });
  document.querySelectorAll('[data-new-category]').forEach((node) => node.addEventListener('click', () => openCreate(node.dataset.newCategory)));
  document.querySelectorAll('[data-close]').forEach((node) => node.addEventListener('click', () => byId(node.dataset.close).close()));
  document.querySelectorAll('#work-filters input,#work-filters select').forEach((node) => node.addEventListener(node.tagName === 'SELECT' || node.type === 'date' ? 'change' : 'input', () => { state.page = 1; state.selected.clear(); renderTable(); }));
  byId('work-search').addEventListener('input', () => { state.page = 1; state.selected.clear(); renderTable(); });
  function resetFilters() { byId('work-search').value = ''; document.querySelectorAll('#work-filters input,#work-filters select').forEach((node) => { node.value = ''; }); state.page = 1; state.selected.clear(); renderTable(); }
  byId('work-reset-filters').addEventListener('click', resetFilters);
  document.querySelectorAll('#work-summary [data-status]').forEach((node) => node.addEventListener('click', () => { byId('filter-status').value = byId('filter-status').value === node.dataset.status ? '' : node.dataset.status; state.page = 1; state.selected.clear(); renderTable(); }));
  byId('work-filter-toggle').addEventListener('click', () => { byId('work-filters').hidden = !byId('work-filters').hidden; byId('work-filter-toggle').setAttribute('aria-expanded', String(!byId('work-filters').hidden)); });
  byId('work-page-size').addEventListener('change', () => { state.page = 1; renderTable(); });
  byId('work-prev').addEventListener('click', () => { state.page--; renderTable(); });
  byId('work-next-page').addEventListener('click', () => { state.page++; renderTable(); });
  byId('create-asset-search').addEventListener('input', renderAssetOptions); byId('create-asset-type').addEventListener('change', renderAssetOptions);
  byId('create-files').addEventListener('change', (event) => {
    const files = [...event.target.files]; const tooLarge = files.filter((file) => file.size > 50 * 1024 * 1024);
    state.files.push(...files.filter((file) => file.size <= 50 * 1024 * 1024)); event.target.value = ''; renderFiles();
    if (tooLarge.length) toast('以下附件超过现有 50 MiB 限制，未加入演示：' + tooLarge.map((file) => file.name).join('、'));
  });
  byId('work-reset-demo').addEventListener('click', () => { state.orders = model.seed(); state.currentId = null; resetFilters(); toast('已恢复虚构示例工单，未影响真实数据。'); });
  renderTable();
})();

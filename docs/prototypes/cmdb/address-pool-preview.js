(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const pools = [
    { name: '办公内网', category: '内网', prefix: '192.168.10', cidr: '192.168.10.0/24', size: 256, gateway: '192.168.10.1', vlan: '10', vni: '', purpose: '办公终端与网络设备', segments: [{ name: '速载', floor: '3楼', start_ip: '192.168.10.2', end_ip: '192.168.10.40', remark: '' }, { name: '刑一', floor: '4楼', start_ip: '192.168.10.41', end_ip: '192.168.10.60', remark: '' }, { name: '刑二', floor: '4楼', start_ip: '192.168.10.61', end_ip: '192.168.10.80', remark: '' }, { name: '少年', floor: '5楼', start_ip: '192.168.10.81', end_ip: '192.168.10.100', remark: '' }, { name: '行政', floor: '5楼', start_ip: '192.168.10.101', end_ip: '192.168.10.120', remark: '' }, { name: '审监', floor: '6楼', start_ip: '192.168.10.121', end_ip: '192.168.10.140', remark: '' }, { name: '执裁', floor: '6楼', start_ip: '192.168.10.141', end_ip: '192.168.10.160', remark: '' }] },
    { name: '业务专网', category: '专网', prefix: '10.20.30', cidr: '10.20.30.0/24', size: 256, gateway: '10.20.30.1', vlan: '30', vni: '1030', purpose: '业务服务器' },
    { name: '外网出口', category: '外网', prefix: '203.0.113', cidr: '203.0.113.0/28', size: 16, gateway: '203.0.113.1', vlan: '50', vni: '', purpose: '文档示例地址段' },
  ];
  const occupiedHosts = new Set([1, 10, 11, ...Array.from({ length: 16 }, (_, i) => i + 20), ...Array.from({ length: 16 }, (_, i) => i + 80)]);
  const statusText = { used: '已占用', free: '空闲', reserved: '已预留', abnormal: '异常', network: '网络地址', broadcast: '广播地址' };
  let activePool = 0;
  let ipLayout = 'grid';
  let ipPage = 1;
  let selectedIP = '';

  const segmentOf = (pool, ip) => (pool.segments || []).find((segment) => numberOf(ip) >= numberOf(segment.start_ip) && numberOf(ip) <= numberOf(segment.end_ip));
  function numberOf(ip) {
    const parts = String(ip || '').split('.');
    if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255 || (part.length > 1 && part.startsWith('0')))) return NaN;
    return parts.reduce((value, part) => value * 256 + Number(part), 0);
  }
  function segmentStats(pool, segment) {
    const entries = addresses().filter((entry) => segmentOf(pool, entry.ip) === segment);
    return { total: entries.filter((entry) => !['network', 'broadcast'].includes(entry.status)).length, used: entries.filter((entry) => entry.status === 'used').length, reserved: entries.filter((entry) => entry.status === 'reserved').length, free: entries.filter((entry) => entry.status === 'free').length };
  }
  function renderSegments() {
    const pool = pools[activePool];
    const select = $('pool-segment');
    const chosen = select.value;
    select.replaceChildren(new Option('整个地址池', ''));
    (pool.segments || []).forEach((segment, index) => select.add(new Option(`${segment.name} · ${segment.floor} · ${segment.start_ip}–${segment.end_ip}`, String(index))));
    select.value = chosen !== '' && Number(chosen) < (pool.segments || []).length ? chosen : '';
    const segment = pool.segments?.[Number(select.value)];
    const stats = select.value !== '' && segment ? segmentStats(pool, segment) : null;
    $('pool-segment-summary').textContent = stats ? `可用 ${stats.total} · 已用 ${stats.used} · 预留 ${stats.reserved} · 空闲 ${stats.free}` : `${(pool.segments || []).length} 个已规划分段`;
  }
  function addresses() {
    const pool = pools[activePool];
    return Array.from({ length: pool.size }, (_, host) => {
      const status = host === 0 ? 'network' : host === pool.size - 1 ? 'broadcast' : [200, 201].includes(host) ? 'abnormal' : host >= 50 && host < 60 ? 'reserved' : occupiedHosts.has(host) ? 'used' : 'free';
      const owner = status === 'used' ? host === 1 ? '示例网关' : host === 25 ? '汇聚交换机 SW-001（示例）' : '示例设备 ' + host : '';
      return { host, ip: pool.prefix + '.' + host, status, owner };
    });
  }
  function locateSelected(focus = false) {
    if (!selectedIP) return;
    const container = ipLayout === 'grid' ? $('ip-grid') : $('ip-table-body');
    const target = [...container.querySelectorAll('[data-ip]')].find((node) => node.dataset.ip === selectedIP);
    if (!target) return;
    target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
    if (focus) (target.matches('button') ? target : target.querySelector('button')).focus({ preventScroll: true });
  }
  function hideAddress(focus = false) {
    $('ip-detail').hidden = true;
    $('pool-address-layout').classList.remove('has-ip-detail');
    if (focus) locateSelected(true);
  }
  function renderPicker() {
    const needle = $('pool-find').value.trim().toLowerCase();
    const root = $('pool-options');
    root.replaceChildren();
    for (const category of ['内网', '专网', '外网']) {
      const entries = pools.map((pool, index) => ({ pool, index })).filter(({ pool }) => pool.category === category && (pool.name + pool.cidr).toLowerCase().includes(needle));
      if (!entries.length) continue;
      const heading = document.createElement('p');
      heading.className = 'group-label';
      heading.textContent = category;
      root.append(heading);
      for (const { pool, index } of entries) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = (index === activePool ? '✓ ' : '') + pool.name;
        const cidr = document.createElement('span');
        cidr.textContent = pool.cidr;
        button.append(cidr);
        button.addEventListener('click', () => {
          activePool = index;
          $('pool-segment').value = '';
          ipPage = 1;
          selectedIP = '';
          hideAddress();
          document.querySelector('.pool-selector').open = false;
          renderPool();
          renderPicker();
        });
        root.append(button);
      }
    }
    if (!root.children.length) root.textContent = '没有匹配地址池';
  }
  function showAddress(entry) {
    selectedIP = entry.ip;
    const pool = pools[activePool];
    $('ip-detail-title').textContent = entry.ip;
    const fields = $('ip-detail-fields');
    fields.replaceChildren();
    for (const [label, value] of [['IP 地址', entry.ip], ['地址池', pool.name], ['分段', segmentOf(pool, entry.ip)?.name || '未划分'], ['楼层', segmentOf(pool, entry.ip)?.floor || '—'], ['网络类型', pool.category], ['状态', statusText[entry.status]], ['占用对象', entry.owner || '未关联'], ['位置', entry.owner ? '示例位置' : '—']]) {
      const field = document.createElement('div');
      field.className = 'field' + (['地址池', '占用对象', '位置'].includes(label) ? ' full' : '');
      const term = document.createElement('dt');
      const detail = document.createElement('dd');
      term.textContent = label;
      detail.textContent = value;
      field.append(term, detail);
      fields.append(field);
    }
    const actions = $('ip-detail-actions');
    actions.replaceChildren();
    const labels = entry.status === 'free' ? ['预留', '分配'] : entry.status === 'reserved' ? ['取消预留', '分配'] : entry.status === 'used' ? ['释放'] : [];
    for (const label of labels) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.disabled = true;
      button.title = '操作位置原型；不修改真实地址';
      actions.append(button);
    }
    $('ip-detail').hidden = false;
    $('pool-address-layout').classList.add('has-ip-detail');
    renderPool();
    requestAnimationFrame(() => locateSelected());
  }
  function renderPool() {
    const pool = pools[activePool];
    const all = addresses();
    renderSegments();
    $('pool-choice').textContent = pool.name + ' · ' + pool.cidr;
    $('pool-heading').textContent = pool.name + ' · ' + pool.category;
    $('pool-metadata').textContent = `${pool.cidr} · 网关 ${pool.gateway} · VLAN ${pool.vlan}${pool.vni ? ' · VNI ' + pool.vni : ''}`;
    $('pool-total').textContent = all.length;
    for (const status of ['used', 'reserved', 'free', 'abnormal']) $('pool-' + status).textContent = all.filter((entry) => entry.status === status).length;
    const query = $('pool-search').value.trim().toLowerCase();
    const status = $('pool-status').value;
    const filtered = all.filter((entry) => ($('pool-segment').value === '' || segmentOf(pool, entry.ip) === pool.segments?.[Number($('pool-segment').value)]) && (!status || entry.status === status) && (!query || (entry.ip + ' ' + entry.owner).toLowerCase().includes(query)));
    const size = Number($('pool-page-size').value);
    const pages = Math.max(1, Math.ceil(filtered.length / size));
    ipPage = Math.min(ipPage, pages);
    const visible = filtered.slice((ipPage - 1) * size, ipPage * size);
    if (!visible.some((entry) => entry.ip === selectedIP)) hideAddress();
    const grid = $('ip-grid');
    const table = $('ip-table-body');
    grid.replaceChildren();
    table.replaceChildren();
    for (const entry of visible) {
      const special = ['network', 'broadcast'].includes(entry.status);
      const selected = selectedIP === entry.ip;
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.dataset.ip = entry.ip;
      tile.className = 'ip-cell ' + (special ? 'special' : entry.status) + (selected ? ' ip-selected' : '');
      tile.textContent = entry.host;
      tile.title = entry.ip + ' · ' + statusText[entry.status] + (entry.owner ? ' · ' + entry.owner : '');
      tile.setAttribute('aria-label', tile.title);
      tile.setAttribute('aria-pressed', String(selected));
      tile.addEventListener('click', () => showAddress(entry));
      grid.append(tile);
      const row = document.createElement('tr');
      row.dataset.ip = entry.ip;
      if (selected) row.className = 'ip-selected';
      const cell = document.createElement('td');
      const link = document.createElement('button');
      link.type = 'button';
      link.textContent = entry.ip;
      link.setAttribute('aria-label', '查看 ' + entry.ip);
      link.addEventListener('click', () => showAddress(entry));
      cell.append(link);
      row.append(cell);
      for (const value of [segmentOf(pool, entry.ip) ? `${segmentOf(pool, entry.ip).name} / ${segmentOf(pool, entry.ip).floor}` : '未划分', pool.category, statusText[entry.status], entry.owner || '—', entry.owner ? '示例位置' : '—']) {
        const field = document.createElement('td');
        field.textContent = value;
        field.title = value;
        if (value === statusText[entry.status]) field.className = entry.status;
        row.append(field);
      }
      table.append(row);
    }
    grid.hidden = ipLayout !== 'grid' || !visible.length;
    $('ip-table').hidden = ipLayout !== 'table' || !visible.length;
    $('pool-empty').hidden = !!visible.length;
    $('pool-page-count').textContent = `共 ${filtered.length} 条 · 第 ${ipPage} / ${pages} 页`;
    $('pool-prev').disabled = ipPage === 1;
    $('pool-next').disabled = ipPage === pages;
    document.querySelectorAll('[data-ip-layout]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.ipLayout === ipLayout)));
  }
  let editorCreate = false;
  let editorIndex = 0;
  let editorSegments = [];
  function renderEditorSegments() {
    const root = $('pool-segment-editor');
    root.replaceChildren();
    editorSegments.forEach((segment, index) => {
      const row = document.createElement('div'); row.className = 'pool-segment-row';
      const count = document.createElement('span');
      const updateCount = () => { count.textContent = `数量：${Number.isFinite(numberOf(segment.start_ip)) && Number.isFinite(numberOf(segment.end_ip)) && numberOf(segment.end_ip) >= numberOf(segment.start_ip) ? numberOf(segment.end_ip) - numberOf(segment.start_ip) + 1 : '待填写'}`; };
      for (const [key, label] of [['name', '部门 / 名称'], ['floor', '楼层'], ['start_ip', '起始 IP'], ['end_ip', '结束 IP'], ['remark', '备注']]) {
        const field = document.createElement('label'); field.textContent = label;
        const input = document.createElement('input'); input.value = segment[key] || ''; input.setAttribute('aria-label', `第 ${index + 1} 段${label}`);
        input.addEventListener('input', () => { segment[key] = input.value; updateCount(); });
        field.append(input); row.append(field);
      }
      updateCount(); row.append(count);
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '删除行'; remove.addEventListener('click', () => { editorSegments.splice(index, 1); renderEditorSegments(); }); row.append(remove);
      root.append(row);
    });
  }
  function renderEditorDirectory() {
    const needle = $('pool-editor-find').value.trim().toLowerCase();
    const root = $('pool-editor-list');
    root.replaceChildren();
    pools.forEach((pool, index) => {
      if (!(pool.name + pool.cidr).toLowerCase().includes(needle)) return;
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'pool-editor-item';
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(!editorCreate && index === editorIndex));
      const cidr = document.createElement('span');
      cidr.textContent = pool.cidr;
      item.append(document.createTextNode(pool.name), cidr);
      item.addEventListener('click', () => fillPoolEditor(false, index));
      root.append(item);
    });
    if (!root.children.length) {
      const empty = document.createElement('p');
      empty.className = 'dialog-note';
      empty.textContent = '没有匹配地址池';
      root.append(empty);
    }
  }
  function fillPoolEditor(create, index = activePool) {
    editorCreate = Boolean(create);
    editorIndex = index;
    const pool = editorCreate ? { category: '内网' } : pools[editorIndex];
    $('pool-editor-title').textContent = editorCreate ? '新增地址池 · 原型预览' : '编辑地址池 · ' + pool.name;
    for (const key of ['name', 'category', 'cidr', 'gateway', 'vlan', 'vni', 'purpose']) $('pool-' + key).value = pool[key] || '';
    editorSegments = (pool.segments || []).map((segment) => ({ ...segment }));
    $('pool-segment-error').textContent = '';
    renderEditorSegments();
    $('pool-editor-scope').textContent = editorCreate ? '新建表单为空白，不继承当前地址池；原型不保存业务数据。' : '左侧可搜索并切换任意地址池，右侧编辑当前所选；原型不保存业务数据。';
    renderEditorDirectory();
    document.querySelectorAll('details').forEach((detail) => detail.open = false);
    if (!$('pool-editor').open) $('pool-editor').showModal();
  }
  document.querySelectorAll('[data-ip-layout]').forEach((button) => button.addEventListener('click', () => {
    ipLayout = button.dataset.ipLayout;
    renderPool();
    requestAnimationFrame(() => locateSelected());
  }));
  $('pool-find').addEventListener('input', renderPicker);
  $('pool-segment').addEventListener('change', () => { ipPage = 1; selectedIP = ''; hideAddress(); renderPool(); });
  for (const [id, event] of [['pool-search', 'input'], ['pool-status', 'change'], ['pool-page-size', 'change']]) $(id).addEventListener(event, () => { ipPage = 1; renderPool(); });
  $('pool-prev').addEventListener('click', () => { ipPage--; renderPool(); });
  $('pool-next').addEventListener('click', () => { ipPage++; renderPool(); });
  $('pool-reset').addEventListener('click', () => { $('pool-search').value = ''; $('pool-status').value = ''; ipPage = 1; renderPool(); });
  $('ip-detail-close').addEventListener('click', () => hideAddress(true));
  $('ip-relocate').addEventListener('click', () => locateSelected(true));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !$('ip-detail').hidden && !document.querySelector('dialog[open]')) { event.preventDefault(); hideAddress(true); }
  });
  window.addEventListener('resize', () => requestAnimationFrame(() => locateSelected()));
  document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => $(button.dataset.close).close()));
  document.querySelectorAll('[data-pool-editor]').forEach((button) => button.addEventListener('click', () => {
    const mode = button.dataset.poolEditor;
    fillPoolEditor(mode === 'new', activePool);
  }));
  $('pool-editor-find').addEventListener('input', renderEditorDirectory);
  $('pool-selector-edit').addEventListener('click', () => fillPoolEditor(false, activePool));
  $('pool-segment-add').addEventListener('click', () => { editorSegments.push({ name: '', floor: '', start_ip: '', end_ip: '', remark: '' }); renderEditorSegments(); });
  $('pool-editor-save').addEventListener('click', () => {
    const cidr = $('pool-cidr').value.trim();
    const [networkIP, bitsText] = cidr.split('/');
    const bits = Number(bitsText);
    const network = numberOf(networkIP);
    if (!Number.isFinite(network) || !Number.isInteger(bits) || bits < 0 || bits > 32) { $('pool-segment-error').textContent = '请先填写有效的 IPv4 CIDR'; return; }
    const mask = bits ? (0xffffffff << (32 - bits)) >>> 0 : 0;
    for (const [index, segment] of editorSegments.entries()) {
      const start = numberOf(segment.start_ip); const end = numberOf(segment.end_ip);
      if (!segment.name.trim() || !Number.isFinite(start) || !Number.isFinite(end) || start > end || (start & mask) !== (network & mask) || (end & mask) !== (network & mask)) { $('pool-segment-error').textContent = `第 ${index + 1} 段名称、起止 IP 或 CIDR 范围不正确`; return; }
      if (editorSegments.slice(0, index).some((other) => start <= numberOf(other.end_ip) && numberOf(other.start_ip) <= end)) { $('pool-segment-error').textContent = `第 ${index + 1} 段与其他分段重叠`; return; }
    }
    const pool = editorCreate ? { size: 256, prefix: networkIP.split('.').slice(0, 3).join('.') } : pools[editorIndex];
    for (const key of ['name', 'category', 'cidr', 'gateway', 'vlan', 'vni', 'purpose']) pool[key] = $('pool-' + key).value.trim();
    if (!pool.name) { $('pool-segment-error').textContent = '请填写地址池名称'; return; }
    pool.segments = editorSegments.map((segment) => ({ ...segment }));
    if (editorCreate) { pools.push(pool); activePool = pools.length - 1; }
    $('pool-segment').value = ''; ipPage = 1;
    renderPicker(); renderPool(); $('pool-editor').close();
  });
  $('pool-add-ip').addEventListener('click', () => { $('new-ip-address').value = ''; $('new-ip-note').value = ''; $('pool-ip-editor').showModal(); });
  document.querySelectorAll('details').forEach((detail) => detail.addEventListener('toggle', () => {
    if (detail.open && !detail.classList.contains('fold')) document.querySelectorAll('details[open]').forEach((other) => { if (other !== detail && !other.classList.contains('fold')) other.open = false; });
  }));
  renderPicker();
  renderPool();
})();

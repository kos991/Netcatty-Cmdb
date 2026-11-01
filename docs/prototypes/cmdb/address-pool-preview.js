(() => {
  'use strict';
  const shared = window.parent !== window ? window.parent.cmdbPrototype : null;
  let syncPoolFilters = () => {};
  const $ = (id) => document.getElementById(id);
  let pools = [
    { name: '办公内网', category: '内网', prefix: '192.168.10', cidr: '192.168.10.0/24', size: 256, gateway: '192.168.10.1', vlan: '10', vni: '', purpose: '办公终端与网络设备', segments: [{ name: '速载', floor: '3楼', start_ip: '192.168.10.2', end_ip: '192.168.10.40', remark: '' }, { name: '刑一', floor: '4楼', start_ip: '192.168.10.41', end_ip: '192.168.10.60', remark: '' }, { name: '刑二', floor: '4楼', start_ip: '192.168.10.61', end_ip: '192.168.10.80', remark: '' }, { name: '少年', floor: '5楼', start_ip: '192.168.10.81', end_ip: '192.168.10.100', remark: '' }, { name: '行政', floor: '5楼', start_ip: '192.168.10.101', end_ip: '192.168.10.120', remark: '' }, { name: '审监', floor: '6楼', start_ip: '192.168.10.121', end_ip: '192.168.10.140', remark: '' }, { name: '执裁', floor: '6楼', start_ip: '192.168.10.141', end_ip: '192.168.10.160', remark: '' }] },
    { name: '业务专网', category: '专网', prefix: '10.20.30', cidr: '10.20.30.0/24', size: 256, gateway: '10.20.30.1', vlan: '30', vni: '1030', purpose: '业务服务器' },
    { name: '外网出口', category: '外网', prefix: '203.0.113', cidr: '203.0.113.0/28', size: 16, gateway: '203.0.113.1', vlan: '50', vni: '', purpose: '文档示例地址段' },
  ];
  if (shared) pools = shared.register('pools', pools);
  const occupiedHosts = new Set([1, 10, 11, ...Array.from({ length: 16 }, (_, i) => i + 20), ...Array.from({ length: 16 }, (_, i) => i + 80)]);
  const statusText = { used: '已占用', free: '空闲', reserved: '已预留', abnormal: '异常', network: '网络地址', broadcast: '广播地址' };
  let activePool = 0;
  let ipLayout = 'grid';
  let ipPage = 1;
  let selectedIP = '';
  let selectedSegment = null; // null = 整池；数字 = 分段索引；'unassigned' = 未划分
  let selectedStatus = '';
  let hoveredStatus = null;
  let focusedStatus = null;
  let hoveredSegment = null;
  let focusedSegment = null;
  const anime = window.anime;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let motionAnimations = [];
  let motionTargets = [];
  let motionGeneration = 0;
  let sweepFrame = 0;
  function startVisibleSweep() {
    cancelAnimationFrame(sweepFrame);
    const grid = $('ip-grid');
    const host = window.frameElement;
    if (document.hidden || grid.hidden || (host && (host.hidden || host.dataset.businessReady === 'false'))) return;
    // Commit the short line in a visible, styled frame before starting its one pass.
    sweepFrame = requestAnimationFrame(() => {
      sweepFrame = requestAnimationFrame(() => {
        if (document.hidden || grid.hidden || (host && (host.hidden || host.dataset.businessReady === 'false'))) return;
        grid.querySelectorAll('.ip-sweep-pending').forEach((tile) => {
          tile.classList.remove('ip-sweep-pending');
          if (!reducedMotion.matches) tile.classList.add('ip-feedback');
        });
      });
    });
  }
  function queueGridSweep() {
    $('ip-grid').querySelectorAll('.ip-cell[data-segment]').forEach((tile) => {
      tile.classList.remove('ip-feedback');
      tile.classList.toggle('ip-sweep-pending', !reducedMotion.matches);
    });
    startVisibleSweep();
  }
  window.addEventListener('cmdb-prototype-visible', queueGridSweep);
  window.addEventListener('load', startVisibleSweep, { once: true });
  document.addEventListener('visibilitychange', startVisibleSweep);
  $('ip-grid').addEventListener('animationend', (event) => {
    if (event.animationName === 'ip-selection-sweep') event.target.parentElement.classList.remove('ip-feedback');
  });
  function stopMotion() {
    motionGeneration++;
    motionAnimations.forEach((animation) => animation.cancel());
    motionTargets.forEach((node) => node.style.removeProperty('opacity'));
    motionAnimations = [];
    motionTargets = [];
  }
  reducedMotion.addEventListener('change', () => {
    if (!reducedMotion.matches) return;
    stopMotion();
    cancelAnimationFrame(sweepFrame);
    $('ip-grid').querySelectorAll('.ip-feedback, .ip-sweep-pending').forEach((tile) => tile.classList.remove('ip-feedback', 'ip-sweep-pending'));
  });
  function animateOpacity(targets, to, duration, generation) {
    if (!targets.length) return;
    const animation = anime.animate(targets, {
      opacity: to, duration, ease: 'outQuad',
      onComplete: () => {
        if (generation !== motionGeneration) return;
        targets.forEach((node) => node.style.removeProperty('opacity'));
        motionTargets = motionTargets.filter((node) => !targets.includes(node));
        motionAnimations = motionAnimations.filter((entry) => entry !== animation);
      },
    });
    motionAnimations.push(animation);
  }
  function previewAddresses(animate = true) {
    const status = hoveredStatus ?? focusedStatus;
    const segment = hoveredSegment ?? focusedSegment;
    const entries = document.querySelectorAll('#ip-grid [data-segment-key], #ip-table-body [data-segment-key]');
    const canAnimate = animate && !reducedMotion.matches && typeof anime?.animate === 'function';
    const changes = [];
    for (const entry of entries) {
      const statusDimmed = status !== null && !!status && entry.dataset.status !== status;
      const segmentMatches = segment === null || segment === 'all' || entry.dataset.segmentKey === segment;
      const dimmed = statusDimmed || (segment !== null && !segmentMatches);
      if (canAnimate && (!!entry.style.opacity || entry.classList.contains('status-dimmed') || entry.classList.contains('segment-dimmed')) !== dimmed) {
        changes.push([entry, getComputedStyle(entry).opacity]);
      }
      entry.classList.toggle('status-match', status !== null && (!status || entry.dataset.status === status));
      entry.classList.toggle('status-dimmed', statusDimmed);
      entry.classList.toggle('segment-match', segment !== null && segmentMatches);
      entry.classList.toggle('segment-dimmed', segment !== null && !segmentMatches);
    }
    stopMotion();
    if (!canAnimate) return;
    const dimmedTargets = [];
    const clearTargets = [];
    for (const [entry, opacity] of changes) {
      entry.style.opacity = opacity;
      (entry.classList.contains('status-dimmed') || entry.classList.contains('segment-dimmed') ? dimmedTargets : clearTargets).push(entry);
    }
    const generation = motionGeneration;
    animateOpacity(dimmedTargets, .45, 150, generation);
    animateOpacity(clearTargets, 1, 150, generation);
  }
  function previewStatus() { previewAddresses(); }
  function previewSegment() { previewAddresses(); }
  function selectSegment(segment, focus = false) {
    selectedSegment = selectedSegment === segment ? null : segment;
    hoveredSegment = null;
    focusedSegment = null;
    ipPage = 1;
    selectedIP = '';
    hideAddress();
    renderPool({ animateSegment: true });
    if (focus) $('pool-segment-overview').querySelector(`[data-filter-segment="${segment ?? 'all'}"]`)?.focus({ preventScroll: true });
  }
  const segmentOf = (pool, ip) => (pool.segments || []).find((segment) => numberOf(ip) >= numberOf(segment.start_ip) && numberOf(ip) <= numberOf(segment.end_ip));
  function numberOf(ip) {
    const parts = String(ip || '').split('.');
    if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255 || (part.length > 1 && part.startsWith('0')))) return NaN;
    return parts.reduce((value, part) => value * 256 + Number(part), 0);
  }
  function localAddresses(pool = pools[activePool]) {
    return Array.from({ length: pool.size }, (_, host) => {
      const status = host === 0 ? 'network' : host === pool.size - 1 ? 'broadcast' : [200, 201].includes(host) ? 'abnormal' : host >= 50 && host < 60 ? 'reserved' : occupiedHosts.has(host) ? 'used' : 'free';
      const owner = status === 'used' ? host === 1 ? '示例网关' : host === 25 ? '汇聚交换机 SW-001（示例）' : '示例设备 ' + host : '';
      return { host, ip: pool.prefix + '.' + host, status, owner };
    });
  }
  function sharedAddresses(pool = pools[activePool]) {
    return shared.addresses(pool.id).map((entry) => ({
      ...entry, host: pool.size > 256 ? entry.ip : numberOf(entry.ip) % 256,
      owner: entry.associations.length ? entry.associations.map(({ asset, field }) => asset.name + '（' + field + '）').join('、') : pool.gateway === entry.ip ? '地址池网关' : '',
      location: entry.associations.length ? [...new Set(entry.associations.map(({ asset }) => asset.cabinet_name || asset.data_center || asset.room || asset.location || asset.deployment_location).filter(Boolean))].join('、') : pool.gateway === entry.ip ? pool.name : '',
    }));
  }
  function addresses(pool = pools[activePool]) {
    return shared ? sharedAddresses(pool) : localAddresses(pool);
  }
  const detail = $('ip-detail');
  let detailAnimation = null;
  let detailClosing = false;
  let locateOnClose = false;
  function stopDetailAnimation() {
    detailAnimation?.cancel();
    detailAnimation = null;
    detail.style.removeProperty('opacity');
    detail.style.removeProperty('transform');
    detail.style.removeProperty('scale');
  }
  reducedMotion.addEventListener('change', () => {
    if (!reducedMotion.matches) return;
    stopDetailAnimation();
    if (detailClosing && detail.open) detail.close();
  });
  function locateSelected(focus = false) {
    if (!selectedIP || detail.open) return;
    const container = $('ip-grid').hidden ? $('ip-table-body') : $('ip-grid');
    const target = [...container.querySelectorAll('[data-ip]')].find((node) => node.dataset.ip === selectedIP);
    if (!target) return;
    target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
    if (focus) (target.matches('button') ? target : target.querySelector('button')).focus({ preventScroll: true });
  }
  function hideAddress(focus = false) {
    if (!detail.open) return;
    if (detailClosing && focus) return;
    detailClosing = true;
    locateOnClose = focus;
    stopDetailAnimation();
    if (focus && !reducedMotion.matches && typeof anime?.animate === 'function') {
      detailAnimation = anime.animate(detail, {
        opacity: [1, 0], scale: [1, .97], duration: 110, ease: 'inQuad',
        onComplete: () => { if (detail.open) detail.close(); },
      });
    } else detail.close();
  }
  function renderPicker() {
    const needle = $('pool-find').value.trim().toLowerCase();
    const root = $('pool-options');
    root.replaceChildren();
    for (const category of new Set(pools.map((pool) => pool.category))) {
      const entries = pools.map((pool, index) => ({ pool, index })).filter(({ pool }) => pool.category === category && (pool.name + pool.cidr + (pool.segments || []).map((segment) => segment.name + segment.floor).join(' ')).toLowerCase().includes(needle));
      if (!entries.length) continue;
      const heading = document.createElement('p');
      heading.className = 'group-label';
      heading.textContent = category;
      root.append(heading);
      for (const { pool, index } of entries) {
        const card = document.createElement('div');
        card.className = 'pool-picker-card';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'pool-picker-heading';
        const title = document.createElement('strong'); title.textContent = pool.name;
        const metadata = document.createElement('small');
        const entries = addresses(pool);
        const used = entries.filter((entry) => entry.status === 'used').length;
        metadata.textContent = `${pool.cidr} · ${(pool.segments || []).length} 个分段 · 使用率 ${entries.length ? Math.round(used / entries.length * 100) : 0}%`;
        const arrow = document.createElement('span'); arrow.className = 'pool-picker-arrow'; arrow.setAttribute('aria-hidden', 'true'); arrow.textContent = '▴';
        button.append(title, metadata, arrow);
        const children = document.createElement('div'); children.className = 'pool-picker-segments';
        children.id = `pool-picker-segments-${index}`;
        children.hidden = index !== activePool;
        button.setAttribute('aria-controls', children.id);
        button.setAttribute('aria-expanded', String(!children.hidden));
        button.addEventListener('click', () => {
          const expanded = children.hidden;
          activePool = index; selectedSegment = null; hoveredSegment = null; focusedSegment = null; ipPage = 1; selectedIP = '';
          hideAddress(); renderPool();
          children.hidden = !expanded;
          button.setAttribute('aria-expanded', String(expanded));
        });
        (pool.segments || []).forEach((segment, segmentIndex) => {
          const item = document.createElement('button'); item.type = 'button';
          const label = document.createElement('span'); label.textContent = segment.name + (segment.floor ? ' · ' + segment.floor : '');
          const range = document.createElement('span'); range.className = 'pool-picker-range';
          const samePrefix = segment.start_ip.split('.').slice(0, 3).join('.') === segment.end_ip.split('.').slice(0, 3).join('.');
          range.textContent = samePrefix ? `${segment.start_ip.split('.').pop()}–${segment.end_ip.split('.').pop()}` : `${segment.start_ip}–${segment.end_ip}`;
          range.title = `${segment.start_ip}–${segment.end_ip}`;
          item.append(label, range);
          item.addEventListener('click', () => {
            const cancel = activePool === index && selectedSegment === segmentIndex;
            activePool = index; selectedSegment = cancel ? null : segmentIndex; hoveredSegment = null; focusedSegment = null; ipPage = 1; selectedIP = '';
            hideAddress(); renderPool(); document.querySelector('.pool-selector').open = false;
          });
          children.append(item);
        });
        if (!children.children.length) { const empty = document.createElement('p'); empty.className = 'dialog-note'; empty.textContent = '暂无分段'; children.append(empty); }
        card.append(button, children); root.append(card);
      }
    }
    if (!root.children.length) root.textContent = '没有匹配地址池';
  }
  function showAddress(entry) {
    const previousIP = selectedIP;
    selectedIP = entry.ip;
    const pool = pools[activePool];
    const segment = segmentOf(pool, entry.ip);
    const status = statusText[entry.status] || '未配置';
    $('ip-detail-title').textContent = entry.ip;
    $('ip-detail-status').textContent = status;
    $('ip-detail-status').dataset.status = entry.status;
    $('ip-detail-subtitle').textContent = `${pool.name} · ${pool.cidr}`;
    const fill = (root, pairs) => { root.replaceChildren(); for (const [label, value] of pairs) { const field = document.createElement('div'); field.className = 'field'; const term = document.createElement('dt'); const detail = document.createElement('dd'); term.textContent = label; detail.textContent = value || '未配置'; field.append(term, detail); root.append(field); } };
    fill($('ip-detail-fields'), [['地址池', pool.name], ['分段', segment?.name], ['楼层', segment?.floor], ['网络类型', pool.category]]);
    fill($('ip-detail-usage'), [['占用对象', entry.owner || '未关联'], ['位置', entry.owner ? (entry.location || '未配置') : '未关联']]);
    if (shared && entry.associations?.length) {
      const detail = $('ip-detail-usage').querySelector('dd');
      detail.replaceChildren();
      entry.associations.forEach(({ asset, field }, index) => {
        if (index) detail.append('、');
        const link = document.createElement('button'); link.type = 'button'; link.className = 'quiet'; link.textContent = asset.name + '（' + field + '）';
        link.addEventListener('click', () => shared.openAsset(asset.kind + ':' + asset.id)); detail.append(link);
      });
    }
    const actions = $('ip-detail-actions');
    actions.replaceChildren();
    if (shared) addressActions(entry); else {
    const labels = entry.status === 'free' ? ['预留', '分配'] : entry.status === 'reserved' ? ['取消预留', '分配'] : entry.status === 'used' ? ['释放'] : [];
    for (const label of labels) { const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.disabled = true; button.title = '离线原型不保存地址变更'; actions.append(button); }
    }
    for (const node of document.querySelectorAll('#ip-grid [data-ip], #ip-table-body [data-ip]')) { if (node.dataset.ip !== previousIP && node.dataset.ip !== selectedIP) continue; const selected = node.dataset.ip === selectedIP; node.classList.toggle('ip-selected', selected); (node.matches('button') ? node : node.querySelector('button'))?.setAttribute('aria-pressed', String(selected)); }
    stopDetailAnimation(); if (!detail.open) detail.showModal();
    if (!reducedMotion.matches && typeof anime?.animate === 'function') detailAnimation = anime.animate(detail, { opacity: [0, 1], scale: [.96, 1], duration: 155, ease: 'outQuad', onComplete: () => { detailAnimation = null; detail.style.removeProperty('opacity'); detail.style.removeProperty('scale'); } });
  }
  function addressActions(entry) {
    const actions = $('ip-detail-actions');
    actions.replaceChildren();
    const add = (label, action, title) => { const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.title = title; button.addEventListener('click', action); actions.append(button); };
    if (!shared) {
      const labels = entry.status === 'free' ? ['预留', '分配'] : entry.status === 'reserved' ? ['取消预留', '分配'] : entry.status === 'used' ? ['释放'] : [];
      for (const label of labels) { const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.disabled = true; button.title = '离线原型不保存地址变更'; actions.append(button); }
      return;
    }
    if (!entry.pool_id) { actions.append(document.createTextNode('该地址不属于已登记地址池，不能预留或释放。')); return; }
    if (entry.status === 'free') add('预留', () => { try { shared.reserveIP(entry.ip, true); } catch (error) { window.alert(error.message); } }, '预留该地址并写入事件');
    if (entry.status === 'reserved') add('取消预留', () => { try { shared.reserveIP(entry.ip, false); } catch (error) { window.alert(error.message); } }, '取消预留并写入事件');
    if (entry.status === 'used' && entry.associations.length === 1) {
      const { asset, field } = entry.associations[0];
      add('释放', () => {
        if (!window.confirm(`释放 ${entry.ip}？将从资产「${asset.name}」清除 ${field}，并记录资产履历。`)) return;
        try { shared.changeAsset(asset.kind + ':' + asset.id, { [field]: '' }, '释放地址 ' + entry.ip, '地址池操作'); }
        catch (error) { window.alert(error.message); }
      }, '从唯一关联资产清除该地址');
    }
    if (entry.status === 'used' && entry.associations.length > 1) actions.append(document.createTextNode('该地址被多台资产共享，请到对应资产详情调整，避免误释放。'));
    if (entry.status === 'used' && !entry.associations.length) actions.append(document.createTextNode('地址池网关，不能释放。'));
  }
  function renderPool({ animateSegment = false } = {}) {
    stopMotion();
    hoveredSegment = null;
    focusedSegment = null;
    const pool = pools[activePool];
    const all = addresses();
    if (typeof selectedSegment === 'number' && selectedSegment >= (pool.segments || []).length) selectedSegment = null;
    $('pool-choice').textContent = pool.name + ' · ' + pool.cidr;
    $('pool-heading').textContent = pool.name + ' · ' + pool.category;
    $('pool-metadata').textContent = `${pool.cidr} · 网关 ${pool.gateway} · VLAN ${pool.vlan}${pool.vni ? ' · VNI ' + pool.vni : ''}`;
    $('pool-metadata').title = $('pool-metadata').textContent;
    $('pool-total').textContent = all.length;
    for (const status of ['used', 'reserved', 'free', 'abnormal']) $('pool-' + status).textContent = all.filter((entry) => entry.status === status).length;
    const query = $('pool-search').value.trim().toLowerCase();
    const filtered = all.filter((entry) => (selectedSegment === null || (selectedSegment === 'unassigned' ? !segmentOf(pool, entry.ip) : segmentOf(pool, entry.ip) === pool.segments[selectedSegment])) && (!selectedStatus || entry.status === selectedStatus) && (!query || (entry.ip + ' ' + (entry.owner || '')).toLowerCase().includes(query)));
    const size = Number($('pool-page-size').value);
    const pages = Math.max(1, Math.ceil(filtered.length / size));
    ipPage = Math.min(ipPage, pages);
    const visible = filtered.slice((ipPage - 1) * size, ipPage * size);
    if (!visible.some((entry) => entry.ip === selectedIP)) hideAddress();
    const grid = $('ip-grid');
    const table = $('ip-table-body');
    grid.replaceChildren();
    table.replaceChildren();
    const segmentIndex = (entry) => (pool.segments || []).indexOf(segmentOf(pool, entry.ip));
    const renderTile = (entry) => {
      const special = ['network', 'broadcast'].includes(entry.status);
      const selected = selectedIP === entry.ip;
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.dataset.ip = entry.ip;
      tile.dataset.status = entry.status;
      tile.className = 'ip-cell ' + (special ? 'special' : entry.status) + (selected ? ' ip-selected' : '');
      const index = segmentIndex(entry);
      tile.dataset.segmentKey = index < 0 ? 'unassigned' : String(index);
      if (index >= 0) {
        tile.dataset.segment = String(index % 6);
        tile.title = pool.segments[index].name + (pool.segments[index].floor ? ' · ' + pool.segments[index].floor : '') + ' · ';
      } else {
        tile.classList.add('unassigned');
        tile.title = '未划分 · ';
      }
      if (index >= 0) {
        const marker = document.createElement('span');
        marker.className = 'ip-segment-marker';
        marker.setAttribute('aria-hidden', 'true');
        tile.append(marker);
      }
      const host = document.createElement('span');
      host.className = 'ip-host';
      host.textContent = entry.host;
      tile.append(host);
      tile.title += entry.ip + ' · ' + statusText[entry.status] + ' · 占用设备：' + (entry.owner || '无') + (special ? ' · 不可分配' : '');
      if (entry.status === 'reserved') {
        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        icon.setAttribute('class', 'ip-status-mark');
        icon.setAttribute('aria-hidden', 'true');
        const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        use.setAttribute('href', '#lock');
        icon.append(use);
        tile.append(icon);
      } else if (entry.status === 'used' || entry.status === 'abnormal') {
        const mark = document.createElement('span');
        mark.className = 'ip-status-mark ' + (entry.status === 'used' ? 'ip-status-dot' : 'ip-status-alert');
        mark.setAttribute('aria-hidden', 'true');
        if (entry.status === 'abnormal') mark.textContent = '!';
        tile.append(mark);
      }
      tile.setAttribute('aria-label', tile.title);
      tile.setAttribute('aria-pressed', String(selected));
      tile.addEventListener('click', () => showAddress(entry));
      grid.append(tile);
      if (index >= 0 && !reducedMotion.matches) tile.classList.add('ip-sweep-pending');
    };
    const overview = $('pool-segment-overview');
    const overviewScroll = overview.scrollLeft;
    overview.replaceChildren();
    overview.hidden = false;
    const groups = (pool.segments || []).map((segment) => ({ segment, count: 0, used: 0 }));
    const unassigned = { segment: null, count: 0, used: 0, ranges: [] };
    const ipText = (num) => [24, 16, 8, 0].map((shift) => (num >>> shift) & 255).join('.');
    for (const entry of all) {
      const group = groups[segmentIndex(entry)] || unassigned;
      group.count++;
      if (entry.status === 'used') group.used++;
      if (group === unassigned) {
        const num = shared ? numberOf(entry.ip) : entry.host;
        const last = unassigned.ranges[unassigned.ranges.length - 1];
        if (last && last.end === num - 1) last.end = num;
        else unassigned.ranges.push({ start: num, end: num });
      }
    }
    const addFilter = (label, count, title, key, index = null) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'ip-segment-run';
      item.dataset.filterSegment = key;
      if (index !== null) item.dataset.segment = String(index % 6);
      item.setAttribute('aria-pressed', String(selectedSegment === (key === 'all' ? null : key === 'unassigned' ? 'unassigned' : index)));
      item.title = title;
      if (index !== null) {
        const marker = document.createElement('span');
        marker.className = 'ip-segment-marker';
        marker.setAttribute('aria-hidden', 'true');
        item.append(marker);
      }
      item.append(document.createTextNode(`${label} · ${count}`));
      item.addEventListener('click', () => selectSegment(key === 'unassigned' ? 'unassigned' : index, item.matches(':focus-visible')));
      item.addEventListener('pointerenter', () => { hoveredSegment = key; previewSegment(); });
      item.addEventListener('pointerleave', () => { hoveredSegment = null; previewSegment(); });
      item.addEventListener('focus', () => { focusedSegment = item.matches(':focus-visible') ? key : null; previewSegment(); });
      item.addEventListener('blur', () => { focusedSegment = null; previewSegment(); });
      overview.append(item);
    };
    addFilter('全部分段', all.length, `${all[0].ip}–${all[all.length - 1].ip} · ${all.length} 个地址 · 已占用 ${all.filter((entry) => entry.status === 'used').length}`, 'all');
    for (const [index, group] of groups.entries()) {
      const segment = group.segment;
      addFilter(segment.name, group.count, `${segment.name}${segment.floor ? ' · ' + segment.floor : ''} · ${segment.start_ip}–${segment.end_ip} · ${group.count} 个地址 · 已占用 ${group.used}`, String(index), index);
    }
    const ranges = unassigned.ranges.map(({ start, end }) => shared ? `${ipText(start)}${start === end ? '' : `–${ipText(end)}`}` : `${pool.prefix}.${start}${start === end ? '' : `–${pool.prefix}.${end}`}`).join('、');
    addFilter('未划分', unassigned.count, `未划分 · ${ranges} · ${unassigned.count} 个地址 · 已占用 ${unassigned.used}`, 'unassigned');
    overview.scrollLeft = overviewScroll;
    for (const entry of visible) {
      const selected = selectedIP === entry.ip;
      if (ipLayout === 'grid') renderTile(entry);
      const row = document.createElement('tr');
      row.dataset.ip = entry.ip;
      row.dataset.status = entry.status;
      if (selected) row.className = 'ip-selected';
      row.dataset.segmentKey = segmentIndex(entry) < 0 ? 'unassigned' : String(segmentIndex(entry));
      row.addEventListener('click', () => showAddress(entry));
      const cell = document.createElement('td');
      const link = document.createElement('button');
      link.type = 'button';
      link.textContent = entry.ip;
      link.setAttribute('aria-label', '查看 ' + entry.ip);
      link.setAttribute('aria-pressed', String(selected));
      link.addEventListener('click', (event) => { event.stopPropagation(); showAddress(entry); });
      cell.append(link);
      row.append(cell);
      for (const value of [segmentOf(pool, entry.ip) ? `${segmentOf(pool, entry.ip).name} / ${segmentOf(pool, entry.ip).floor}` : '未划分', pool.category, statusText[entry.status], entry.owner || '—', entry.owner ? (shared ? entry.location || '未配置' : '示例位置') : '—']) {
        const field = document.createElement('td');
        if (shared && value === (entry.owner || '—') && entry.associations?.length) {
          entry.associations.forEach(({ asset, field: key }, index) => {
            if (index) field.append('、');
            const link = document.createElement('button'); link.type = 'button'; link.className = 'quiet'; link.textContent = asset.name + '（' + key + '）';
            link.addEventListener('click', (event) => { event.stopPropagation(); shared.openAsset(asset.kind + ':' + asset.id); }); field.append(link);
          });
        } else field.textContent = value;
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
    document.querySelectorAll('[data-pool-status]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.poolStatus === selectedStatus)));
    previewAddresses(false);
    if (document.readyState === 'complete') startVisibleSweep();
    if (animateSegment && !reducedMotion.matches && typeof anime?.animate === 'function') {
      const targets = [...(grid.hidden ? [] : grid.children), ...($('ip-table').hidden ? [] : table.children)];
      if (targets.length && targets.length <= 128) {
        targets.forEach((node) => { node.style.opacity = '0.7'; });
        animateOpacity(targets, 1, 175, motionGeneration);
      }
      const active = overview.querySelector('[aria-pressed="true"]');
      if (active) {
        active.style.opacity = '0.6';
        animateOpacity([active], 1, 175, motionGeneration);
      }
    }
    syncPoolFilters(all);
    if (shared && unpooled.isConnected) {
      const items = shared.assets().flatMap((asset) => ['ip', 'physical_ip', 'mgmt_ip', 'biz_ip', 'service_ip'].map((field) => ({ asset, field, ip: asset[field] })).filter(({ ip }) => ip && !shared.address(ip).pool_id));
      const summary = document.createElement('summary'), list = document.createElement('div');
      summary.textContent = `未纳管历史地址 · ${items.length} 条`; list.className = 'pool-unpooled-list';
      items.forEach(({ asset, field, ip }, index) => { if (index) list.append('、'); const link = document.createElement('button'); link.type = 'button'; link.className = 'quiet'; link.textContent = `${ip}（${asset.name}·${field}）`; link.addEventListener('click', () => shared.openAsset(asset.kind + ':' + asset.id)); list.append(link); });
      unpooled.replaceChildren(summary, list); unpooled.hidden = !items.length;
    }
  }
  let editorCreate = false;
  let editorIndex = 0;
  let editorSegments = [];
  function renderEditorSegments() {
    const root = $('pool-segment-editor');
    root.replaceChildren();
    if (!editorSegments.length) {
      const empty = document.createElement('p');
      empty.className = 'dialog-note pool-segment-empty';
      empty.textContent = '还没有分段。点“按备注生成”可从备注里的区间自动生成，或手动新增。';
      root.append(empty);
      return;
    }
    const head = document.createElement('div'); head.className = 'pool-segment-head';
    for (const label of ['部门 / 分段', '楼层', '起始 IP', '结束 IP', '数量', '备注']) {
      const cell = document.createElement('span'); cell.textContent = label; head.append(cell);
    }
    root.append(head);
    editorSegments.forEach((segment, index) => {
      const row = document.createElement('div'); row.className = 'pool-segment-row';
      const count = document.createElement('span');
      const updateCount = () => { count.textContent = Number.isFinite(numberOf(segment.start_ip)) && Number.isFinite(numberOf(segment.end_ip)) && numberOf(segment.end_ip) >= numberOf(segment.start_ip) ? numberOf(segment.end_ip) - numberOf(segment.start_ip) + 1 : '待填写'; count.title = count.textContent === '待填写' ? '填写起止 IP 后自动计算' : count.textContent + ' 个地址'; };
      for (const [key, label, cls] of [['name', '部门 / 分段', 'seg-name'], ['floor', '楼层', 'seg-floor'], ['start_ip', '起始 IP', 'seg-start'], ['end_ip', '结束 IP', 'seg-end'], ['remark', '备注', 'seg-remark']]) {
        const cell = document.createElement('span');
        const input = document.createElement('input'); input.value = segment[key] || ''; input.placeholder = label; input.className = cls; input.setAttribute('aria-label', `第 ${index + 1} 段${label}`);
        input.addEventListener('input', () => { segment[key] = input.value; updateCount(); });
        cell.append(input); row.append(cell);
      }
      const countCell = document.createElement('span'); countCell.className = 'seg-count'; countCell.append(count); row.append(countCell);
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '删除'; remove.title = `删除第 ${index + 1} 段`; remove.addEventListener('click', () => { editorSegments.splice(index, 1); renderEditorSegments(); }); row.append(remove);
      updateCount();
      root.append(row);
    });
  }
  function generateSegmentsFromRemarks() {
    const prefix = String($('pool-cidr').value.trim().split('/')[0] || '').split('.').slice(0, 3).join('.');
    const generated = [];
    for (const segment of editorSegments) {
      const remark = String(segment.remark || '').trim();
      const match = remark.match(/(\d{1,3})\s*[-–~至到]\s*(\d{1,3})/);
      if (!match) { generated.push({ ...segment }); continue; }
      const start = Number(match[1]); const end = Number(match[2]);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) { generated.push({ ...segment }); continue; }
      const floor = (remark.match(/(\d+)楼/) || [])[1] ? remark.match(/(\d+)楼/)[1] + '楼' : segment.floor || '';
      const name = remark.replace(/(\d{1,3})\s*[-–~至到]\s*(\d{1,3}).*$/, '').trim() || segment.name;
      generated.push({ name, floor, start_ip: `${prefix}.${start}`, end_ip: `${prefix}.${end}`, remark: '' });
    }
    editorSegments = generated;
    renderEditorSegments();
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
    $('pool-editor-title').textContent = editorCreate ? '新增地址池' : '编辑地址池 · ' + pool.name;
    for (const key of ['name', 'category', 'cidr', 'gateway', 'vlan', 'vni', 'purpose']) $('pool-' + key).value = pool[key] || '';
    editorSegments = (pool.segments || []).map((segment) => ({ ...segment }));
    $('pool-segment-error').textContent = shared && !editorCreate ? '已有地址池的 CIDR 保持稳定，仅维护名称、分段等资料。' : '';
    $('pool-cidr').disabled = Boolean(shared && !editorCreate);
    renderEditorSegments();
    $('pool-editor-scope').textContent = shared ? (editorCreate ? '新增空白表单；保存后写入工作台内存并计入事件时间线。' : '左侧可搜索并切换任意地址池，右侧编辑当前所选；保存后同步事件时间线。') : editorCreate ? '新建表单为空白，不继承当前地址池；原型不保存业务数据。' : '左侧可搜索并切换任意地址池，右侧编辑当前所选；原型不保存业务数据。';
    renderEditorDirectory();
    document.querySelectorAll('details').forEach((detail) => detail.open = false);
    if (!$('pool-editor').open) $('pool-editor').showModal();
  }
  $('pool-find').addEventListener('input', renderPicker);
  for (const [id, event] of [['pool-search', 'input'], ['pool-page-size', 'change']]) $(id).addEventListener(event, () => { ipPage = 1; renderPool(); });
  document.querySelectorAll('[data-pool-status]').forEach((button) => {
    button.addEventListener('click', () => {
      selectedStatus = selectedStatus === button.dataset.poolStatus ? '' : button.dataset.poolStatus;
      ipPage = 1;
      renderPool();
    });
    button.addEventListener('pointerenter', () => { hoveredStatus = button.dataset.poolStatus; previewStatus(); });
    button.addEventListener('pointerleave', () => { hoveredStatus = null; previewStatus(); });
    button.addEventListener('focus', () => { focusedStatus = button.matches(':focus-visible') ? button.dataset.poolStatus : null; previewStatus(); });
    button.addEventListener('blur', () => { focusedStatus = null; previewStatus(); });
  });
  document.querySelectorAll('[data-ip-layout]').forEach((button) => button.addEventListener('click', () => { ipLayout = button.dataset.ipLayout; renderPool(); }));
  $('pool-prev').addEventListener('click', () => { ipPage--; renderPool(); });
  $('pool-next').addEventListener('click', () => { ipPage++; renderPool(); });
  $('ip-detail-close').addEventListener('click', () => hideAddress(true));
  $('ip-relocate').addEventListener('click', () => hideAddress(true));
  detail.addEventListener('cancel', (event) => { event.preventDefault(); hideAddress(true); });
  detail.addEventListener('click', (event) => { if (event.target === detail) hideAddress(true); });
  detail.addEventListener('close', () => {
    stopDetailAnimation();
    detailClosing = false;
    if (locateOnClose) locateSelected(true);
    locateOnClose = false;
  });
  window.addEventListener('resize', () => { if (!detail.open) requestAnimationFrame(() => locateSelected()); });
  document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => $(button.dataset.close).close()));
  document.querySelectorAll('[data-pool-editor]').forEach((button) => button.addEventListener('click', () => {
    const mode = button.dataset.poolEditor;
    fillPoolEditor(mode === 'new', activePool);
  }));
  $('pool-editor-find').addEventListener('input', renderEditorDirectory);
  $('pool-selector-edit').addEventListener('click', () => fillPoolEditor(false, activePool));
  $('pool-segment-add').addEventListener('click', () => { editorSegments.push({ name: '', floor: '', start_ip: '', end_ip: '', remark: '' }); renderEditorSegments(); });
  $('pool-segment-remark').addEventListener('click', generateSegmentsFromRemarks);
  $('pool-editor-save').addEventListener('click', () => {
    const cidr = $('pool-cidr').value.trim();
    const [networkIP, bitsText] = cidr.split('/');
    const bits = Number(bitsText);
    const network = numberOf(networkIP);
    if (!Number.isFinite(network) || !Number.isInteger(bits) || bits < 0 || bits > 32) { $('pool-segment-error').textContent = '请先填写有效的 IPv4 CIDR'; return; }
    if (shared && bits < 16) { $('pool-segment-error').textContent = '工作台地址池网段至少为 /16（需覆盖网络与广播地址）'; return; }
    const mask = bits ? (0xffffffff << (32 - bits)) >>> 0 : 0;
    if (shared && (network & mask) !== network) { $('pool-segment-error').textContent = 'CIDR 起始地址必须是网络地址'; return; }
    for (const [index, segment] of editorSegments.entries()) {
      const start = numberOf(segment.start_ip); const end = numberOf(segment.end_ip);
      if (!segment.name.trim() || !Number.isFinite(start) || !Number.isFinite(end) || start > end || (start & mask) !== (network & mask) || (end & mask) !== (network & mask)) { $('pool-segment-error').textContent = `第 ${index + 1} 段名称、起止 IP 或 CIDR 范围不正确`; return; }
      if (editorSegments.slice(0, index).some((other) => start <= numberOf(other.end_ip) && numberOf(other.start_ip) <= end)) { $('pool-segment-error').textContent = `第 ${index + 1} 段与其他分段重叠`; return; }
    }
    const pool = editorCreate ? { size: 256, prefix: networkIP.split('.').slice(0, 3).join('.') } : pools[editorIndex];
    for (const key of ['name', 'category', 'cidr', 'gateway', 'vlan', 'vni', 'purpose']) if (editorCreate || key !== 'cidr') pool[key] = $('pool-' + key).value.trim();
    if (!pool.name) { $('pool-segment-error').textContent = '请填写地址池名称'; return; }
    pool.segments = editorSegments.map((segment) => ({ ...segment }));
    if (editorCreate) {
      if (shared) {
        const newStart = network & mask, newEnd = newStart + 2 ** (32 - bits) - 1;
        const conflict = shared.pools.some((other) => { const [otherIP, otherBits] = String(other.cidr).split('/'); const otherNumber = numberOf(otherIP); if (!Number.isFinite(otherNumber)) return false; const otherMask = otherBits ? (0xffffffff << (32 - Number(otherBits))) >>> 0 : 0; const start = otherNumber & otherMask; return newStart <= start + 2 ** (32 - Number(otherBits) || 0) - 1 && start <= newEnd; });
        if (conflict) { $('pool-segment-error').textContent = '该 CIDR 与现有地址池重叠'; return; }
        pool.size = 2 ** (32 - bits);
        pool.id = 'pool-' + pool.cidr;
        shared.pools.push(pool);
        activePool = shared.pools.length - 1;
        shared.record({ title: '新增地址池', text: pool.name + ' · ' + pool.cidr, objectType: 'ip', objectId: pool.id });
      } else { pools.push(pool); activePool = pools.length - 1; }
    }
    if (shared && !editorCreate) shared.record({ title: '维护地址池', text: pool.name + ' · ' + pool.cidr, objectType: 'ip', objectId: pool.id });
    selectedSegment = null; hoveredSegment = null; focusedSegment = null; ipPage = 1;
    renderPicker(); renderPool(); $('pool-editor').close();
  });
  const unpooled = document.createElement('details');
  if (shared) { unpooled.id = 'pool-unpooled'; unpooled.className = 'pool-unpooled fold'; document.querySelector('.pool-summary')?.append(unpooled); }
  if ($('pool-add-ip')) $('pool-add-ip').addEventListener('click', () => { $('new-ip-address').value = ''; $('new-ip-note').value = ''; $('pool-ip-editor').showModal(); });
  if (shared) {
    $('pool-abnormal').closest('[data-pool-status="abnormal"]').hidden = true;
    $('pool-filters').hidden = false;
    $('pool-filter-status').addEventListener('change', () => { selectedStatus = $('pool-filter-status').value; ipPage = 1; renderPool(); });
    $('pool-filter-segment').addEventListener('change', () => { const value = $('pool-filter-segment').value; selectedSegment = value === 'all' ? null : value === 'unassigned' ? 'unassigned' : Number(value); ipPage = 1; renderPool(); });
    syncPoolFilters = (all) => {
      const pool = pools[activePool];
      $('pool-filter-status').value = selectedStatus || '';
      const select = $('pool-filter-segment');
      select.innerHTML = '<option value="all">全部分段</option>';
      (pool.segments || []).forEach((segment, index) => { const option = document.createElement('option'); option.value = String(index); option.textContent = segment.name + (segment.floor ? ' · ' + segment.floor : ''); select.append(option); });
      if (all.some((entry) => !segmentOf(pool, entry.ip))) { const option = document.createElement('option'); option.value = 'unassigned'; option.textContent = '未划分'; select.append(option); }
      const value = selectedSegment === null ? 'all' : String(selectedSegment);
      select.value = [...select.options].some((option) => option.value === value) ? value : 'all';
    };
    const refresh = () => {
      const activeId = pools[activePool]?.id;
      const index = shared.pools.findIndex((pool) => pool.id === activeId);
      if (index >= 0) activePool = index;
      renderPicker(); renderPool();
      if (detail.open && selectedIP) { const entry = shared.address(selectedIP); if (entry.pool_id) showAddress(addresses(entry.pool).find((item) => item.ip === selectedIP) || entry); }
    };
    window.workbenchAdapter = {
      openObject(type, id) {
        if (type !== 'ip') return false;
        const poolIndex = shared.pools.findIndex((pool) => pool.id === shared.address(id).pool_id);
        if (poolIndex < 0) return false;
        activePool = poolIndex; selectedSegment = null; selectedStatus = ''; ipPage = 1; hideAddress();
        $('pool-search').value = id; renderPool();
        const entry = addresses().find((item) => item.ip === id); if (entry) showAddress(entry);
        return true;
      },
      get currentPoolId() { return pools[activePool]?.id || ''; },
      pools: () => shared.pools.map((pool) => ({ id: pool.id, label: pool.name + ' · ' + pool.cidr, cidr: pool.cidr })),
      selectPool(id) { const index = shared.pools.findIndex((pool) => pool.id === id); if (index < 0) return false; activePool = index; selectedSegment = null; selectedStatus = ''; ipPage = 1; hideAddress(); renderPool(); return true; },
      refresh, searchInput: $('pool-search'), filterButton: null, filters: $('pool-filters'),
      menus: [{ label: '新增地址池', run: () => fillPoolEditor(true) }, { label: '维护地址池', run: () => fillPoolEditor(false, activePool) }],
    };
    const unsubscribe = shared.subscribe(refresh);
    window.addEventListener('unload', unsubscribe);
  }
  document.querySelectorAll('details').forEach((detail) => detail.addEventListener('toggle', () => {
    if (detail.open && !detail.classList.contains('fold')) document.querySelectorAll('details[open]').forEach((other) => { if (other !== detail && !other.classList.contains('fold')) other.open = false; });
  }));
  renderPicker();
  renderPool();
})();

(() => {
  'use strict';
  const kinds = ['terminal', 'infrastructure', 'systems'];
  const ipFields = ['ip', 'physical_ip', 'mgmt_ip', 'biz_ip', 'service_ip'];
  const listeners = new Set();
  let sequence = 0;
  const model = { assetsByKind: Object.fromEntries(kinds.map(kind => [kind, window.assetPrototypePages[kind].rows])), people: [], nodes: [], pools: [], rooms: [], racks: [], connections: [], orders: [], events: [] };
  const keyOf = row => row.kind + ':' + row.id;
  model.assets = () => kinds.flatMap(kind => model.assetsByKind[kind]);
  model.asset = key => model.assets().find(row => keyOf(row) === key || row.id === key);
  model.assetsForPerson = id => model.assets().filter(row => String(row.person_id) === String(id) && row.status !== '已注销');
  model.assetsForIP = ip => model.assets().flatMap(asset => asset.status === '已注销' ? [] : ipFields.filter(field => asset[field] === ip).map(field => ({ asset, field })));
  model.assetsForRack = id => model.assets().filter(row => row.cabinetId === id && row.status !== '已注销');
  model.subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn); };
  model.notify = () => { for (const fn of listeners) fn(); };
  model.keyOf = keyOf;
  model.ipFields = ipFields;
  const numberIP = ip => { const parts = String(ip).split('.'); return parts.length === 4 && parts.every(p => /^\d+$/.test(p) && +p <= 255) ? parts.reduce((n, p) => n * 256 + +p, 0) : null; };
  const stringIP = n => [24, 16, 8, 0].map(shift => Math.floor(n / 2 ** shift) % 256).join('.');
  function range(pool) {
    const [ip, raw] = String(pool.cidr).split('/'); const bits = Number(raw), num = numberIP(ip);
    if (num === null || !Number.isInteger(bits) || bits < 16 || bits > 32) return null;
    const size = 2 ** (32 - bits), start = Math.floor(num / size) * size;
    return { start, size, bits };
  }
  const reservations = new Set();
  model.address = ip => {
    const number = numberIP(ip);
    const pool = model.pools.find(p => { const r = range(p); return r && number !== null && number >= r.start && number < r.start + r.size; });
    const r = pool && range(pool), associations = model.assetsForIP(ip);
    const status = r && r.bits < 31 && number === r.start ? 'network' : r && r.bits < 31 && number === r.start + r.size - 1 ? 'broadcast' : associations.length || pool?.gateway === ip ? 'used' : reservations.has(ip) ? 'reserved' : 'free';
    return { id: ip, ip, pool_id: pool?.id || '', pool, status, associations };
  };
  model.addresses = poolId => { const pool = model.pools.find(p => p.id === poolId); const r = pool && range(pool); return r ? Array.from({ length: r.size }, (_, i) => model.address(stringIP(r.start + i))) : []; };
  model.reserveIP = (ip, reserved) => { const a = model.address(ip); if (!a.pool || !['free', 'reserved'].includes(a.status)) throw Error('该地址不可预留或释放。'); reserved ? reservations.add(ip) : reservations.delete(ip); model.record({ title: reserved ? '预留地址' : '取消地址预留', text: ip, objectType: 'ip', objectId: ip }); };
  function decorate(row, kind) {
    row.kind = kind;
    if (!Array.isArray(row.history)) row.history = String(row.history || '').split('\n').filter(Boolean).map(text => ({ date: text.slice(0, 10), title: '原型历史记录', text }));
    if (kind === 'infrastructure') {
      for (const [alias, field] of [['start', 'start_u'], ['height', 'height_u']]) {
        const descriptor = Object.getOwnPropertyDescriptor(row, alias);
        if (!descriptor?.get) { if (row[field] === undefined && row[alias] !== undefined) row[field] = row[alias]; delete row[alias]; Object.defineProperty(row, alias, { enumerable: false, configurable: true, get() { return this[field] || 0; }, set(value) { this[field] = Number(value) || 0; } }); }
      }
    }
    row.vendor_model = [row.vendor, row.model].filter(Boolean).join(' / ');
    return row;
  }
  model.assets().forEach(row => decorate(row, kinds.find(kind => model.assetsByKind[kind].includes(row))));
  // Explicit fixture links join existing sample IDs, rather than inferring names.
  const hostIds = ['infra-example-09', 'infra-example-10', 'infra-example-06', 'infra-example-04', 'infra-example-05', 'infra-example-09'];
  model.assetsByKind.systems.forEach((row, i) => { if (row.host_linked === '已关联') { row.server_id = hostIds[i % hostIds.length]; row.server_name = model.asset(row.server_id).name; } });
  function linkPeople() {
    if (!model.people.length) return;
    model.assets().forEach((row, index) => {
      if (row.person_id === undefined) row.person_id = row.person && !/未分配/.test(row.person) ? model.people[index % model.people.length].id : '';
      const person = model.people.find(p => String(p.id) === String(row.person_id));
      if (person) { row.person = person.name; row.department = person.department; row.organization = person.org_name; }
    });
  }
  model.register = (name, rows) => {
    if (!Array.isArray(model[name])) throw Error('未知原型集合：' + name);
    if (!model[name].length) model[name].push(...rows);
    if (name === 'pools') model.pools.forEach(p => { p.id ||= 'pool-' + p.cidr; });
    if (name === 'people') linkPeople();
    return model[name];
  };
  model.registerRackDevices = rows => {
    rows.forEach(source => {
      let row = model.asset(source.id);
      if (!row) { row = decorate({ ...source, photos: {}, status: '在线', start_u: source.start || 0, height_u: source.height || 1, history: [] }, 'infrastructure'); model.assetsByKind.infrastructure.push(row); }
      const rack = model.racks.find(r => r.id === row.cabinetId), room = model.rooms.find(r => r.id === (rack?.roomId || row.roomId));
      row.data_center = room?.name || ''; row.cabinet_name = rack?.name || '';
    });
    model.assetsByKind.infrastructure.filter(row => !/虚拟|云主机|容器/.test(row.type)).forEach(row => {
      if (!row.cabinetId && row.cabinet_name) {
        let room = model.rooms.find(r => r.name === row.data_center);
        if (!room) { room = { id: 'asset-room-' + model.rooms.length, name: row.data_center }; model.rooms.push(room); }
        let rack = model.racks.find(r => r.roomId === room.id && r.name === row.cabinet_name);
        if (!rack) { rack = { id: 'asset-rack-' + model.racks.length, roomId: room.id, name: row.cabinet_name, total: 42 }; model.racks.push(rack); }
        row.roomId = room.id; row.cabinetId = rack.id;
      }
      row.location = locationText(row);
    });
    linkPeople();
    return model.assetsByKind.infrastructure.filter(row => !/虚拟|云主机|容器/.test(row.type));
  };
  function locationText(row) { return /虚拟|云主机|容器/.test(row.type) ? '无实体位置' : [row.data_center, row.cabinet_name, Number(row.start_u) ? row.start_u + '–' + (+row.start_u + (+row.height_u || 1) - 1) + 'U' : '未上架'].filter(Boolean).join(' / '); }
  function validate(kind, draft, previous) {
    if (!String(draft.name || '').trim() || !String(draft.type || '').trim()) throw Error('设备名称和类型必填。');
    if (draft.code && model.assets().some(a => a !== previous && a.code === draft.code)) throw Error('资产编号已存在。');
    if (draft.person_id && !model.people.some(p => String(p.id) === String(draft.person_id))) throw Error('请从组织目录选择人员。');
    for (const field of ipFields) {
      const ip = String(draft[field] || '').trim();
      if (!ip || ip === previous?.[field]) continue;
      const address = model.address(ip);
      if (!address.pool) throw Error(ip + ' 未纳入地址池，请先维护地址池。');
      if (['network', 'broadcast'].includes(address.status) || address.pool.gateway === ip) throw Error(ip + ' 是保留网络地址。');
      if (address.associations.some(link => link.asset !== previous)) throw Error(ip + ' 已被其他资产占用；新分配不允许共享，历史共享仍可查看。');
    }
    const positionChanged = ['cabinetId', 'start_u', 'height_u'].some(k => String(draft[k] || '') !== String(previous?.[k] || ''));
    if (positionChanged && Number(draft.start_u)) {
      const rack = model.racks.find(r => r.id === draft.cabinetId);
      const start = Number(draft.start_u), height = Number(draft.height_u || 1);
      if (!rack || !Number.isInteger(start) || !Number.isInteger(height) || start < 1 || height < 1 || start + height - 1 > Number(rack.total)) throw Error('机柜、起始 U 位或占用高度无效，不能越界。');
      if (model.assetsForRack(rack.id).some(row => row !== previous && +row.start_u > 0 && start <= +row.start_u + (+row.height_u || 1) - 1 && start + height - 1 >= +row.start_u)) throw Error('目标 U 位已占用，未保存任何修改。');
    }
    if (kind === 'infrastructure' && /虚拟|云主机|容器/.test(draft.type) && draft.cabinetId) throw Error('虚拟资源不能分配实体机柜。');
  }
  model.record = ({ title, text = '', assetKeys = [], objectType, objectId, time = new Date().toISOString() }) => {
    const event = { id: 'event-' + (++sequence), time, title, text, assetKeys: [...assetKeys], objectType, objectId };
    model.events.unshift(event);
    for (const key of assetKeys) { const row = model.asset(key); if (row) row.history.unshift({ id: event.id, date: time, title, text }); }
    model.notify(); return event;
  };
  model.saveAsset = (kind, values, options = {}) => {
    if (!kinds.includes(kind)) throw Error('未知资产类型。');
    const previous = options.id ? model.assetsByKind[kind].find(a => a.id === options.id) : null;
    if (options.id && !previous) throw Error('资产已不存在。');
    const draft = { ...previous, ...values };
    for (const [alias, field] of [['start', 'start_u'], ['height', 'height_u']]) { if (values[field] === undefined && values[alias] !== undefined) draft[field] = values[alias]; delete draft[alias]; }
    if (draft.start_u !== undefined) draft.start_u = Number(draft.start_u) || 0;
    if (draft.height_u !== undefined) draft.height_u = Number(draft.height_u) || 0;
    validate(kind, draft, previous);
    const person = model.people.find(p => String(p.id) === String(draft.person_id));
    if (person) { draft.person = person.name; draft.department = person.department; draft.organization = person.org_name; }
    else if (draft.person_id === '') draft.person = '';
    const rack = model.racks.find(r => r.id === draft.cabinetId);
    if (rack) { draft.roomId = rack.roomId; draft.cabinet_name = rack.name; draft.data_center = model.rooms.find(r => r.id === rack.roomId)?.name || ''; }
    else if (draft.cabinetId === '') { draft.cabinet_name = ''; draft.start_u = 0; }
    if (kind === 'terminal' && !/云桌面|云盒|盒子/.test(draft.type)) draft.physical_ip = '';
    if (kind === 'infrastructure') draft.location = locationText(draft);
    const host = model.asset(draft.server_id); if (kind === 'systems') { draft.server_name = host?.name || ''; draft.host_linked = host ? '已关联' : '未关联'; }
    for (const [ipField, netField] of [['ip', 'network'], ['mgmt_ip', 'net_type'], ['biz_ip', 'business_network_type'], ['service_ip', 'network_type']]) if (draft[ipField] !== previous?.[ipField]) draft[netField] = model.address(draft[ipField]).pool?.category || '未配置';
    let row = previous;
    if (row) Object.assign(row, draft);
    else { row = { ...draft, id: kind + '-registered-' + (++sequence), history: [], status: draft.status || (kind === 'terminal' ? '使用' : kind === 'systems' ? '正常运行' : '在线') }; model.assetsByKind[kind].push(row); }
    decorate(row, kind);
    model.record({ title: options.title || (previous ? '修改资产' : '登记资产'), text: options.note || row.name, assetKeys: [keyOf(row)], objectType: kind, objectId: row.id });
    return row;
  };
  model.changeAsset = (key, patch, title, note = '') => { const row = model.asset(key); if (!row) throw Error('资产不存在。'); return model.saveAsset(row.kind, patch, { id: row.id, title, note }); };
  model.transferAssets = (keys, personId, note) => {
    const person = model.people.find(p => String(p.id) === String(personId));
    if (!person || person.status === '离职') throw Error('请选择在职接收人。');
    const rows = keys.map(model.asset);
    if (!rows.length || rows.some(row => !row || row.status === '已注销')) throw Error('交接资产不存在或已注销。');
    rows.forEach(row => validate(row.kind, { ...row, person_id: person.id }, row));
    rows.forEach(row => Object.assign(row, { person_id: person.id, person: person.name, department: person.department, organization: person.org_name }));
    model.record({ title: '调换使用人', text: person.name + ' · ' + (note || '原型交接'), assetKeys: rows.map(keyOf), objectType: 'person', objectId: person.id });
    return rows;
  };
  model.archiveAsset = (key, reason) => { if (!String(reason || '').trim()) throw Error('请填写注销原因。'); return model.changeAsset(key, { status: '已注销', ...Object.fromEntries(ipFields.map(field => [field, ''])), cabinetId: '', start_u: 0 }, '注销归档', reason); };
  model.assets().forEach(row => row.history.forEach(item => model.events.push({ id: 'event-' + (++sequence), time: item.date || '2026-10-01', title: item.title, text: item.text, assetKeys: [keyOf(row)], objectType: row.kind, objectId: row.id })));
  model.related = (type, id) => {
    const row = kinds.includes(type) ? model.asset(type + ':' + id) : null;
    if (row) { const hosted = model.assetsByKind.systems.filter(system => system.server_id === row.id); return [...(row.person_id ? [{ type: 'person', id: row.person_id, label: row.person }] : []), ...ipFields.filter(f => row[f]).map(f => ({ type: 'ip', id: row[f], label: row[f] })), ...(row.cabinetId ? [{ type: 'rack', id: row.cabinetId, label: row.location }] : []), ...(row.server_id ? [{ type: 'infrastructure', id: row.server_id, label: row.server_name }] : []), ...hosted.map(system => ({ type: 'systems', id: system.id, label: system.name })), ...model.orders.filter(o => o.assets.includes(keyOf(row))).map(o => ({ type: 'order', id: o.id, label: o.subject }))]; }
    const assets = type === 'person' ? model.assetsForPerson(id) : type === 'ip' ? model.assetsForIP(id).map(x => x.asset) : type === 'rack' ? model.assetsForRack(id) : type === 'order' ? (model.orders.find(o => String(o.id) === String(id))?.assets || []).map(model.asset).filter(Boolean) : [];
    return [...new Set(assets)].map(a => ({ type: a.kind, id: a.id, label: a.name }));
  };
  window.cmdbPrototype = model;
})();

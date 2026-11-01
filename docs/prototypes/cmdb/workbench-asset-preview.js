(() => {
  'use strict';
  const shared = window.opener?.cmdbPrototype || (window.parent !== window ? window.parent.cmdbPrototype : null);
  if (!shared) return;
  function open(kind, row, mode = 'detail', source = '') {
    if (!['terminal', 'infrastructure', 'systems'].includes(kind)) return;
    if (mode === 'create') return show(kind, '', 'create', source);
    if (!row) return;
    if (['transfer', 'maintenance', 'archive'].includes(mode)) return show(kind, row.id, mode, source);
    return show(kind, row.id, mode === 'edit' ? 'edit' : 'detail', source);
  }
  function show(kind, id, mode, source = '') {
    return shared.openObject(kind, id, { mode, source: source || 'assets' });
  }
  function createField(field, values, id, onStructuralChange) {
    if (!['person', 'organization', 'department', 'server_name', 'ip', 'physical_ip', 'mgmt_ip', 'biz_ip', 'service_ip', 'data_center', 'cabinet_name', 'start_u', 'height_u'].includes(field.key)) return null;
    const wrapper = document.createElement('div');
    wrapper.className = 'field';
    const label = document.createElement('label');
    label.htmlFor = id;
    label.textContent = field.label;
    if (field.required) { const required = document.createElement('span'); required.className = 'required'; required.textContent = '*'; label.append(required); }
    const select = document.createElement('select');
    select.id = id;
    select.name = ({ person: 'person_id', data_center: 'roomId', cabinet_name: 'cabinetId', server_name: 'server_id' })[field.key] || field.key;
    const prepend = (value, text) => select.append(new Option(text, value));
    prepend('', '请选择');
    if (['organization', 'department'].includes(field.key)) {
      const person = shared.people.find(p => String(p.id) === String(values.person_id));
      const output = document.createElement('input'); output.readOnly = true; output.value = person ? field.key === 'department' ? person.department : person.org_name : values[field.key] || ''; output.name = field.key; output.id = id;
      wrapper.append(label, output); return wrapper;
    }
    if (field.key === 'server_name') {
      for (const host of shared.assetsByKind.infrastructure.filter(row => row.status !== '已注销')) prepend(host.id, host.name + ' · ' + host.code);
      select.value = values.server_id || '';
      select.onchange = () => { const host = shared.asset(select.value); values.server_id = select.value; values.server_name = host?.name || ''; onStructuralChange?.('server_name'); };
      wrapper.append(label, select); return wrapper;
    }
    if (field.key === 'person') {
      for (const person of shared.people) prepend(String(person.id), person.name + ' · ' + person.org_name + ' / ' + person.department + (person.status === '离职' ? ' · 离职' : ''));
      select.value = String(values.person_id ?? '');
      select.addEventListener('change', () => {
        const person = shared.people.find(entry => String(entry.id) === select.value);
        values.person_id = select.value;
        if (person) { values.person = person.name; values.department = person.department; values.organization = person.org_name; }
        else values.person = values.department = values.organization = '';
        values.__personChanged = true;
        onStructuralChange?.('person');
      });
    } else if (field.key === 'data_center') {
      for (const room of shared.rooms) prepend(room.id, room.name);
      const room = shared.rooms.find(entry => entry.id === values.roomId) || shared.rooms.find(entry => entry.name === values.data_center);
      select.value = room?.id || '';
      select.addEventListener('change', () => {
        const target = shared.rooms.find(entry => entry.id === select.value);
        values.roomId = select.value; values.data_center = target?.name || ''; values.cabinetId = ''; values.cabinet_name = ''; values.start_u = 0;
        onStructuralChange?.('data_center');
      });
    } else if (field.key === 'cabinet_name') {
      const rackOptions = shared.racks.filter(rack => !values.roomId || rack.roomId === values.roomId);
      for (const rack of rackOptions) prepend(rack.id, rack.name + ' · ' + (shared.rooms.find(room => room.id === rack.roomId)?.name || '') + ' · ' + rack.total + 'U');
      select.value = values.cabinetId || '';
      select.addEventListener('change', () => {
        const rack = shared.racks.find(entry => entry.id === select.value);
        values.cabinetId = select.value; values.cabinet_name = rack?.name || ''; values.roomId = rack?.roomId || values.roomId; values.data_center = shared.rooms.find(room => room.id === values.roomId)?.name || '';
        onStructuralChange?.('cabinet_name');
      });
    } else if (['start_u', 'height_u'].includes(field.key)) {
      const input = document.createElement('input'); input.type = 'number'; input.min = field.key === 'start_u' ? '0' : '1'; input.id = id; input.name = field.key; input.value = values[field.key] ?? '';
      input.addEventListener('input', () => { values[field.key] = input.value; });
      wrapper.append(label, input); return wrapper;
    } else {
      const poolAddresses = shared.pools.flatMap(pool => shared.addresses(pool.id));
      const available = poolAddresses.filter(address => address.ip === values[field.key] || address.status === 'free' || address.status === 'reserved');
      for (const address of available) prepend(address.ip, address.ip + ' · ' + (address.pool?.name || shared.pools.find(pool => pool.id === address.pool_id)?.name || '未纳管') + ' · ' + ({ free: '空闲', reserved: '预留', used: '本记录当前占用' }[address.status] || address.status));
      if (values[field.key] && !available.some(address => address.ip === values[field.key])) prepend(values[field.key], values[field.key] + ' · 旧地址（未纳入地址池，保留值）');
      select.value = values[field.key] || '';
      select.addEventListener('change', () => { values[field.key] = select.value; onStructuralChange?.('ip'); });
    }
    wrapper.append(label, select);
    return wrapper;
  }
  function exportRows(rows) {
    const fields = ['name', 'code', 'type', 'status', 'sn', 'box_sn', 'vendor', 'model', 'person', 'department', 'room', 'ip', 'physical_ip', 'network', 'os', 'os_version', 'data_center', 'cabinet_name', 'start_u', 'height_u'];
    const escape = value => '"' + String(value ?? '').replace(/"/g, '""') + '"';
    const csv = [fields.map(escape).join(','), ...rows.map(row => fields.map(field => escape(row[field])).join(','))].join('\r\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
    link.download = 'cmdb-prototype-assets.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }
  function columnsMenu(columns, hidden, render, event) {
    document.getElementById('workbench-columns')?.remove();
    const menu = document.createElement('dialog'); menu.id = 'workbench-columns'; menu.className = 'operations-menu';
    const title = document.createElement('strong'); title.textContent = '显示列'; menu.append(title);
    for (const column of columns) {
      const label = document.createElement('label'); const box = document.createElement('input'); box.type = 'checkbox'; box.checked = !hidden.has(column.key); box.disabled = column.key === 'name';
      box.onchange = () => { box.checked ? hidden.delete(column.key) : hidden.add(column.key); render(); };
      label.append(box, document.createTextNode(column.label)); menu.append(label);
    }
    const close = document.createElement('button'); close.textContent = '关闭'; close.onclick = () => menu.remove(); menu.append(close); document.body.append(menu); menu.show();
    menu.style.cssText = `position:fixed;left:${Math.min(event.clientX, innerWidth - 240)}px;top:${Math.min(event.clientY, innerHeight - 400)}px;width:220px;padding:12px;display:grid;gap:8px`;
  }
  window.workbenchAsset = { createField, open, show, exportRows, columnsMenu };
})();

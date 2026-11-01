(() => {
  'use strict';
  const host = window.opener?.cmdbPrototype ? window.opener : window.parent !== window && window.parent.cmdbPrototype ? window.parent : null;
  const shared = host?.cmdbPrototype;
  if (!shared) { document.body.textContent = '请从工作台原型打开资产窗口。'; return; }
  const byId = id => document.getElementById(id);
  const owner = byId('record-window');
  const current = new URLSearchParams(location.search);
  const kind = ['terminal', 'infrastructure', 'systems'].includes(current.get('kind')) ? current.get('kind') : 'terminal';
  let id = current.get('id') || '';
  let mode = ['edit', 'create', 'transfer', 'maintenance', 'archive'].includes(current.get('mode')) ? current.get('mode') : 'detail';
  let activeSection = 'basic';
  let editor = null;
  let dirty = false;
  let committing = false;
  let closing = false;
  const pendingURLs = new Set();
  const node = (tag, className, text) => { const item = document.createElement(tag); if (className) item.className = className; if (text !== undefined) item.textContent = text; return item; };
  const svg = name => { const item = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); const use = document.createElementNS(item.namespaceURI, 'use'); use.setAttribute('href', '#' + name); item.setAttribute('viewBox', '0 0 24 24'); item.setAttribute('aria-hidden', 'true'); item.append(use); return item; };
  const button = (label, run, className = 'quiet') => { const item = node('button', className, label); item.type = 'button'; item.onclick = run; return item; };
  const display = value => value === null || value === undefined || value === '' ? '未配置' : String(value);
  const row = () => id ? shared.asset(kind + ':' + id) : null;
  // Preserve the original form definitions while separating the legacy brand field from manufacturer.
  const original = window.assetPrototypePages[kind];
  const config = { ...original, groups: original.groups.map(group => ({ ...group, fields: group.fields.flatMap(field => field.key === 'vendor' ? [{ key: 'manufacturer', label: '厂家', when: field.when }, { ...field, label: '品牌' }] : [{ ...field }]) })) };
  const fields = () => config.groups.flatMap(group => group.fields);
  const isVirtual = data => kind === 'systems' || /云桌面(?!盒子)|虚拟机|virtual|云主机|容器/i.test(data?.type || '');
  const hasDraft = () => dirty || Boolean(editor?.isDirty());
  const normalizedFiles = value => Array.isArray(value) ? value.filter(file => file && typeof file === 'object' && typeof file.url === 'string' && file.url.startsWith('blob:')).map(file => ({ ...file })) : [];
  const normalizedPhotos = value => ({ front: normalizedFiles(value?.front), back: normalizedFiles(value?.back) });
  const fileURLs = data => [...normalizedFiles(data?.attachments), ...Object.values(normalizedPhotos(data?.photos)).flat()].map(file => file.url);
  function releaseDraftURLs() { for (const url of pendingURLs) host.URL.revokeObjectURL(url); pendingURLs.clear(); }
  function discardDraft() { releaseDraftURLs(); editor = null; dirty = false; owner._disposeForm?.(); }
  function allowDiscard() { return !hasDraft() || window.confirm('当前有未保存的修改，确定放弃？'); }
  function requestClose() {
    if (!allowDiscard()) return false;
    discardDraft(); closing = true;
    if (window.parent !== window && !window.opener) { mode = 'detail'; openDetail(); closing = false; }
    else window.close();
    return true;
  }
  owner.close = requestClose;
  function clearSurface() {
    owner._disposeForm?.();
    const nav = byId('record-nav');
    delete nav.dataset.formTabs;
    nav.className = '';
    nav.replaceChildren();
    nav.setAttribute('role', 'tablist');
    nav.setAttribute('aria-orientation', 'vertical');
    byId('record-body').replaceChildren();
    byId('record-actions').replaceChildren();
  }
  function section(title, icon, pairs = []) {
    const card = node('section', 'asset-section record-section');
    const heading = node('h3'); heading.append(svg(icon), document.createTextNode(title)); card.append(heading);
    if (pairs.length) {
      const list = node('dl', 'asset-detail-values record-fields');
      for (const [label, value] of pairs) { const item = node('div'); const content = node('dd'); value instanceof Node ? content.append(value) : content.textContent = display(value); item.append(node('dt', '', label), content); list.append(item); }
      card.append(list);
    }
    return card;
  }
  function fieldPairs(keys, data) {
    const seen = new Set();
    return fields().filter(field => keys.includes(field.key) && (!field.when || field.when(data)) && !seen.has(field.key) && seen.add(field.key)).map(field => [field.label, data[field.key]]);
  }
  function addTab(key, title, icon, panel, run) {
    const tab = button('', run, 'asset-form-tab');
    tab.id = 'record-tab-' + key;
    tab.dataset.formTab = key;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', panel.id);
    tab.append(svg(icon), node('span', 'record-tab-label', title));
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', tab.id);
    byId('record-nav').append(tab);
    return tab;
  }
  function selectDetail(key) {
    const panels = [...byId('record-body').children];
    const target = panels.find(panel => panel.dataset.section === key) || panels[0];
    activeSection = target?.dataset.section || 'basic';
    for (const panel of panels) panel.hidden = panel !== target;
    for (const tab of byId('record-nav').children) { const selected = tab.dataset.formTab === activeSection; tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1; }
  }
  function historyList(data) {
    const list = node('ol', 'prototype-history');
    const entries = Array.isArray(data.history) ? [...data.history].reverse() : String(data.history || '').split('\n').filter(Boolean);
    for (const entry of entries) { const item = node('li'); typeof entry === 'string' ? item.textContent = entry : item.append(node('strong', '', (entry.date || entry.time || '') + ' · ' + (entry.title || '记录')), node('div', '', entry.text || '')); list.append(item); }
    if (!entries.length) list.append(node('li', '', '暂无履历'));
    return list;
  }
  function credentials(data) {
    const card = section('凭证引用', 'key', [['Netcatty 主机引用', data.host_id || data.host_ref], ['密钥库引用', data.credential_id || data.vault_ref]]);
    card.append(node('p', 'dialog-note', '仅展示已有引用标识；此原型未接入主机或密钥库目录，不读取、录入或生成密码与私钥。'));
    return card;
  }
  function filesPanel(data, editable = false) {
    const card = section('照片与附件', 'attachment');
    const photos = normalizedPhotos(data.photos);
    const attachments = normalizedFiles(data.attachments);
    if (editable) { data.photos = photos; data.attachments = attachments; }
    for (const [key, label, files, photo] of [...(isVirtual(data) ? [] : [['front', '正面照片', photos.front, true], ['back', '背面照片', photos.back, true]]), ['attachments', '附件', attachments, false]]) {
      const group = node('div', 'record-file-group');
      group.append(node('h4', '', label));
      const list = node('div', photo ? 'record-photos' : 'record-attachments');
      function paint() {
        list.replaceChildren();
        if (!files.length) list.append(node('p', 'dialog-note', '暂无' + label));
        files.forEach((file, index) => {
          const item = node(photo ? 'figure' : 'div', photo ? 'detail-photo' : 'record-attachment');
          if (photo) { const image = node('img'); image.src = file.url; image.alt = file.name || label; item.append(image); }
          const link = node('a', 'detail-link', (file.name || '本机文件') + (file.size !== undefined ? ' · ' + Math.ceil(file.size / 1024) + ' KB' : '')); link.href = file.url; link.download = file.name || '附件'; item.append(link);
          if (editable) item.append(button('移除', () => { const removed = files.splice(index, 1)[0]; if (pendingURLs.delete(removed.url)) host.URL.revokeObjectURL(removed.url); dirty = true; paint(); }));
          list.append(item);
        });
      }
      group.append(list); paint();
      if (editable) {
        const picker = node('input', 'record-file'); picker.type = 'file'; picker.multiple = true; if (photo) picker.accept = 'image/*'; picker.setAttribute('aria-label', '选择' + label);
        picker.onchange = () => {
          for (const file of picker.files) { if (photo && !file.type.startsWith('image/')) continue; const url = host.URL.createObjectURL(file); pendingURLs.add(url); files.push({ name: file.name, size: file.size, type: file.type, file, url }); dirty = true; }
          picker.value = ''; paint();
        };
        group.append(picker);
      }
      card.append(group);
    }
    if (isVirtual(data)) card.append(node('p', 'dialog-note', '虚拟资源或业务系统无实体外观照片；可添加说明或配置文件作为附件。'));
    card.append(node('p', 'dialog-note', editable ? '从本机选择文件；保存后与资产一起保留在工作台内存，取消会丢弃新增文件。未上传；刷新工作台后失效。' : '文件为本机 ObjectURL 预览与下载；保留至工作台关闭或刷新。请编辑资产以添加或移除。'));
    return card;
  }
  function openDetail() {
    mode = 'detail'; editor = null; dirty = false; clearSurface();
    const data = row();
    byId('record-status').textContent = data?.status || '';
    byId('record-title').textContent = data?.name || '资产资料';
    if (!data) { byId('record-body').append(node('p', 'dialog-note', '资产不存在，请返回工作台选择资产。')); byId('record-footer').replaceChildren(); return; }
    const actions = byId('record-actions');
    actions.append(button('编辑', () => openEdit()));
    const more = node('select', 'record-operation'); more.setAttribute('aria-label', '资产操作'); more.append(new Option('更多操作', ''));
    for (const [key, label] of [['transfer', '调换使用人'], ['ip', '更换 IP'], ...(kind === 'infrastructure' ? [['rack', '迁移机柜']] : []), ...(kind !== 'systems' ? [['maintenance', '维修换件']] : []), ['archive', '注销归档']]) more.append(new Option(label, key));
    more.onchange = () => { if (more.value === 'ip' || more.value === 'rack') openEdit(more.value === 'ip' ? 'network' : 'ownership'); else if (more.value) openOperation(more.value); };
    actions.append(more);
    const definitions = [
      ['basic', '基本信息', kind === 'systems' ? 'workflow' : 'tag', ['name', 'code', 'type', 'status', 'manufacturer', 'vendor', 'model', 'sn', 'box_sn', 'display_sn', 'provider', 'version']],
      ['ownership', '归属与位置', 'map-pin', ['person', 'organization', 'department', 'room', 'deployment', 'deployment_location', 'data_center', 'cabinet_name', 'floor', 'cabinet_row', 'cabinet_col', 'start_u', 'height_u', 'description', 'remark']],
      ['network', '网络与系统', 'network', ['ip', 'physical_ip', 'network', 'mgmt_ip', 'net_type', 'biz_ip', 'business_network_type', 'service_ip', 'network_type', 'network_source', 'ipam', 'port', 'access_url', 'os', 'os_type', 'os_version', 'middleware', 'database_info']],
      ...(kind === 'systems' ? [['hosting', '承载设备', 'server', ['server_name', 'host_linked']]] : [['hardware', '硬件配置', 'cpu', ['cpu_info', 'vcpu', 'memory_mb', 'disk_info']]]),
      ['files', '照片与附件', 'attachment', []], ['history', '运维履历', 'history', []], ['credentials', '凭证引用', 'key', []], ['related', '关联对象', 'link', []]
    ];
    for (const [key, title, icon, keys] of definitions) {
      const card = key === 'files' ? filesPanel(data) : key === 'credentials' ? credentials(data) : section(title, icon, fieldPairs(keys, data));
      card.id = 'record-section-' + key; card.dataset.section = key;
      if (key === 'history') card.append(historyList(data));
      if (['related', 'ownership', 'hosting'].includes(key)) {
        const related = shared.related(kind, id).filter(object => key === 'related' || (key === 'hosting' ? object.type === 'infrastructure' : ['person', 'rack'].includes(object.type)));
        for (const object of related) card.append(button(object.label, () => shared.openObject(object.type, object.id, { source: 'window' }), 'detail-link'));
        if (key === 'related' && !related.length) card.append(node('p', 'dialog-note', '暂无精确关联。'));
      }
      byId('record-body').append(card); addTab(key, title, icon, card, () => selectDetail(key));
    }
    selectDetail(activeSection);
    byId('record-footer').replaceChildren(node('span', 'dialog-note', '数据与工作台共享；关闭资产窗口保留已保存数据，刷新工作台恢复示例。'));
  }
  function footer(save, create = false) {
    const note = node('p', 'dialog-note', '修改仅保留在当前草稿，保存后同步工作台。'); note.setAttribute('role', 'status');
    const cancel = button('取消', () => { if (!allowDiscard()) return; discardDraft(); if (create) requestClose(); else openDetail(); });
    const submit = button(create ? '创建资产' : '保存修改', () => {
      try { committing = true; save(); }
      catch (error) { note.textContent = '未保存：' + error.message; note.className = 'dialog-note error'; }
      finally { committing = false; }
    }, 'primary');
    byId('record-footer').replaceChildren(note, cancel, submit);
    return note;
  }
  function syncPickers(root, draft) {
    const select = root.querySelector('[data-field-key="cabinet_name"] select');
    if (select) {
      const racks = shared.racks.filter(rack => !draft.roomId || String(rack.roomId) === String(draft.roomId));
      select.replaceChildren(new Option('请选择', ''), ...racks.map(rack => new Option(rack.name + ' · ' + (shared.rooms.find(room => room.id === rack.roomId)?.name || '') + ' · ' + rack.total + 'U', rack.id)));
      select.value = draft.cabinetId || '';
    }
    const files = root.querySelector('#window-field-section-files');
    if (files) files.replaceChildren(...filesPanel(draft, true).childNodes);
  }
  function openEdit(target = activeSection) {
    const create = mode === 'create';
    const data = create ? {} : row();
    if (!data) return openDetail();
    mode = create ? 'create' : 'edit'; clearSurface();
    byId('record-title').textContent = (create ? '新增' : '编辑') + config.label;
    byId('record-status').textContent = data.status || '';
    const draft = { ...data, photos: normalizedPhotos(data.photos), attachments: normalizedFiles(data.attachments) };
    const formRoot = node('div', 'dialog-body record-editor');
    // renderForm resolves its owner through closest(), so mount before invoking it.
    byId('record-body').append(formRoot);
    editor = window.assetPrototypeForm.renderForm({ root: formRoot, nav: byId('record-nav'), view: kind, config, values: draft, prefix: 'window-field', mode });
    dirty = false;
    const offlineNote = formRoot.querySelector('.asset-form-offline');
    if (offlineNote) offlineNote.textContent = '共享工作台内存表单：分类切换保留草稿，保存时统一校验人员、地址和机柜位置。';
    formRoot.querySelectorAll('.create-hardware-photos').forEach(item => item.remove());
    const credentialPanel = formRoot.querySelector('[data-section="credentials"]');
    credentialPanel.replaceChildren(credentials(draft));
    const historyPanel = formRoot.querySelector('[data-section="history"]');
    if (historyPanel) historyPanel.replaceChildren(historyList(data));
    for (const key of ['hosting', 'network']) {
      const panel = formRoot.querySelector('[data-section="' + key + '"]');
      if (kind === 'systems') panel?.querySelectorAll(':scope > .dialog-note').forEach(item => item.remove());
    }
    const files = filesPanel(draft, true); files.id = 'window-field-section-files'; files.dataset.section = 'files'; files.hidden = true; formRoot.append(files);
    function selectForm(key) {
      const tabs = [...byId('record-nav').children];
      const selected = tabs.some(tab => tab.dataset.formTab === key) ? key : 'basic';
      if (selected !== 'files') editor.selectSection(selected);
      else for (const panel of formRoot.querySelectorAll(':scope > [data-section]')) panel.hidden = panel !== files;
      files.hidden = selected !== 'files'; activeSection = selected;
      for (const tab of tabs) { tab.setAttribute('aria-selected', String(tab.dataset.formTab === selected)); tab.tabIndex = tab.dataset.formTab === selected ? 0 : -1; }
    }
    addTab('files', '照片与附件', 'attachment', files, () => selectForm('files'));
    for (const tab of byId('record-nav').children) tab.addEventListener('click', () => selectForm(tab.dataset.formTab));
    syncPickers(formRoot, draft);
    formRoot.addEventListener('change', () => { dirty = true; syncPickers(formRoot, draft); });
    formRoot.addEventListener('input', () => { dirty = true; });
    selectForm(target);
    footer(() => {
      const saved = shared.saveAsset(kind, draft, { ...(create ? {} : { id: data.id }), title: create ? '登记资产' : '编辑资产' });
      id = saved.id;
      const retained = new Set(fileURLs(saved));
      for (const url of pendingURLs) if (!retained.has(url)) host.URL.revokeObjectURL(url);
      pendingURLs.clear(); editor = null; dirty = false; openDetail();
    }, create);
  }
  function openOperation(operation) {
    const data = row(); if (!data) return openDetail();
    const titles = { transfer: '调换使用人', maintenance: '维修换件', archive: '注销归档' };
    if (!titles[operation]) return openDetail();
    mode = operation; editor = null; dirty = false; clearSurface();
    byId('record-title').textContent = titles[operation] + ' · ' + data.name;
    byId('record-status').textContent = data.status || '';
    const values = { person_id: data.person_id || '', room: data.room || '' };
    const card = section(titles[operation], operation === 'transfer' ? 'swap' : operation === 'maintenance' ? 'wrench' : 'archive');
    card.id = 'record-operation'; card.dataset.section = operation;
    const form = node('div', 'fields');
    const definitions = operation === 'transfer' ? [{ key: 'person', label: '新使用人（组织目录）' }, { key: 'room', label: '房间 / 位置' }, { key: 'description', label: '交接说明', kind: 'textarea' }]
      : operation === 'maintenance' ? [{ key: 'part', label: '维修部件', kind: 'select', options: /云桌面|云盒|盒子/.test(data.type || '') ? ['终端主机', '显示器', '整机维修排障'] : ['设备', '整机维修排障'] }, { key: 'old_sn', label: '换下件 SN' }, { key: 'new_sn', label: '换上件 SN' }, { key: 'description', label: '维修说明', kind: 'textarea' }]
        : [{ key: 'reason', label: '注销说明', kind: 'textarea', required: true }];
    for (const field of definitions) form.append(window.assetPrototypeForm.createField(field, values, 'operation-' + field.key));
    form.addEventListener('input', () => { dirty = true; }); form.addEventListener('change', () => { dirty = true; });
    card.append(form);
    if (operation === 'archive') card.append(node('p', 'dialog-note', '注销保留资料与履历，并释放 IP 和机柜位置。'));
    byId('record-body').append(card); addTab(operation, titles[operation], operation === 'transfer' ? 'swap' : operation === 'maintenance' ? 'wrench' : 'archive', card, () => {});
    byId('record-nav').firstElementChild.setAttribute('aria-selected', 'true');
    footer(() => {
      const key = kind + ':' + id;
      if (operation === 'transfer') {
        if (!values.person_id) throw Error('请选择新使用人。');
        shared.changeAsset(key, { person_id: values.person_id, room: values.room }, titles[operation], values.description || '');
      } else if (operation === 'maintenance') {
        if (!values.part || !values.description?.trim()) throw Error('请选择维修部件并填写维修说明。');
        const serial = values.part === '显示器' ? 'display_sn' : values.part === '终端主机' ? 'box_sn' : 'sn';
        shared.changeAsset(key, values.new_sn ? { [serial]: values.new_sn } : {}, titles[operation], [values.part, values.old_sn ? '换下 SN：' + values.old_sn : '', values.description].filter(Boolean).join(' · '));
      } else {
        if (!values.reason?.trim()) throw Error('请填写注销说明。');
        shared.archiveAsset(key, values.reason.trim());
      }
      dirty = false; openDetail();
    });
  }
  byId('record-nav').addEventListener('keydown', event => {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = [...byId('record-nav').querySelectorAll('[role="tab"]')];
    const index = tabs.indexOf(document.activeElement); if (index < 0) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next].click(); tabs[next].focus();
  }, true);
  byId('record-close').onclick = requestClose;
  byId('record-back').onclick = () => { if (requestClose()) host.focus(); };
  byId('record-back').hidden = !current.get('source');
  window.addEventListener('beforeunload', event => { if (!closing && hasDraft()) { event.preventDefault(); event.returnValue = ''; } });
  const unsubscribe = shared.subscribe(() => {
    if (committing) return;
    if (mode === 'detail') openDetail();
    else { const note = byId('record-footer').querySelector('[role="status"]'); if (note) note.textContent = '工作台数据已更新，当前草稿仍保留；保存时将按最新状态校验。'; }
  });
  window.addEventListener('unload', () => { unsubscribe(); releaseDraftURLs(); owner._disposeForm?.(); });
  window.workbenchWindow = { close: requestClose, get mode() { return mode; } };
  if (mode === 'create' || mode === 'edit') openEdit(); else if (mode !== 'detail') openOperation(mode); else openDetail();
})();

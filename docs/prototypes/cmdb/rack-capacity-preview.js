(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const grid = $('rack-grid');
  if (!grid) return;
  const panel = document.querySelector('#rack-content .editor-panel');
  const rackPanel = document.querySelector('#rack-content .rack-panel');
  const toolbar = $('rack-toolbar');
  const rooms = [{ id: 'room-core', name: '核心机房' }, { id: 'room-backup', name: '备份机房' }];
  const cabinets = [
    { id: 'cab-a01', roomId: 'room-core', name: 'A01', total: 42 },
    { id: 'cab-a02', roomId: 'room-core', name: 'A02', total: 42 },
    { id: 'cab-a03', roomId: 'room-core', name: 'A03', total: 42 },
    { id: 'cab-backup-a01', roomId: 'room-backup', name: 'A01', total: 42 },
  ];
  const devices = [
    { id: 'hci-01', name: '虚拟化服务器 HCI-01', code: 'SRV-HCI-01', type: '服务器', vendor: '示例厂商', model: '示例型号', start: 39, height: 4 },
    { id: 'san-01', name: '存储设备 SAN-01', code: 'STO-SAN-01', type: '存储设备', vendor: '示例厂商', model: '示例型号', start: 34, height: 4 },
    { id: 'sw-001', name: '汇聚交换机 SW-001', code: 'NET-SW-001', type: '交换机', vendor: 'H3C', model: '示例型号', start: 28, height: 2 },
    { id: 'sw-002', name: '接入交换机 SW-002', code: 'NET-SW-002', type: '交换机', vendor: 'H3C', model: '示例型号', start: 24, height: 2 },
  ].map((device) => ({ ...device, roomId: 'room-core', cabinetId: 'cab-a01', photos: { front: true, back: false } }));
  devices.push(
    { id: 'unplaced-a', name: '待上架设备 A', code: 'PREVIEW-A', type: '服务器', vendor: '示例厂商', model: '', height: 1, start: null, roomId: null, cabinetId: null, photos: { front: false, back: false } },
    { id: 'unplaced-b', name: '待上架设备 B', code: 'PREVIEW-B', type: '交换机', vendor: 'H3C', model: '', height: 2, start: null, roomId: null, cabinetId: null, photos: { front: false, back: false } },
  );
  let sequence = 0;
  let activeRoomId = rooms[0].id;
  let activeCabinetId = cabinets[0].id;
  let selectedId = 'sw-001';
  let draft = null;
  let dirty = false;
  let searchTerm = '';
  let managerMode = 'cabinet-edit';
  let managerRoomId = activeRoomId;
  let managerCabinetId = activeCabinetId;
  let managerActiveRoomId = activeRoomId;
  let managerActiveCabinetId = activeCabinetId;
  let pendingUnit = null;
  const fields = {
    name: $('device-name'), code: $('asset-code'), type: $('device-type'), vendor: $('vendor'), model: $('model'),
    roomId: $('device-room'), cabinetId: $('device-cabinet'), start: $('start-u'), height: $('height-u'),
  };
  const editorTitle = panel.querySelector('.editor-head h2');
  const editorCaption = panel.querySelector('.editor-head .caption');
  const footer = panel.querySelector('.editor-footer');
  const [unmountButton, resetButton, saveButton] = footer.querySelectorAll('button');
  saveButton.textContent = '保存设备（预览）';
  resetButton.textContent = '重置 / 放弃草稿';
  const status = document.createElement('p');
  status.id = 'rack-feedback';
  status.className = 'rack-feedback';
  status.setAttribute('role', 'status');
  rackPanel.querySelector('.usage').after(status);
  const editorError = document.createElement('p');
  editorError.className = 'rack-editor-error';
  editorError.setAttribute('role', 'alert');
  editorError.hidden = true;
  panel.querySelector('.editor-body').prepend(editorError);
  const emptyEditor = document.createElement('p');
  emptyEditor.className = 'rack-empty-editor';
  panel.querySelector('.editor-body').prepend(emptyEditor);
  const searchResults = document.createElement('div');
  searchResults.className = 'rack-search-results';
  searchResults.hidden = true;
  status.after(searchResults);
  const cloneDevice = (device) => ({ ...device, photos: { ...device.photos }, placed: Boolean(device.cabinetId), isNew: false });
  const roomById = (id) => rooms.find((room) => room.id === id);
  const cabinetById = (id) => cabinets.find((cabinet) => cabinet.id === id);
  const deviceById = (id) => devices.find((device) => device.id === id);
  const placedIn = (id) => id ? devices.filter((device) => device.cabinetId === id) : [];
  const notify = (text) => { status.textContent = text; };
  const error = (text) => { editorError.textContent = text; editorError.hidden = !text; };
  function button(text, action, className = '') {
    const node = document.createElement('button');
    node.type = 'button';
    node.textContent = text;
    node.className = className;
    node.addEventListener('click', action);
    return node;
  }
  function options(select, items, value, placeholder) {
    select.replaceChildren();
    if (placeholder) select.add(new Option(placeholder, ''));
    for (const item of items) select.add(new Option(item.name, item.id));
    select.value = value || '';
  }
  function choiceOptions(select, values, value) {
    const choices = [...new Set([...values, value].filter(Boolean))];
    select.replaceChildren(...choices.map((name) => new Option(name, name)));
    select.value = value || choices[0] || '';
  }
  function canDiscard() {
    return !(dirty || draft?.isNew) || window.confirm('当前设备有未保存的草稿。放弃这些修改？已保存的设备不会改变。');
  }
  function placementError(candidate) {
    if (!candidate.placed && !candidate.cabinetId) return '';
    const cabinet = cabinetById(candidate.cabinetId);
    if (!cabinet || cabinet.roomId !== candidate.roomId) return '请选择有效的机房与机柜。';
    if (!Number.isInteger(candidate.start) || !Number.isInteger(candidate.height) || candidate.start < 1 || candidate.height < 1) return '起始 U 位与占用 U 数必须为正整数。';
    const end = candidate.start + candidate.height - 1;
    if (end > cabinet.total) return `范围 ${candidate.start}–${end}U 超出 ${cabinet.total}U 机柜。`;
    const overlap = placedIn(cabinet.id).find((device) => device.id !== candidate.id && candidate.start <= device.start + device.height - 1 && end >= device.start);
    return overlap ? `位置冲突：${overlap.name} 已占用 ${overlap.start}–${overlap.start + overlap.height - 1}U。` : '';
  }
  function readDraft() {
    if (!draft) return;
    for (const key of ['name', 'code', 'type', 'vendor', 'model']) draft[key] = fields[key].value.trim();
    draft.height = Number(fields.height.value);
    if (draft.placed) {
      draft.roomId = fields.roomId.value;
      draft.cabinetId = fields.cabinetId.value;
      draft.start = Number(fields.start.value);
    }
  }
  function updatePositionHint() {
    const summary = $('rack-position-summary');
    const indicator = panel.querySelector('.position-hint strong');
    if (!draft) { summary.textContent = '选择设备或点击空 U 位开始'; indicator.textContent = ''; return; }
    if (!draft.placed) { summary.textContent = '未上架 · 点击空 U 位可安排上架'; indicator.textContent = '未分配位置'; return; }
    const cabinet = cabinetById(draft.cabinetId);
    summary.textContent = `范围 ${draft.start || '?'}–${draft.start + draft.height - 1 || '?'}U / 共 ${cabinet?.total || '?'}U`;
    const issue = placementError(draft);
    indicator.textContent = issue ? '位置不可用（不会保存）' : '位置可用 · 待保存';
    indicator.classList.toggle('rack-invalid', Boolean(issue));
  }
  function renderPhotos() {
    const photos = panel.querySelectorAll('.hardware-photos > .photo');
    photos.forEach((photo, index) => {
      const side = index ? 'back' : 'front';
      const present = Boolean(draft?.photos?.[side]);
      photo.classList.toggle('rack-photo-present', present);
      photo.classList.toggle('rack-photo-missing', !present);
      photo.querySelector('.photo-label').textContent = `${index ? '背面' : '正面'} · ${present ? '本地示意图（非真实照片）' : '未设置示意图'}`;
      const last = photo.querySelector('span:not(.photo-label):not(.light)');
      if (index && last) last.textContent = present ? '背面硬件示意 · 非真实照片' : '未设置示意图';
    });
  }
  function fillEditor() {
    error('');
    const exists = Boolean(draft);
    emptyEditor.hidden = exists;
    const cabinet = cabinetById(activeCabinetId);
    emptyEditor.textContent = cabinet ? `${cabinet.name} ${placedIn(cabinet.id).length ? '尚未选择设备' : '是空机柜'}。点击左侧任意空 U 位，可新增设备或上架已有设备。` : '当前机房尚无机柜。请在管理区新建空机柜。';
    editorTitle.textContent = draft ? draft.name || '新增设备草稿' : '未选择设备';
    editorCaption.textContent = draft ? (draft.isNew ? '草稿 · 尚未保存，不占用机柜 U 位' : draft.staged ? '上架草稿 · 确认保存后才占用 U 位' : draft.placed ? `当前选中 · ${draft.start}–${draft.start + draft.height - 1}U · ${draft.height}U` : '未上架设备 · 不占用机柜 U 位') : '空 U 位仍可操作 · 本页内存预览';
    for (const [key, field] of Object.entries(fields)) {
      field.removeAttribute('readonly');
      field.disabled = !exists;
      if (!['roomId', 'cabinetId', 'type', 'vendor'].includes(key)) field.value = draft?.[key] ?? '';
    }
    choiceOptions(fields.type, ['交换机', '服务器', '存储设备', '路由器', '防火墙', '其他'], draft?.type);
    choiceOptions(fields.vendor, ['未指定', 'H3C', 'Huawei', 'Cisco', 'Dell', '示例厂商'], draft?.vendor);
    options(fields.roomId, rooms, draft?.roomId || activeRoomId);
    const formRoom = fields.roomId.value;
    options(fields.cabinetId, cabinets.filter((item) => item.roomId === formRoom), draft?.cabinetId || activeCabinetId, '请选择机柜');
    for (const key of ['roomId', 'cabinetId', 'start']) fields[key].disabled = !draft?.placed;
    saveButton.disabled = resetButton.disabled = !exists;
    unmountButton.disabled = !exists || draft.isNew || !deviceById(draft.id)?.cabinetId;
    panel.querySelector('.editor-head button').disabled = !exists || draft.isNew;
    panel.querySelector('.image-actions button').disabled = !exists;
    updatePositionHint();
    renderPhotos();
  }
  function scrollSelected() {
    const node = grid.querySelector('.device.selected');
    if (node) node.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }
  function renderSelectors() {
    for (const [className, text, items, value, change] of [
      ['room', '机房', rooms, activeRoomId, (id) => navigate(id, cabinets.find((item) => item.roomId === id)?.id || null)],
      ['cabinet', '机柜', cabinets.filter((item) => item.roomId === activeRoomId), activeCabinetId, (id) => navigate(activeRoomId, id)],
    ]) {
      const details = toolbar.querySelector(`.${className}`);
      const summary = details.querySelector('summary');
      summary.textContent = `${text} · ${items.find((item) => item.id === value)?.name || '暂无机柜'} ⌄`;
      const menu = details.querySelector('.menu');
      menu.replaceChildren();
      for (const item of items) {
        const option = button(`${item.id === value ? '✓ ' : ''}${item.name}`, () => { if (change(item.id) !== false) details.open = false; });
        option.setAttribute('aria-current', String(item.id === value));
        menu.append(option);
      }
      if (!items.length) { const note = document.createElement('small'); note.textContent = '暂无机柜，请在管理区新建'; menu.append(note); }
    }
  }
  function renderFold() {
    const fold = rackPanel.querySelector('.fold');
    const unplaced = devices.filter((device) => !device.cabinetId);
    const conflicts = devices.filter((device) => device.cabinetId && placementError(device));
    fold.querySelector('summary').textContent = `▸ 未上架 ${unplaced.length} / 冲突 ${conflicts.length} · 查看设备`;
    const body = fold.querySelector('.fold-body');
    body.replaceChildren();
    for (const device of unplaced) body.append(button(`${device.name} · ${device.height}U`, () => selectDevice(device.id), 'pill'));
    for (const device of conflicts) body.append(button(`${device.name} · ${placementError(device)}`, () => selectDevice(device.id), 'pill warning'));
    if (!unplaced.length && !conflicts.length) body.textContent = '所有设备均已正常上架。';
  }
  function renderSearch() {
    searchResults.replaceChildren();
    searchResults.hidden = !searchTerm;
    if (!searchTerm) return;
    const matches = devices.filter((device) => `${device.name} ${device.code} ${device.model} ${roomById(device.roomId)?.name || ''} ${cabinetById(device.cabinetId)?.name || ''}`.toLowerCase().includes(searchTerm));
    const heading = document.createElement('span');
    heading.textContent = `匹配 ${matches.length} 台：`;
    searchResults.append(heading);
    for (const device of matches) searchResults.append(button(`${device.name} · ${cabinetById(device.cabinetId)?.name || '未上架'}`, () => selectDevice(device.id)));
  }
  function renderRack() {
    renderSelectors();
    const cabinet = cabinetById(activeCabinetId);
    grid.replaceChildren();
    rackPanel.querySelector('h1').textContent = cabinet ? `${cabinet.name} 机柜` : `${roomById(activeRoomId)?.name || '机房'} · 暂无机柜`;
    $('rack-units-edit').disabled = !cabinet;
    $('rack-total-units').textContent = cabinet ? `${cabinet.total}U` : '—';
    if (!cabinet) {
      grid.style.gridTemplateRows = 'auto';
      const note = document.createElement('p');
      note.className = 'rack-empty-grid';
      note.textContent = '此机房尚无机柜。请在管理区新建空机柜。';
      grid.append(note);
      $('rack-capacity-summary').textContent = '暂无机柜 · 不包含任何设备';
      rackPanel.querySelector('.usage > span').style.width = '0%';
    } else {
      const placed = placedIn(cabinet.id);
      const used = placed.reduce((sum, device) => sum + device.height, 0);
      grid.style.gridTemplateRows = `repeat(${cabinet.total}, 24px)`;
      grid.setAttribute('aria-label', `${roomById(cabinet.roomId).name} ${cabinet.name} · ${cabinet.total}U 机柜预览`);
      for (let unit = cabinet.total; unit >= 1; unit--) {
        const occupying = placed.find((device) => unit >= device.start && unit < device.start + device.height);
        const label = button(String(unit), () => occupying ? selectDevice(occupying.id) : openUnit(unit), 'u-label');
        label.setAttribute('aria-label', `${unit}U · ${occupying ? occupying.name : '空闲，可新增或上架设备'}`);
        label.style.gridRow = cabinet.total + 1 - unit;
        label.style.gridColumn = 1;
        const slot = button('', () => occupying ? selectDevice(occupying.id) : openUnit(unit), 'slot');
        slot.setAttribute('aria-label', `${cabinet.name} 的 ${unit}U · ${occupying ? occupying.name : '空闲'}`);
        slot.style.gridRow = cabinet.total + 1 - unit;
        slot.style.gridColumn = 2;
        if (occupying) slot.tabIndex = -1;
        grid.append(label, slot);
      }
      for (const device of placed) {
        const node = button('', () => selectDevice(device.id), `device${device.id === selectedId ? ' selected' : ''}`);
        node.dataset.deviceId = device.id;
        node.setAttribute('aria-pressed', String(device.id === selectedId));
        node.style.gridRow = `${cabinet.total + 1 - (device.start + device.height - 1)}/span ${device.height}`;
        node.title = `${device.name} · ${device.start}–${device.start + device.height - 1}U`;
        const text = document.createElement('div');
        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = `${device.height}U ${device.name}`;
        const meta = document.createElement('span');
        meta.className = 'meta';
        meta.textContent = device.model || '未填写型号';
        text.append(name, meta);
        node.append(text);
        grid.append(node);
      }
      $('rack-capacity-summary').textContent = `已用 ${used}U · 空闲 ${cabinet.total - used}U · 已上架 ${placed.length} 台${placed.length ? '' : ' · 空机柜，点击 U 位开始'}`;
      rackPanel.querySelector('.usage > span').style.width = `${used / cabinet.total * 100}%`;
    }
    renderFold();
    renderSearch();
    syncManagerSelection();
  }
  function navigate(roomId, cabinetId, deviceId = null, guard = true) {
    if (guard && !canDiscard()) return false;
    activeRoomId = roomId;
    activeCabinetId = cabinetId;
    selectedId = deviceId || placedIn(cabinetId).at(0)?.id || null;
    draft = selectedId ? cloneDevice(deviceById(selectedId)) : null;
    dirty = false;
    renderRack();
    fillEditor();
    scrollSelected();
    return true;
  }
  function selectDevice(id) {
    const device = deviceById(id);
    if (!device || !canDiscard()) return false;
    if (device.cabinetId) return navigate(device.roomId, device.cabinetId, id, false);
    selectedId = id;
    draft = cloneDevice(device);
    dirty = false;
    renderRack();
    fillEditor();
    return true;
  }
  function makeDialog(id, title, body, footerMarkup = '') {
    const dialog = document.createElement('dialog');
    dialog.id = id;
    dialog.className = 'rack-prototype-dialog record-shell record-dialog';
    dialog.setAttribute('aria-labelledby', `${id}-title`);
    dialog.innerHTML = `<header class="dialog-header record-header"><h2 id="${id}-title"></h2><button type="button" class="icon quiet" aria-label="关闭">×</button></header>${body}${footerMarkup}`;
    dialog.querySelector('h2').textContent = title;
    dialog.querySelector('.dialog-body')?.classList.add('record-body');
    dialog.querySelector('.dialog-footer')?.classList.add('record-footer');
    dialog.querySelector('.dialog-header button').addEventListener('click', () => dialog.close());
    document.body.append(dialog);
    return dialog;
  }
  const unitDialog = makeDialog('rack-unit-actions', '空 U 位操作', '<div class="dialog-body"><p class="dialog-note">仅在本页预览中编辑，保存前不改变机柜占用。</p><div class="rack-unit-actions"></div><label class="field rack-mount-choice">选择未上架设备<select id="rack-mount-device"></select></label><p id="rack-unit-feedback" role="status"></p></div>');
  const newDeviceButton = button('新增设备', () => stageDevice(null), 'primary');
  const mountDeviceButton = button('上架已有设备', () => stageDevice($('rack-mount-device').value));
  unitDialog.querySelector('.rack-unit-actions').append(newDeviceButton, mountDeviceButton);
  function openUnit(unit) {
    const cabinet = cabinetById(activeCabinetId);
    if (!cabinet) return;
    pendingUnit = unit;
    $('rack-unit-actions-title').textContent = `在 ${cabinet.name} 的 ${unit}U`;
    const available = devices.filter((device) => !device.cabinetId);
    options($('rack-mount-device'), available, available[0]?.id, available.length ? null : '暂无未上架设备');
    mountDeviceButton.disabled = !available.length;
    $('rack-unit-feedback').textContent = '新增设备将打开空白草稿；上架已有设备将预填位置，均须在右侧保存后确认。';
    unitDialog.showModal();
  }
  function stageDevice(id) {
    if (!canDiscard()) return;
    const existing = id ? deviceById(id) : null;
    if (id && (!existing || existing.cabinetId)) { $('rack-unit-feedback').textContent = '请选择未上架设备。'; return; }
    draft = existing ? cloneDevice(existing) : { id: null, name: '', code: '', type: '交换机', vendor: '未指定', model: '', height: 1, photos: { front: false, back: false }, isNew: true };
    draft.roomId = activeRoomId;
    draft.cabinetId = activeCabinetId;
    draft.start = pendingUnit;
    draft.placed = true;
    draft.staged = true;
    selectedId = existing?.id || null;
    dirty = true;
    unitDialog.close();
    renderRack();
    fillEditor();
    notify('已打开设备草稿；点击「保存设备（预览）」才会提交到本页内存。');
    fields.name.focus();
  }
  for (const field of [fields.start, fields.height]) {
    field.type = 'number'; field.min = '1'; field.max = '60'; field.step = '1';
  }
  fields.name.required = true;
  for (const [key, field] of Object.entries(fields)) {
    field.addEventListener('input', () => {
      if (!draft) return;
      if (key === 'roomId') {
        options(fields.cabinetId, cabinets.filter((cabinet) => cabinet.roomId === fields.roomId.value), '', '请选择机柜');
      }
      dirty = true;
      readDraft();
      editorCaption.textContent = draft.isNew ? '新增设备草稿 · 尚未保存' : '设备修改草稿 · 尚未保存';
      error('');
      updatePositionHint();
    });
  }
  saveButton.addEventListener('click', () => {
    readDraft();
    if (!draft) return;
    if (!draft.name) { error('请填写设备名称。'); fields.name.focus(); return; }
    if (!Number.isInteger(draft.height) || draft.height < 1 || draft.height > 60) { error('占用 U 数必须为 1–60 的整数。'); return; }
    const issue = placementError(draft);
    if (issue) { error(issue); return; }
    const saved = { ...draft, id: draft.id || `local-device-${++sequence}`, photos: { ...draft.photos } };
    delete saved.isNew; delete saved.staged; delete saved.placed;
    if (!draft.placed) { saved.start = null; saved.roomId = null; saved.cabinetId = null; }
    const index = devices.findIndex((device) => device.id === saved.id);
    if (index < 0) devices.push(saved); else devices[index] = saved;
    dirty = false;
    draft = cloneDevice(saved);
    selectedId = saved.id;
    if (saved.cabinetId) { activeRoomId = saved.roomId; activeCabinetId = saved.cabinetId; }
    renderRack(); fillEditor(); scrollSelected();
    notify(`已保存「${saved.name}」到本页预览内存；刷新后恢复示例，不写入业务数据。`);
  });
  resetButton.addEventListener('click', () => {
    if (!canDiscard()) return;
    const selected = deviceById(selectedId);
    draft = selected ? cloneDevice(selected) : null;
    dirty = false;
    renderRack(); fillEditor();
    notify('已放弃未保存的设备修改。');
  });
  unmountButton.addEventListener('click', () => {
    const device = deviceById(selectedId);
    if (!device?.cabinetId || !canDiscard() || !window.confirm(`将「${device.name}」下架到未上架设备？仅影响本页预览。`)) return;
    device.roomId = null; device.cabinetId = null; device.start = null;
    draft = cloneDevice(device); dirty = false;
    renderRack(); fillEditor();
    notify('设备已下架，仍保留在「未上架」列表，可点击空 U 位再次上架。');
  });
  const manager = document.createElement('section');
  manager.id = 'rack-manager';
  manager.className = 'record-shell record-inline';
  manager.setAttribute('aria-labelledby', 'rack-manager-title');
  manager.innerHTML = `
    <header class="rack-manager-head record-header"><h2 id="rack-manager-title">机房 / 机柜管理</h2><div class="rack-management-actions"></div></header>
    <div class="rack-manager-body record-body">
      <nav class="rack-directory" aria-label="机房与机柜目录"></nav>
      <form id="rack-management-form" class="rack-management-form record-section">
        <h3 id="rack-management-title" class="section-title"></h3>
        <div class="record-fields fields">
        <div class="field full"><label for="rack-management-room">所属机房</label><select id="rack-management-room"></select></div>
        <div class="field full"><label for="rack-management-name">名称</label><input id="rack-management-name" required maxlength="80"></div>
        <div id="rack-management-capacity" class="field full"><label for="rack-management-number">机柜总 U 数（1–60）</label><div class="rack-capacity-controls"><input id="rack-management-range" type="range" min="1" max="60" step="1" value="42" aria-label="机柜总 U 数滑块"><input id="rack-management-number" type="number" min="1" max="60" step="1" required value="42" aria-label="机柜总 U 数"></div></div>
        </div>
        <p class="dialog-note">机柜容量不是设备高度。新建机柜始终为空；修改总 U 数会保留当前设备，且不能小于最高占用 U 位。同名机柜按所属机房隔离。</p>
        <p id="rack-management-error" class="rack-editor-error" role="alert" hidden></p>
        <button type="submit" class="primary" id="rack-management-save">保存到预览</button>
        <p id="rack-management-status" class="dialog-note" role="status"></p>
        <p class="dialog-note">所有操作仅保存在本页内存；不连接业务服务，刷新后恢复示例。</p>
      </form>
    </div>`;
  panel.after(manager);
  function renderDirectory() {
    const directory = manager.querySelector('.rack-directory');
    directory.replaceChildren();
    for (const room of rooms) {
      const group = document.createElement('section');
      group.append(button(room.name, () => {
        managerRoomId = room.id;
        managerCabinetId = cabinets.find((cabinet) => cabinet.roomId === room.id)?.id || null;
        managerMode = managerCabinetId ? 'cabinet-edit' : 'cabinet-new';
        renderManager();
      }, `rack-directory-room${room.id === managerRoomId ? ' selected' : ''}`));
      for (const cabinet of cabinets.filter((item) => item.roomId === room.id)) {
        group.append(button(`${cabinet.name} · ${cabinet.total}U · ${placedIn(cabinet.id).length} 台`, () => {
          managerRoomId = room.id; managerCabinetId = cabinet.id; managerMode = 'cabinet-edit'; renderManager();
        }, `rack-directory-cabinet${cabinet.id === managerCabinetId ? ' selected' : ''}`));
      }
      if (!cabinets.some((cabinet) => cabinet.roomId === room.id)) { const note = document.createElement('small'); note.textContent = '暂无机柜'; group.append(note); }
      directory.append(group);
    }
  }
  function renderManager() {
    renderDirectory();
    const cabinet = cabinetById(managerCabinetId);
    const roomNew = managerMode === 'room-new';
    const editing = managerMode === 'cabinet-edit' && cabinet;
    options($('rack-management-room'), rooms, managerRoomId);
    $('rack-management-room').closest('.field').hidden = roomNew;
    $('rack-management-room').disabled = roomNew;
    $('rack-management-title').textContent = roomNew ? '新建机房' : editing ? `编辑选中机柜 · ${cabinet.name}` : '新建空机柜';
    $('rack-management-name').value = editing ? cabinet.name : '';
    $('rack-management-name').placeholder = roomNew ? '例如：测试机房' : '例如：A-88';
    $('rack-management-capacity').hidden = roomNew;
    $('rack-management-number').disabled = $('rack-management-range').disabled = roomNew;
    $('rack-management-number').value = $('rack-management-range').value = editing ? cabinet.total : 42;
    $('rack-management-error').hidden = true;
    $('rack-management-status').textContent = '';
    $('rack-management-save').textContent = roomNew ? '新建机房（预览）' : editing ? '保存机柜（预览）' : '创建空机柜（预览）';
  }
  manager.querySelector('.rack-management-actions').append(
    button('新建机房', () => { managerMode = 'room-new'; renderManager(); }, 'primary'),
    button('新建机柜', () => { managerMode = 'cabinet-new'; renderManager(); }, 'primary'),
    button('编辑选中机柜', () => {
      if (!managerCabinetId) { $('rack-management-error').hidden = false; $('rack-management-error').textContent = '请先在目录中选择一个机柜。'; return; }
      managerMode = 'cabinet-edit'; renderManager();
    }),
  );
  function focusManager() {
    if (managerRoomId !== activeRoomId || managerCabinetId !== activeCabinetId || managerMode !== 'cabinet-edit') {
      managerRoomId = activeRoomId;
      managerCabinetId = activeCabinetId;
      managerMode = activeCabinetId ? 'cabinet-edit' : 'cabinet-new';
      renderManager();
    }
    const target = activeCabinetId ? $('rack-management-number') : $('rack-management-name');
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  function syncManagerSelection() {
    if (managerActiveRoomId === activeRoomId && managerActiveCabinetId === activeCabinetId) { renderDirectory(); return; }
    managerActiveRoomId = activeRoomId;
    managerActiveCabinetId = activeCabinetId;
    managerRoomId = activeRoomId;
    managerCabinetId = activeCabinetId;
    managerMode = activeCabinetId ? 'cabinet-edit' : 'cabinet-new';
    renderManager();
  }
  $('rack-management-range').addEventListener('input', () => { $('rack-management-number').value = $('rack-management-range').value; });
  $('rack-management-number').addEventListener('input', () => {
    if ($('rack-management-number').validity.valid) $('rack-management-range').value = $('rack-management-number').value;
  });
  $('rack-management-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const fail = (text) => { $('rack-management-error').textContent = text; $('rack-management-error').hidden = false; };
    const name = $('rack-management-name').value.trim();
    if (!name) { fail('名称不能为空。'); return; }
    if (!canDiscard()) return;
    if (managerMode === 'room-new') {
      if (rooms.some((room) => room.name === name)) { fail('已存在同名机房。'); return; }
      const room = { id: `local-room-${++sequence}`, name };
      rooms.push(room);
      navigate(room.id, null, null, false);
      $('rack-management-name').focus({ preventScroll: true });
      $('rack-management-status').textContent = `已创建机房「${name}」，可继续新建空机柜。`;
      notify(`已创建机房「${name}」，尚无机柜；可在右侧继续新建空机柜。`);
      return;
    }
    const roomId = $('rack-management-room').value;
    const total = Number($('rack-management-number').value);
    if (!roomById(roomId)) { fail('请选择有效机房。'); return; }
    if (!Number.isInteger(total) || total < 1 || total > 60) { fail('机柜总 U 数必须为 1–60 的整数。'); return; }
    const editing = managerMode === 'cabinet-edit' ? cabinetById(managerCabinetId) : null;
    if (cabinets.some((cabinet) => cabinet.roomId === roomId && cabinet.name === name && cabinet.id !== editing?.id)) { fail('当前机房已存在同名机柜；不同机房可以使用相同名称。'); return; }
    if (editing) {
      const occupied = placedIn(editing.id);
      const highest = Math.max(0, ...occupied.map((device) => device.start + device.height - 1));
      if (total < highest) { fail(`当前设备最高占用 ${highest}U，不能缩小到 ${total}U。设备位置保持不变。`); return; }
      Object.assign(editing, { name, roomId, total });
      for (const device of occupied) device.roomId = roomId;
      navigate(roomId, editing.id, null, false);
    } else {
      const cabinet = { id: `local-cabinet-${++sequence}`, roomId, name, total };
      cabinets.push(cabinet);
      navigate(roomId, cabinet.id, null, false);
    }
    managerRoomId = activeRoomId;
    managerCabinetId = activeCabinetId;
    managerMode = 'cabinet-edit';
    renderManager();
    $('rack-management-status').textContent = `已${editing ? '修改' : '创建空'}机柜「${name}」· ${total}U。`;
    notify(`已${editing ? '修改' : '创建空'}机柜「${name}」· ${total}U，仅保存在本页预览。`);
  });
  $('rack-units-edit').addEventListener('click', focusManager);
  const searchInput = toolbar.querySelector('.search input');
  searchInput.addEventListener('input', () => { searchTerm = searchInput.value.trim().toLowerCase(); renderSearch(); });
  const detailDialog = makeDialog('rack-device-info', '设备详情（预览）', '<div class="dialog-body"><p id="rack-device-info-content"></p><p class="dialog-note">仅展示本页已保存的原型设备，无接口、SSH 或真实采集。</p></div>');
  panel.querySelector('.editor-head button').addEventListener('click', () => {
    const device = deviceById(selectedId);
    if (!device) return;
    const cabinet = cabinetById(device.cabinetId);
    $('rack-device-info-content').textContent = `${device.name} · ${device.code || '无资产编号'} · ${device.type} · ${device.model || '未填写型号'} · ${cabinet ? `${roomById(cabinet.roomId).name} / ${cabinet.name} / ${device.start}–${device.start + device.height - 1}U` : '未上架'}`;
    detailDialog.showModal();
  });
  const photoDialog = makeDialog('rack-photo-editor', '设备照片示意（本地预览）', '<div class="dialog-body"><p class="dialog-note">不上传、不读取本地文件，不连接真实设备。以下只设置正反面示意图；仍需保存设备才会提交本页修改。</p><div class="rack-photo-actions"></div></div>');
  function updatePhotoActions() {
    const actions = photoDialog.querySelector('.rack-photo-actions');
    actions.replaceChildren();
    for (const [side, text] of [['front', '正面'], ['back', '背面']]) {
      actions.append(button(`${draft.photos[side] ? '移除' : '设置'}${text}示意图`, () => {
        draft.photos[side] = !draft.photos[side]; dirty = true; renderPhotos(); updatePhotoActions();
        editorCaption.textContent = '照片示意草稿 · 保存设备后生效';
      }));
    }
  }
  panel.querySelector('.image-actions button').addEventListener('click', () => {
    if (!draft) return;
    updatePhotoActions(); photoDialog.showModal();
  });
  function selectFromQuery(query, allowSnapshot = false) {
    const requestedRoom = query.room ? rooms.find((room) => room.name === query.room || room.id === query.room) : roomById(activeRoomId);
    const requestedCabinet = requestedRoom && (query.cabinet ? cabinets.find((cabinet) => cabinet.roomId === requestedRoom.id && (cabinet.name === query.cabinet || cabinet.id === query.cabinet)) : cabinetById(activeCabinetId));
    const device = devices.find((item) => ((!query.device && !query.name) || [item.id, item.name, item.code].includes(query.device) || (query.name && item.name === query.name) || (query.code && item.code === query.code)) && (!query.room || item.roomId === requestedRoom?.id) && (!query.cabinet || item.cabinetId === requestedCabinet?.id));
    if (device && (query.device || query.name)) return selectDevice(device.id);
    if (allowSnapshot && query.name && query.room && query.cabinet) {
      const start = Number(query.start);
      const height = Number(query.height);
      if (!Number.isInteger(start) || !Number.isInteger(height) || start < 1 || height < 1 || start + height - 1 > 60) {
        notify('链接中的原型设备位置无效（要求整数且在 1–60U 内）；未创建或强制覆盖设备。'); return false;
      }
      let room = requestedRoom;
      if (!room) { room = { id: `snapshot-room-${++sequence}`, name: query.room }; rooms.push(room); }
      let cabinet = cabinets.find((item) => item.roomId === room.id && item.name === query.cabinet);
      if (!cabinet) { cabinet = { id: `snapshot-cabinet-${++sequence}`, roomId: room.id, name: query.cabinet, total: Math.max(42, start + height - 1) }; cabinets.push(cabinet); }
      const snapshot = { id: query.device && !deviceById(query.device) ? query.device : `snapshot-device-${++sequence}`, name: query.name, code: query.code || '', type: '其他', vendor: '未指定', model: '资产原型传入示例', roomId: room.id, cabinetId: cabinet.id, start, height, photos: { front: false, back: false } };
      const issue = placementError(snapshot);
      if (issue) { notify(`未导入链接中的原型快照：${issue}`); return false; }
      devices.push(snapshot);
      navigate(room.id, cabinet.id, snapshot.id, false);
      notify('已定位资产原型传入的本地示例快照；并非真实资产查询或采集，刷新即恢复。');
      return true;
    }
    if (requestedRoom && (!query.cabinet || requestedCabinet)) {
      const result = navigate(requestedRoom.id, requestedCabinet?.id || cabinets.find((item) => item.roomId === requestedRoom.id)?.id || null);
      if (query.device || query.name) notify('未找到匹配的本地原型设备；链接需提供 name/start/height 才能导入示例快照。');
      return result && !(query.device || query.name);
    }
    notify('没有匹配的本地机房 / 机柜；不会查询真实业务数据。');
    return false;
  }
  const snapshots = (items) => Object.freeze(items.map((item) => Object.freeze({ ...item, ...(item.photos ? { photos: Object.freeze({ ...item.photos }) } : {}) })));
  Object.defineProperty(window, 'rackPrototype', { value: Object.freeze({
    select: (query) => selectFromQuery(query),
    highlight: (query) => selectFromQuery(query),
    focusManager,
    get devices() { return snapshots(devices); },
    get rooms() { return snapshots(rooms); },
    get cabinets() { return snapshots(cabinets); },
    get selection() { return Object.freeze({ room: activeRoomId, cabinet: activeCabinetId, device: selectedId }); },
  }), writable: false, configurable: false });
  draft = cloneDevice(deviceById(selectedId));
  renderManager();
  renderRack(); fillEditor();
  requestAnimationFrame(scrollSelected);
  notify('离线交互原型 · 修改只保存在本页内存，刷新恢复；不连接业务服务。');
  const query = Object.fromEntries(new URLSearchParams(location.search));
  if (query.room || query.cabinet || query.device || query.name) selectFromQuery(query, true);
})();

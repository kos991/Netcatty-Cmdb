(() => {
  'use strict';

  const viewIcons = { terminal: 'monitor', infrastructure: 'server', systems: 'workflow' };
  const formSections = {
    terminal: [['basic', '基本信息', 'cpu'], ['ownership', '归属位置', 'map-pin'], ['network', '网络系统', 'network'], ['hardware', '硬件配置', 'server']],
    infrastructure: [['basic', '基本信息', 'cpu'], ['ownership', '归属位置', 'map-pin'], ['hardware', '硬件配置', 'server'], ['network', '网络配置', 'network']],
    systems: [['basic', '基本信息', 'workflow'], ['ownership', '归属部署', 'map-pin'], ['network', '网络访问', 'network'], ['hosting', '承载设备', 'server']],
  };
  const ownershipKeys = new Set(['organization', 'department', 'person', 'room', 'location', 'data_center', 'cabinet_name', 'floor', 'cabinet_row', 'cabinet_col', 'start_u', 'height_u', 'deployment', 'deployment_location']);
  const hardwareKeys = new Set(['cpu_info', 'memory_mb', 'disk_info', 'vcpu', 'vCPU']);
  const networkKeys = new Set(['ip', 'physical_ip', 'network', 'os', 'os_type', 'os_version', 'mgmt_ip', 'net_type', 'biz_ip', 'business_network_type', 'service_ip', 'network_type', 'network_source', 'ipam', 'port', 'access_url', 'middleware', 'database_info']);
  const fullField = (field) => field.kind === 'textarea' || /(?:name|code|sn|model|url|organization|department|person|room|location|data_center|cabinet_name|middleware|database_info|network_source|ipam)/i.test(field.key);
  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const svg = (name) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#' + name);
    node.setAttribute('aria-hidden', 'true');
    node.append(use);
    return node;
  };
  const button = (text, className = '') => {
    const node = element('button', className, text);
    node.type = 'button';
    return node;
  };

  const collectionDrafts = new WeakMap();

  function createField(field, values, id, onStructuralChange) {
    const hardware = window.assetHardwareControlsPreview.create(field, values, id);
    if (hardware) return hardware;
    const wrapper = element('div', 'field' + (fullField(field) ? ' full' : ''));
    const label = element('label', '', field.label);
    label.htmlFor = id;
    if (field.required) label.append(element('span', 'required', '*'));
    const input = element(field.kind === 'select' ? 'select' : field.kind === 'textarea' ? 'textarea' : 'input');
    if (input.tagName === 'SELECT') {
      input.append(new Option('请选择', ''));
      for (const option of field.options) input.append(new Option(option, option));
      if (values[field.key] && !field.options.includes(String(values[field.key]))) input.append(new Option(values[field.key], values[field.key]));
    } else {
      if (input.tagName === 'INPUT') input.type = field.kind === 'number' ? 'number' : 'text';
      input.placeholder = '请输入' + field.label;
    }
    input.id = id;
    input.name = field.key;
    input.required = Boolean(field.required);
    input.value = values[field.key] ?? '';
    input.autocomplete = 'off';
    input.addEventListener(input.tagName === 'SELECT' ? 'change' : 'input', () => {
      values[field.key] = input.value;
      if (['type', 'asset_class', 'os_type'].includes(field.key)) onStructuralChange?.(field.key);
    });
    wrapper.append(label, input);
    if (field.suggestions && input.tagName === 'INPUT') {
      const list = element('datalist');
      list.id = id + '-options';
      for (const option of field.suggestions(values)) list.append(new Option(option, option));
      input.setAttribute('list', list.id);
      input.placeholder = '可选择或输入' + field.label;
      wrapper.append(list);
    }
    return wrapper;
  }

  function appendCredentials(root, values, prefix) {
    const section = element('section', 'asset-section create-form-section asset-credentials record-section');
    const heading = element('h3', root.dataset.section === 'credentials' ? 'record-redundant-title' : '', '凭证中心');
    heading.prepend(svg('key'));
    const fields = element('div', 'fields record-fields asset-credential-grid');
    for (const [key, label, options] of [
      ['_prototype_host', 'Netcatty 主机', ['虚构主机甲（原型）', '虚构主机乙（原型）']],
      ['_prototype_vault', 'Netcatty 密钥库', ['虚构密钥库甲（原型）', '虚构密钥库乙（原型）']],
    ]) fields.append(createField({ key, label, kind: 'select', options }, values, prefix + '-' + key));
    section.append(heading, fields, element('p', 'dialog-note', '仅供离线交互预览，以上均为虚构选项；不读取、不保存真实主机或密钥库引用，不接收密码、私钥。'));
    root.append(section);
  }

  function appendCollection(root, values, rerender) {
    let draft = collectionDrafts.get(values);
    if (draft?.phase === 'loading') { clearTimeout(draft.timer); draft.token++; draft.phase = 'idle'; }
    if (draft && draft.sourceType !== values.type) { draft.sourceType = values.type; draft.phase = 'idle'; draft.results = null; }
    if (!/服务器|server|虚拟机|virtual|云主机|超融合/i.test(values.type || '')) return;
    const os = values.os_type || '';
    const detectedFamily = /ESXi/i.test(os) ? 'ESXi' : /Windows/i.test(os) ? 'Windows' : /Linux|Ubuntu|Euler|Rocky/i.test(os) ? 'Linux' : '';
    if (!draft) {
      draft = { family: detectedFamily, sourceOs: os, sourceType: values.type, phase: 'idle', outcome: 'success', token: 0 };
      collectionDrafts.set(values, draft);
    }
    if (draft.sourceOs !== os) {
      draft.sourceOs = os;
      draft.family = detectedFamily;
      if (draft.phase !== 'applied') { draft.phase = 'idle'; draft.results = null; }
    }
    const section = element('section', 'asset-section create-form-section asset-hardware-collection record-section');
    const heading = element('h3', '', 'SSH 硬件读取（离线模拟）');
    heading.prepend(svg('server'));
    const detected = element('p', 'dialog-note', '表单 OS 识别：' + (detectedFamily || '未识别') + '（' + (os || '未填写') + '）；下方家族可手动选择，仅控制模拟结果。');
    const controls = element('div', 'fields record-fields');
    const familyField = element('label', 'field', '操作系统家族');
    const family = element('select');
    family.setAttribute('aria-label', '模拟读取操作系统家族');
    family.append(new Option('请选择', ''), new Option('Linux', 'Linux'), new Option('Windows', 'Windows'), new Option('ESXi（不支持）', 'ESXi'));
    family.value = draft.family;
    familyField.append(family);
    const outcomeField = element('label', 'field', '模拟读取场景');
    const outcome = element('select');
    outcome.setAttribute('aria-label', '模拟读取场景');
    outcome.append(new Option('成功返回虚构硬件', 'success'), new Option('读取失败（演示重试）', 'failure'));
    outcome.value = draft.outcome;
    outcomeField.append(outcome);
    controls.append(familyField, outcomeField);
    const status = element('p', 'dialog-note');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const actions = element('div', 'asset-collection-actions');
    const read = button('模拟读取硬件');
    const cancel = button('取消读取，保留草稿');
    const review = element('div', 'asset-collection-review');
    const stop = () => { clearTimeout(draft.timer); draft.token++; draft.phase = 'idle'; draft.results = null; paint(); status.textContent = '已取消；手动填写内容与未保存草稿保持不变。'; };
    function paint() {
      const unsupported = draft.family === 'ESXi';
      read.disabled = !draft.family || unsupported || draft.phase === 'loading';
      read.textContent = draft.phase === 'failure' ? '重试模拟读取' : draft.phase === 'review' ? '重新模拟读取' : '模拟读取硬件';
      cancel.hidden = !['loading', 'review'].includes(draft.phase);
      family.disabled = outcome.disabled = draft.phase === 'loading';
      section.setAttribute('aria-busy', String(draft.phase === 'loading'));
      status.textContent = unsupported ? 'ESXi 不支持此 SSH 硬件读取演示；请手动填写配置，本原型不会尝试连接。'
        : draft.phase === 'loading' ? '正在模拟 SSH 连接后读取… 未发起任何网络请求。'
          : draft.phase === 'failure' ? '模拟读取失败：示例 SSH 超时。草稿未改动；可切换成功场景后重试。'
            : draft.phase === 'review' ? '读取完成（虚构结果）。逐项勾选后明确确认，才写入未保存表单；现有值不会自动覆盖。'
              : 'SSH 连接后可读取（演示说明）；仅离线定时模拟，无真实 SSH、凭证或设备访问。';
      review.replaceChildren();
      if (draft.phase !== 'review') return;
      const selected = new Set();
      const apply = button('确认将勾选结果写入未保存表单', 'primary');
      apply.disabled = true;
      for (const [key, label, value] of draft.results) {
        const choice = element('label', 'asset-result-choice');
        const check = element('input');
        check.type = 'checkbox';
        check.addEventListener('change', () => { check.checked ? selected.add(key) : selected.delete(key); apply.disabled = !selected.size; });
        choice.append(check, element('span', '', label + '：' + value + '（当前：' + (values[key] || '未填写') + '）'));
        review.append(choice);
      }
      apply.addEventListener('click', () => {
        if (!selected.size) return;
        for (const [key, , value] of draft.results) if (selected.has(key)) values[key] = value;
        draft.phase = 'applied';
        draft.results = null;
        rerender();
      });
      review.append(apply);
    }
    family.addEventListener('change', () => { draft.family = family.value; draft.phase = 'idle'; draft.results = null; paint(); });
    outcome.addEventListener('change', () => { draft.outcome = outcome.value; });
    cancel.addEventListener('click', stop);
    read.addEventListener('click', () => {
      draft.phase = 'loading'; draft.results = null;
      const token = ++draft.token;
      paint();
      draft.timer = setTimeout(() => {
        if (draft.token !== token || !section.isConnected || !section.closest('dialog')?.open) return;
        if (draft.outcome === 'failure') draft.phase = 'failure';
        else {
          draft.phase = 'review';
          const vm = /虚拟机|virtual|云主机/i.test(values.type || '');
          draft.results = [[vm ? 'vcpu' : 'cpu_info', vm ? 'vCPU（核）' : 'CPU', vm ? '8' : 'Intel Xeon Gold 6330（模拟）'], ['memory_mb', '内存 MB', '65536'], ['disk_info', '磁盘配置', '2 × 960 GB SSD / RAID 1（模拟）'], ['os_type', '操作系统', draft.family === 'Windows' ? 'Windows Server' : 'Ubuntu'], ['os_version', '系统版本', draft.family === 'Windows' ? '2022（模拟）' : '24.04（模拟）']];
        }
        paint();
      }, 1100);
    });
    actions.append(read, cancel);
    section.append(heading, detected, controls, status, actions, review);
    root.append(section);
    const owner = root.closest('dialog');
    if (owner && !draft.closeBound) {
      draft.closeBound = true;
      owner.addEventListener('close', () => { clearTimeout(draft.timer); draft.token++; draft.closeBound = false; if (draft.phase === 'loading') draft.phase = 'idle'; }, { once: true });
    }
    paint();
    if (draft.phase === 'applied') status.textContent = '已将确认项写入未保存表单，其余字段保持不变；未保存资产。';
  }

  let dialog;
  let body;
  let title;
  let deviceIcon;

  function prepareDialog() {
    if (dialog) return;
    dialog = element('dialog', 'asset-create-dialog record-shell');
    dialog.id = 'asset-create-dialog';
    dialog.setAttribute('aria-labelledby', 'asset-create-title');
    dialog.setAttribute('aria-describedby', 'asset-create-note');

    const header = element('div', 'dialog-header record-header');
    deviceIcon = element('span', 'sheet-device-icon');
    const identity = element('div', 'create-dialog-identity');
    title = element('h2');
    title.id = 'asset-create-title';
    identity.append(title, element('p', 'create-dialog-subtitle', '设计原型 · 仅预览表单，不保存业务数据'));
    const close = button('', 'quiet icon');
    close.id = 'asset-create-close';
    close.setAttribute('aria-label', '关闭新增原型');
    close.append(svg('close'));
    close.addEventListener('click', () => dialog._requestFormClose?.());
    header.append(deviceIcon, identity, close);

    body = element('div', 'dialog-body record-body');
    body.id = 'asset-create-body';
    const footer = element('div', 'dialog-footer record-footer');
    const cancel = button('取消');
    cancel.id = 'asset-create-cancel';
    cancel.addEventListener('click', () => dialog._requestFormClose?.());
    const save = button('新增（离线不可用）', 'primary');
    save.id = 'asset-create-save';
    save.disabled = true;
    save.title = '原型未接入保存，不会创建资产';
    footer.append(element('span', 'asset-form-offline', '离线原型 · 不会保存'), cancel, save);
    dialog.append(header, body, footer);
    document.body.append(dialog);
    // Esc 的关闭确认由当前 renderForm 会话处理，仍保留原生焦点约束。
  }

  function mergeGroups(view, config) {
    const sections = formSections[view].map(([key, title, icon]) => ({ key, title, icon, fields: [] }));
    if (config.groups.some((group) => group.fields.some((field) => field.key === 'history'))) sections.push({ key: 'history', title: '运维履历', icon: 'history', fields: [] });
    for (const group of config.groups) {
      for (const field of group.fields) {
        const key = field.key === 'history' ? 'history' : field.key === 'server_name' ? 'hosting' : ownershipKeys.has(field.key) ? 'ownership'
          : hardwareKeys.has(field.key) ? 'hardware' : networkKeys.has(field.key) ? 'network'
            : view === 'terminal' && ['vendor', 'model'].includes(field.key) ? 'hardware' : 'basic';
        (sections.find((section) => section.key === key) || sections[0]).fields.push(field);
      }
    }
    const basic = sections.find((section) => section.key === 'basic');
    const leadingKeys = ['name', 'code', 'type', 'status'];
    basic.fields = [
      ...leadingKeys.flatMap((key) => basic.fields.filter((field) => field.key === key)),
      ...basic.fields.filter((field) => !leadingKeys.includes(field.key)),
    ];
    sections.push({ key: 'credentials', title: '凭证中心', icon: 'key', fields: [] });
    return sections;
  }

  function appendPhotos(section) {
    const photos = element('div', 'create-hardware-photos');
    photos.id = 'asset-create-photos';
    const heading = element('h4', '', '设备照片（原型示意）');
    heading.prepend(svg('image'));
    const gallery = element('div', 'preview-photos hardware-photos');
    for (const side of ['正面', '背面']) {
      const photo = element('div', 'detail-photo');
      photo.dataset.side = side === '正面' ? 'front' : 'back';
      photo.append(svg('image'), element('span', '', side + '照片 · 横向预览占位'));
      gallery.append(photo);
      const upload = button('选择' + side + '照片（原型示意）');
      upload.disabled = true;
      upload.setAttribute('aria-label', '选择' + side + '照片（原型示意，未接入上传）');
      photos.append(upload);
    }
    photos.prepend(heading, gallery);
    photos.append(element('p', 'dialog-note', '正面 / 背面为 5:1 横向占位；照片与机柜分配互相独立，未上架也可有照片。本原型不读取或上传本地文件，占位不代表已上传。'));
    section.append(photos);
  }

  function renderForm({ root, nav, view, config, values, prefix = 'asset-field', mode = 'edit' }) {
    const owner = root.closest('dialog');
    owner._disposeForm?.();
    owner.querySelectorAll('[data-form-tabs]').forEach((node) => node.remove());
    root.replaceChildren();
    root.classList.add('record-body');
    root.removeAttribute('role');
    root.removeAttribute('aria-labelledby');
    delete root.dataset.detailPanel;
    const tabs = nav || element('div', 'record-tabs asset-form-tabs');
    tabs.classList.add('record-tabs', 'asset-form-tabs');
    tabs.dataset.formTabs = '';
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', config.label + '表单分区');
    tabs.replaceChildren();
    if (!nav) root.before(tabs);
    let activeSection = 'basic';
    let dirty = false;
    const sections = mergeGroups(view, config);
    const panels = new Map();
    const controls = [];
    const scrollPositions = new Map();
    const note = element('p', 'dialog-note create-dialog-note asset-form-offline', '离线表单预览：草稿仅在本次窗口保留，保存、上传和真实连接均未接入。');
    note.id = mode === 'create' ? 'asset-create-note' : prefix + '-note';
    root.append(note);

    function selectSection(key) {
      if (!panels.has(key)) return;
      scrollPositions.set(activeSection, root.scrollTop);
      activeSection = key;
      root.dataset.activeSection = key;
      for (const [sectionKey, panel] of panels) panel.hidden = sectionKey !== key;
      for (const tab of tabs.children) {
        const selected = tab.dataset.formTab === key;
        tab.setAttribute('aria-selected', String(selected));
        tab.tabIndex = selected ? 0 : -1;
      }
      root.scrollTop = scrollPositions.get(key) || 0;
    }

    for (const definition of sections) {
      const section = element('section', 'asset-section create-form-section record-section');
      section.id = prefix + '-section-' + definition.key;
      section.dataset.section = definition.key;
      section.setAttribute('role', 'tabpanel');
      section.setAttribute('aria-labelledby', prefix + '-tab-' + definition.key);
      const heading = element('h3', 'record-redundant-title', definition.title);
      heading.prepend(svg(definition.icon));
      const fields = element('div', 'fields record-fields');
      section.append(heading, fields);
      const uniqueFields = new Map();
      for (const field of definition.fields) {
        if (!uniqueFields.has(field.key)) uniqueFields.set(field.key, []);
        uniqueFields.get(field.key).push(field);
      }
      for (const [key, variants] of uniqueFields) {
        const initial = variants.find((field) => !field.when || field.when(values)) || variants[0];
        const wrapper = createField(initial, values, prefix + '-' + key, () => refresh());
        wrapper.dataset.fieldKey = key;
        fields.append(wrapper);
        controls.push({ key, variants, wrapper, field: initial });
      }
      if (definition.key === 'ownership' && view === 'infrastructure') {
        const photos = element('div', 'asset-form-photos');
        appendPhotos(photos);
        section.append(photos);
        const virtualNote = element('p', 'dialog-note asset-form-virtual-note', '虚拟资源无实体位置，不录入机柜位置或设备照片；切回实体类型可继续填写原草稿。');
        section.append(virtualNote);
      }
      if (definition.key === 'network' && view === 'systems') section.append(element('p', 'dialog-note', '仅预览系统自身业务地址；不解析地址池，也不带入承载设备的 IP 或网络类型。'));
      if (definition.key === 'hardware') {
        section.append(element('p', 'dialog-note asset-form-hardware-note', '当前类型没有专属硬件录入项；切换为电脑、服务器或存储设备后可填写对应配置。'), element('div', 'asset-form-collection'));
      }
      if (definition.key === 'credentials') appendCredentials(section, values, prefix);
      if (definition.key === 'hosting') section.append(element('p', 'dialog-note', '仅保留承载设备的离线关联草稿；不会读取或修改承载设备。'));
      panels.set(definition.key, section);
      root.append(section);
      const tab = button('', 'asset-form-tab');
      tab.id = prefix + '-tab-' + definition.key;
      tab.dataset.formTab = definition.key;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-controls', section.id);
      tab.setAttribute('aria-label', definition.title);
      tab.title = definition.title;
      tab.append(svg(definition.icon), element('span', 'record-tab-label', definition.title));
      tab.addEventListener('click', () => selectSection(definition.key));
      tab.addEventListener('keydown', (event) => {
        const list = [...tabs.children];
        const index = list.indexOf(tab);
        const next = event.key === 'ArrowRight' ? (index + 1) % list.length : event.key === 'ArrowLeft' ? (index + list.length - 1) % list.length : event.key === 'Home' ? 0 : event.key === 'End' ? list.length - 1 : -1;
        if (next < 0) return;
        event.preventDefault();
        selectSection(list[next].dataset.formTab);
        list[next].focus();
      });
      tabs.append(tab);
    }

    function refresh(fromCollection = false) {
      for (const control of controls) {
        const field = control.variants.find((candidate) => !candidate.when || candidate.when(values));
        control.wrapper.hidden = !field;
        if (!field) continue;
        if (field !== control.field) {
          const label = control.wrapper.querySelector('label');
          label.textContent = field.label;
          if (field.required) label.append(element('span', 'required', '*'));
          control.field = field;
        }
        if (fromCollection && hardwareKeys.has(control.key)) {
          const replacement = createField(field, values, prefix + '-' + control.key, () => refresh());
          replacement.dataset.fieldKey = control.key;
          control.wrapper.replaceWith(replacement);
          control.wrapper = replacement;
        } else {
          const input = control.wrapper.querySelector('[name="' + control.key + '"]');
          if (input && !hardwareKeys.has(control.key)) {
            const value = String(values[control.key] ?? '');
            if (input.tagName === 'SELECT' && value && ![...input.options].some((option) => option.value === value)) input.append(new Option(value, value));
            input.value = value;
          }
        }
      }
      if (view === 'infrastructure') {
        const virtual = /虚拟机|virtual|云主机|容器/i.test(values.type || '');
        root.querySelector('.asset-form-photos').hidden = virtual;
        root.querySelector('.asset-form-virtual-note').hidden = !virtual;
      }
      const hardwareNote = root.querySelector('.asset-form-hardware-note');
      if (hardwareNote) hardwareNote.hidden = controls.some((control) => control.wrapper.closest('[data-section="hardware"]') && !control.wrapper.hidden);
      const collection = root.querySelector('.asset-form-collection');
      if (collection) {
        collection.replaceChildren();
        appendCollection(collection, values, () => { dirty = true; refresh(true); });
      }
    }
    const markDirty = () => { dirty = true; };
    root.addEventListener('input', markDirty);
    root.addEventListener('change', markDirty);
    const requestClose = () => {
      if (dirty && !window.confirm('当前有未保存的离线草稿，确定放弃并关闭？')) return false;
      owner.close();
      return true;
    };
    const cancel = (event) => { event.preventDefault(); requestClose(); };
    owner.addEventListener('cancel', cancel);
    owner._requestFormClose = requestClose;
    const dispose = () => {
      root.removeEventListener('input', markDirty);
      root.removeEventListener('change', markDirty);
      owner.removeEventListener('cancel', cancel);
      owner.removeEventListener('close', dispose);
      delete owner._requestFormClose;
      delete owner._disposeForm;
    };
    owner._disposeForm = dispose;
    owner.addEventListener('close', dispose, { once: true });
    refresh();
    selectSection('basic');
    return { values, selectSection, requestClose, isDirty: () => dirty, get activeSection() { return activeSection; } };
  }

  function show({ view, config }) {
    if (!viewIcons[view]) throw new Error('不支持的资产新增原型：' + view);
    prepareDialog();
    // 新增每次均从空草稿开始，不读取或继承示例记录。
    const values = {};
    dialog.dataset.view = view;
    title.textContent = '新增' + config.label;
    deviceIcon.replaceChildren(svg(viewIcons[view]));
    renderForm({ root: body, view, config, values, prefix: 'create-field', mode: 'create' });
    if (!dialog.open) dialog.showModal();
    body.scrollTop = 0;
    document.getElementById('create-field-name')?.focus({ preventScroll: true });
  }

  window.assetPrototypeForm = { renderForm, createField, appendCredentials, appendCollection, appendPhotos };
  window.assetPrototypeCreate = { show };
})();

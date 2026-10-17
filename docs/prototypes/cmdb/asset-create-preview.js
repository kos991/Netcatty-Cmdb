(() => {
  'use strict';

  const viewIcons = { terminal: 'monitor', infrastructure: 'server', systems: 'workflow' };
  const networkKeys = new Set(['deployment', 'port', 'access_url', 'middleware', 'database_info']);
  const sectionDefinitions = [
    { title: '基本信息', icon: 'cpu' },
    { title: '归属与位置', icon: 'map-pin' },
    { title: '网络与系统', icon: 'network' },
  ];
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
    const wrapper = element('div', 'field' + (field.kind === 'textarea' ? ' full' : ''));
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
    return wrapper;
  }

  function appendCredentials(root, values, prefix) {
    const section = element('section', 'asset-section create-form-section asset-credentials');
    const heading = element('h3', '', '凭证中心');
    heading.prepend(svg('key'));
    const fields = element('div', 'fields asset-credential-grid');
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
    const section = element('section', 'asset-section create-form-section asset-hardware-collection');
    const heading = element('h3', '', 'SSH 硬件读取（离线模拟）');
    heading.prepend(svg('server'));
    const detected = element('p', 'dialog-note', '表单 OS 识别：' + (detectedFamily || '未识别') + '（' + (os || '未填写') + '）；下方家族可手动选择，仅控制模拟结果。');
    const controls = element('div', 'fields');
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
    dialog = element('dialog', 'asset-create-dialog');
    dialog.id = 'asset-create-dialog';
    dialog.setAttribute('aria-labelledby', 'asset-create-title');
    dialog.setAttribute('aria-describedby', 'asset-create-note');

    const header = element('div', 'dialog-header');
    deviceIcon = element('span', 'sheet-device-icon');
    const identity = element('div', 'create-dialog-identity');
    title = element('h2');
    title.id = 'asset-create-title';
    identity.append(title, element('p', 'create-dialog-subtitle', '设计原型 · 仅预览表单，不保存业务数据'));
    const close = button('', 'quiet icon');
    close.id = 'asset-create-close';
    close.setAttribute('aria-label', '关闭新增原型');
    close.append(svg('close'));
    close.addEventListener('click', () => dialog.close());
    header.append(deviceIcon, identity, close);

    body = element('div', 'dialog-body');
    body.id = 'asset-create-body';
    const footer = element('div', 'dialog-footer');
    const cancel = button('取消');
    cancel.id = 'asset-create-cancel';
    cancel.addEventListener('click', () => dialog.close());
    const save = button('新增（原型示意）', 'primary');
    save.id = 'asset-create-save';
    save.disabled = true;
    save.title = '原型未接入保存，不会创建资产';
    footer.append(cancel, save);
    dialog.append(header, body, footer);
    document.body.append(dialog);
    // 保留原生 dialog 的 Esc、焦点约束与关闭后焦点恢复行为。
  }

  function mergeGroups(config) {
    const sections = sectionDefinitions.map((definition) => ({ ...definition, fields: [] }));
    for (const group of config.groups) {
      const groupIndex = /人员|归属|安装位置/.test(group.title) ? 1
        : /网络|硬件|业务地址/.test(group.title) ? 2 : 0;
      for (const field of group.fields) {
        if (field.key === 'history') continue;
        const index = networkKeys.has(field.key) ? 2 : groupIndex;
        sections[index].fields.push(field);
      }
    }
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

  function show({ view, config }) {
    if (!viewIcons[view]) throw new Error('不支持的资产新增原型：' + view);
    prepareDialog();
    const sections = mergeGroups(config);
    // 只初始化类型和状态；不读取示例记录，也不继承上次关闭的表单。
    const values = {};
    for (const section of sections) {
      for (const field of section.fields) {
        if (field.key === 'type' || field.key === 'status') values[field.key] = field.options?.[0] || '';
      }
    }
    dialog.dataset.view = view;
    title.textContent = '新增' + config.label;
    deviceIcon.replaceChildren(svg(viewIcons[view]));

    function renderFields(focusKey) {
      const previousScroll = body.scrollTop;
      body.replaceChildren();
      const note = element('p', 'dialog-note create-dialog-note', '所有字段均为原型录入预览，内容仅保留于本次弹窗；新增功能未接入。');
      note.id = 'asset-create-note';
      body.append(note);
      for (let index = 0; index < sections.length; index++) {
        const definition = sections[index];
        const section = element('section', 'create-form-section');
        section.dataset.section = ['basic', 'ownership', 'network'][index];
        const heading = element('h3', '', definition.title);
        heading.id = 'asset-create-section-' + index;
        heading.prepend(svg(definition.icon));
        section.setAttribute('aria-labelledby', heading.id);
        const fields = element('div', 'fields');
        for (const field of definition.fields) {
          if (field.when && !field.when(values)) continue;
          fields.append(createField(field, values, 'create-field-' + field.key, renderFields));
        }
        section.append(heading, fields);
        if (view === 'infrastructure' && index === 1) {
          if (/虚拟机|virtual|云主机|容器/i.test(values.type || '')) {
            section.append(element('p', 'dialog-note', '虚拟资源无实体位置，不录入机柜位置或设备照片。'));
          } else {
            appendPhotos(section);
          }
        }
        if (view === 'systems' && index === 2) {
          section.append(element('p', 'dialog-note', '仅预览系统自身业务地址；原型不解析地址池，也不带入承载设备的 IP 或网络类型。'));
        }
        body.append(section);
      }
      if (view !== 'systems') appendCollection(body, values, () => renderFields());
      appendCredentials(body, values, 'create-field');
      if (focusKey) document.getElementById('create-field-' + focusKey)?.focus({ preventScroll: true });
      body.scrollTop = previousScroll;
    }

    renderFields();
    if (!dialog.open) dialog.showModal();
    body.scrollTop = 0;
    document.getElementById('create-field-name')?.focus({ preventScroll: true });
  }

  window.assetPrototypeForm = { createField, appendCredentials, appendCollection, appendPhotos };
  window.assetPrototypeCreate = { show };
})();

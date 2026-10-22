(() => {
  'use strict';
  const byId = (id) => document.getElementById(id);
  const virtual = (row) => /虚拟机|virtual|云主机|容器/i.test(row.type || '');
  const kind = (row) => /交换机|switch/i.test(row.type || '') ? 'switch' : /路由器|router/i.test(row.type || '') ? 'router' : /服务器|server|虚拟机|virtual|超融合|云主机/i.test(row.type || '') ? 'server' : 'generic';
  const deviceIcon = (view, row) => view === 'terminal' ? 'monitor' : view === 'systems' ? 'workflow' : ({ switch: 'network', router: 'network', server: 'server', generic: 'boxes' })[kind(row)];
  function groupIcon(title) {
    if (/履历/.test(title)) return 'history';
    if (/照片/.test(title)) return 'image';
    if (/凭证/.test(title)) return 'key';
    if (/维修/.test(title)) return 'wrench';
    if (/交接|调换/.test(title)) return 'swap';
    if (/业务地址/.test(title)) return 'link';
    if (/网络/.test(title)) return 'network';
    if (/安装位置|机柜|承载/.test(title)) return 'server';
    if (/归属|人员|位置/.test(title)) return 'map-pin';
    if (/系统|配置/.test(title)) return 'settings';
    return 'cpu';
  }
  let panelWidth = 420;
  function prepareResizeHandle(sheet) {
    if (sheet.querySelector('.asset-panel-resizer')) return;
    const handle = document.createElement('div');
    handle.className = 'asset-panel-resizer';
    handle.tabIndex = 0;
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-orientation', 'vertical');
    handle.setAttribute('aria-label', '调整资产详情面板宽度');
    handle.setAttribute('aria-controls', 'asset-sheet');
    handle.title = '拖动调整宽度；方向键微调，双击恢复默认宽度';
    sheet.prepend(handle);
    const maxWidth = () => Math.min(720, Math.max(360, window.innerWidth - 460));
    const setWidth = (value) => {
      panelWidth = Math.max(360, Math.min(maxWidth(), value));
      document.body.style.setProperty('--asset-detail-width', panelWidth + 'px');
      handle.setAttribute('aria-valuemin', '360');
      handle.setAttribute('aria-valuemax', String(maxWidth()));
      handle.setAttribute('aria-valuenow', String(Math.round(panelWidth)));
      handle.setAttribute('aria-valuetext', Math.round(panelWidth) + ' 像素');
    };
    const canResize = () => window.innerWidth >= 980 && !sheet.classList.contains('expanded');
    let drag = null;
    const finish = () => {
      if (!drag) return;
      const pointerId = drag.pointerId;
      drag = null;
      sheet.classList.remove('resizing');
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
    };
    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || !canResize()) return;
      event.preventDefault();
      drag = { x: event.clientX, width: sheet.getBoundingClientRect().width, pointerId: event.pointerId };
      handle.setPointerCapture(event.pointerId);
      sheet.classList.add('resizing');
    });
    handle.addEventListener('pointermove', (event) => {
      if (drag && event.pointerId === drag.pointerId) setWidth(drag.width + drag.x - event.clientX);
    });
    for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) handle.addEventListener(eventName, finish);
    handle.addEventListener('dblclick', () => { if (canResize()) setWidth(420); });
    handle.addEventListener('keydown', (event) => {
      if (!canResize() || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 360 : event.key === 'End' ? maxWidth() : panelWidth + (event.key === 'ArrowLeft' ? 20 : -20);
      setWidth(next);
    });
    sheet.addEventListener('close', finish);
    window.addEventListener('resize', () => { finish(); setWidth(panelWidth); });
    setWidth(panelWidth);
  }
  function prepareHeader({ view, row, title, editing, helpers, onEdit, onOperation, operations = [] }) {
    const { button, svg } = helpers;
    const sheet = byId('asset-sheet');
    sheet.classList.add('record-shell');
    sheet.dataset.recordMode = editing ? 'edit' : 'detail';
    prepareResizeHandle(sheet);
    if (!editing) sheet.classList.remove('expanded');
    const header = sheet.querySelector('header');
    header.classList.add('record-header');
    let toolbar = byId('asset-detail-toolbar');
    if (!toolbar) {
      toolbar = document.createElement('div');
      toolbar.id = 'asset-detail-toolbar';
      toolbar.setAttribute('role', 'toolbar');
      toolbar.setAttribute('aria-label', '资产业务操作');
      header.after(toolbar);
    }
    toolbar.hidden = editing;
    byId('asset-detail-tabs').classList.add('record-tabs');
    byId('asset-sheet-body').classList.add('record-body');
    byId('asset-sheet-footer').classList.add('record-footer');
    const name = editing ? title : row.name || row.code || title;
    byId('asset-sheet-title').textContent = name;
    byId('asset-sheet-title').title = name;
    byId('asset-sheet-icon').replaceChildren(svg(deviceIcon(view, row)));
    const status = byId('asset-sheet-status');
    status.textContent = row.status || '';
    status.hidden = !row.status;
    status.className = 'asset-status' + (/注销/.test(row.status || '') ? ' archived' : /故障|维修|维护|离线|停用/.test(row.status || '') ? ' warning' : '');
    const subtitle = [...new Set([editing ? row.name : '', row.code, row.type].filter((value) => value && value !== name))].join(' · ');
    const subtitleNode = byId('asset-sheet-subtitle');
    subtitleNode.textContent = subtitle;
    subtitleNode.title = [row.status, subtitle].filter(Boolean).join(' · ');
    // 状态保持在标题行；副标题只显示编号与类型，避免状态被移出标题栏。
    if (status.parentElement !== byId('asset-sheet-title').parentElement) byId('asset-sheet-title').parentElement.append(status);
    const expand = byId('asset-header-expand');
    const edit = byId('asset-header-edit');
    expand.hidden = false;
    edit.hidden = editing;
    edit.onclick = onEdit || null;
    const updateExpand = () => {
      const expanded = sheet.classList.contains('expanded');
      const label = expanded ? '还原面板宽度' : '放大为全宽';
      expand.setAttribute('aria-label', label);
      expand.setAttribute('aria-pressed', String(expanded));
      expand.removeAttribute('aria-expanded');
      expand.title = label;
      expand.replaceChildren(svg(expanded ? 'shrink' : 'expand-diagonal'));
    };
    updateExpand();
    // 放大/还原只切换面板全宽；还原后保留拖动调节的宽度。
    expand.onclick = () => {
      sheet.classList.toggle('expanded');
      updateExpand();
    };
    // 标题栏窗口按钮：放大/还原、左右分栏（正文单/双列，独立状态）、关闭。
    const actionsBar = byId('asset-header-actions') || (() => {
      const bar = document.createElement('div');
      bar.id = 'asset-header-actions';
      bar.className = 'sheet-header-actions';
      return bar;
    })();
    actionsBar.replaceChildren();
    actionsBar.append(expand);
    const split = document.createElement('button');
    split.type = 'button';
    split.className = 'icon quiet';
    split.dataset.panelControl = 'columns';
    const columnsKey = 'cmdb-prototype-asset-panel-columns';
    const readColumns = () => { try { return localStorage.getItem(columnsKey) === '1' ? 1 : 2; } catch { return 2; } };
    const updateSplit = () => {
      const single = sheet.classList.contains('single-column');
      split.title = single ? '正文改为左右双列' : '正文改为单列';
      split.setAttribute('aria-label', split.title);
      split.setAttribute('aria-pressed', String(!single));
    };
    sheet.classList.toggle('single-column', readColumns() === 1);
    updateSplit();
    split.onclick = () => {
      const single = !sheet.classList.contains('single-column');
      sheet.classList.toggle('single-column', single);
      try { localStorage.setItem(columnsKey, single ? '1' : '2'); } catch { /* 仅原型偏好，读写失败时保持当前显示 */ }
      updateSplit();
    };
    split.append(svg('columns-2'));
    actionsBar.append(split);
    const extra = byId('asset-header-extra');
    extra.replaceChildren();
    extra.hidden = editing;
    // 历史资料由第三栏的履历页签提供，第二栏只放当前对象适用的业务操作。
    for (const operation of operations.filter((entry) => !['edit', 'history'].includes(entry.id))) {
      const control = button('', () => onOperation(operation.id), 'icon quiet');
      control.title = operation.label;
      control.setAttribute('aria-label', operation.label);
      control.append(svg(({ transfer: 'swap', maintenance: 'wrench', clone: 'clone', archive: 'archive' })[operation.id] || 'more'));
      extra.append(control);
    }
    header.onclick = null;
    const close = header.querySelector('[data-close="asset-sheet"]');
    close.title = editing ? '关闭编辑' : '关闭详情';
    if (!close.dataset.recordClose) {
      close.dataset.recordClose = 'true';
      close.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (sheet._requestFormClose) sheet._requestFormClose();
        else sheet.close();
      }, true);
    }
    // 编辑与业务操作放第二条栏；标题栏只留放大/还原、左右分栏和关闭。
    toolbar.append(edit, extra);
    // 标题栏右侧固定三个窗口控件，不恢复对角展开和右栏分栏的重复入口。
    header.querySelector('.sheet-header-actions').append(actionsBar, close);
    byId('asset-detail-tabs').hidden = editing;
    byId('asset-sheet-footer').hidden = !editing;
  }
  function show({ view, config, row, helpers, onEdit, onOperation }) {
    const { element, button, svg, text, addHistory } = helpers;
    const root = byId('asset-sheet-body');
    root.removeAttribute('role');
    root.removeAttribute('aria-labelledby');
    delete root.dataset.detailPanel;
    const tabBar = byId('asset-detail-tabs');
    byId('asset-sheet')._disposeForm?.();
    delete byId('asset-sheet')._requestFormClose;
    byId('asset-sheet').querySelectorAll('[data-form-tabs]').forEach((nav) => nav.remove());
    prepareHeader({ view, row, title: config.label, editing: false, helpers, onEdit, onOperation, operations: config.operations || [] });
    const section = (title, icon, pairs, action) => {
      const card = element('section', 'asset-section detail-section record-section');
      card.dataset.sectionTitle = title;
      const header = element('div', 'detail-section-heading');
      const heading = element('h3', '', title);
      heading.prepend(svg(icon));
      header.append(heading);
      if (action) header.append(action);
      card.append(header);
      if (pairs?.length) {
        const values = element('dl', 'asset-detail-values record-fields');
        for (const [label, value, full] of pairs) {
          const entry = document.createElement('div');
          const content = value instanceof Node ? value.textContent : String(value ?? '');
          if (full || content.length > 32 || /\n/.test(content)) entry.classList.add('full');
          entry.append(element('dt', '', label));
          const dd = document.createElement('dd');
          if (value instanceof Node) dd.append(value);
          else dd.textContent = text(value);
          entry.append(dd);
          values.append(entry);
        }
        card.append(values);
      }
      root.append(card);
      return card;
    };
    const fieldValue = (field) => {
      const value = row[field.key];
      if (['ip', 'physical_ip', 'mgmt_ip', 'biz_ip', 'service_ip'].includes(field.key)) return helpers.netcattyAddress(value);
      if (field.key === 'access_url' && helpers.netcattyBrowserUrl) return helpers.netcattyBrowserUrl(value);
      const logos = window.assetPrototypeLogos;
      const logo = /^(vendor|provider)$/.test(field.key) ? logos?.vendor?.(value)
        : /^(os|os_type)$/.test(field.key) ? logos?.operatingSystem?.(value) : null;
      if (!(logo instanceof Node)) return value;
      const content = element('span', 'detail-logo-value');
      if (logo instanceof Element) logo.setAttribute('aria-hidden', 'true');
      content.append(logo, element('span', '', text(value)));
      return content;
    };
    const fields = (title, icon, keys) => {
      const names = new Set(keys);
      const selected = config.groups.flatMap((group) => group.fields.filter((field) => names.has(field.key) && (!field.when || field.when(row))));
      return section(title, icon, selected.map((field) => [field.label, fieldValue(field), field.kind === 'textarea' || /^(name|code|cpu_info|disk_info|access_url|description|remark|network_source|deployment_location|ipam)$/.test(field.key)]));
    };
    const related = (title, icon, predicate) => {
      const relations = (row.relations || []).filter(predicate);
      const pairs = relations.map((relation) => {
        if (!relation.href) return [relation.label, relation.value];
        const link = element('a', 'detail-link', relation.value);
        link.href = relation.href;
        return [relation.label, link];
      });
      const card = section(title, icon, pairs);
      if (!relations.length) card.append(element('p', 'dialog-note', '当前示例未设置关联。'));
      return card;
    };
    const credentials = () => {
      const card = section('凭证中心', 'key', [['Netcatty 主机', '未关联'], ['密钥库引用', '未关联']]);
      const control = element('button', '', '关联主机与密钥库（示意）');
      control.disabled = true;
      card.append(control, element('p', 'dialog-note', '原型不读取凭证，也不保存密码或私钥。'));
    };
    const photos = (title = '设备照片') => {
      const card = section(title, 'image', []);
      const gallery = element('div', 'preview-photos' + (view === 'infrastructure' ? ' hardware-photos' : ''));
      for (const side of ['正面', '背面']) {
        const photo = element('div', 'detail-photo');
        photo.append(svg('image'), element('span', '', side + ' · 未上传'));
        gallery.append(photo);
      }
      const upload = element('button', '', '上传设备照片（示意）');
      upload.disabled = true;
      card.append(gallery, upload, element('p', 'dialog-note', '照片与机柜分配互相独立：未上架设备也可有照片。此原型仅展示正面 / 背面的 5:1 占位，不代表已上传照片。'));
    };
    const cabinet = () => {
      const start = Number(row.start_u);
      const height = Number(row.height_u);
      const assigned = Boolean(row.data_center && row.cabinet_name && Number.isInteger(start) && Number.isInteger(height) && start >= 1 && height >= 1 && start + height - 1 <= 42);
      const link = element('a', 'detail-link', assigned ? '完整机柜 · 定位此设备' : '前往机柜管理器');
      const query = new URLSearchParams();
      if (row.data_center) query.set('room', row.data_center);
      if (assigned) {
        for (const [key, value] of Object.entries({ cabinet: row.cabinet_name, device: row.id || row.name, name: row.name, start: row.start_u, height: row.height_u, code: row.code || '' })) query.set(key, value);
      }
      link.href = 'rack-layout-preview.html' + (query.size ? '?' + query : '') + '#rack';
      link.prepend(svg('maximize'));
      const card = section('机柜信息', 'server', [['机房', row.data_center || '未分配'], ['机柜', assigned ? row.cabinet_name : '未分配'], ['起始 U 位', assigned ? row.start_u : '未上架'], ['占用 U 数', row.height_u]], link);
      if (!assigned) {
        card.append(element('p', 'dialog-note', '当前示例未分配有效机柜位置；不生成占用设备或虚构上架关联。照片与机柜分配独立，不受未上架状态影响。'));
        return;
      }
      const scroll = element('div', 'detail-rack-scroll');
      const frame = element('div', 'rack-frame');
      const grid = element('div', 'rack-grid');
      grid.setAttribute('aria-label', '当前设备机柜位置预览');
      for (let u = 42; u >= 1; u--) {
        const label = element('span', 'u-label', u);
        label.style.gridRow = 43 - u;
        label.style.gridColumn = 1;
        const slot = element('div', 'slot');
        slot.style.gridRow = 43 - u;
        slot.style.gridColumn = 2;
        grid.append(label, slot);
      }
      const current = element('div', 'device selected asset-rack-current');
      current.dataset.assetId = row.id;
      current.style.gridRow = (43 - (start + height - 1)) + '/span ' + height;
      current.title = row.name + ' · ' + row.cabinet_name + ' / ' + start + '–' + (start + height - 1) + 'U';
      current.setAttribute('aria-label', '当前设备：' + current.title);
      const name = element('span', 'name', height + 'U ' + row.name);
      current.append(name);
      grid.append(current);
      frame.append(grid);
      scroll.append(frame);
      card.append(scroll);
      requestAnimationFrame(() => {
        if (!current.isConnected) return;
        scroll.scrollTop = Math.max(0, current.offsetTop - (scroll.clientHeight - current.offsetHeight) / 2);
      });
    };
    const operations = () => {
      if (kind(row) === 'server') {
        related('承载业务', 'activity', (relation) => /系统|业务|应用/.test(relation.label));
      } else {
        const card = fields(kind(row) === 'router' ? '接口运行' : '端口与配置', 'activity', ['name', 'vendor', 'model', 'mgmt_ip', 'net_type']);
        const read = element('button', '', '读取配置（原型示意）');
        read.disabled = true;
        card.append(element('p', 'dialog-note', '尚无配置快照。原型不连接设备或采集端口状态。'), read);
      }
    };
    const systems = view === 'systems';
    const terminal = view === 'terminal';
    const cabinetPhotos = !systems && !terminal && !virtual(row) && ['switch', 'server'].includes(kind(row));
    const operationLabel = terminal ? '' : kind(row) === 'switch' ? '端口与配置' : kind(row) === 'router' ? '接口运行' : kind(row) === 'server' ? '承载业务' : '';
    const tabs = systems ? [
      { key: 'system', label: '系统信息', icon: 'settings' },
      { key: 'network', label: '网络配置', icon: 'network' },
      { key: 'usage', label: '使用与归属', icon: 'map-pin' },
      { key: 'hosting', label: '承载设备', icon: 'server' },
      { key: 'records', label: '运维履历', icon: 'history' },
      { key: 'relations', label: '凭证中心', icon: 'key' },
    ] : [
      { key: 'hardware', label: '硬件信息', icon: 'cpu' },
      ...(operationLabel ? [{ key: 'operations', label: operationLabel, icon: 'activity' }] : []),
      { key: 'network', label: '网络配置', icon: 'network' },
      { key: 'usage', label: '使用与位置', icon: 'map-pin' },
      ...(!terminal && !virtual(row) ? [{ key: 'cabinet', label: '机柜信息', icon: 'server' }] : []),
      { key: 'system', label: '系统信息', icon: 'system' },
      ...(!virtual(row) && !cabinetPhotos ? [{ key: 'photos', label: '设备照片', icon: 'image' }] : []),
      { key: 'records', label: '设备履历', icon: 'history' },
      { key: 'relations', label: '凭证中心', icon: 'key' },
    ];
    const defaultTab = systems ? 'system' : terminal || !['switch', 'router'].includes(kind(row)) ? 'hardware' : 'operations';
    let active = defaultTab;
    const renderTab = (key) => {
      active = key;
      tabBar.querySelectorAll('[role=tab]').forEach((tab) => {
        tab.setAttribute('aria-selected', String(tab.dataset.detailTab === active));
        tab.tabIndex = tab.dataset.detailTab === active ? 0 : -1;
      });
      root.replaceChildren();
      root.dataset.detailPanel = key;
      root.setAttribute('role', 'tabpanel');
      root.setAttribute('aria-labelledby', 'detail-tab-' + key);
      root.tabIndex = 0;
      switch (key) {
        case 'hardware': fields('硬件信息', 'cpu', ['sn', 'display_sn', 'vendor', 'model', 'cpu_info', 'vcpu', 'memory_mb', 'disk_info']); break;
        case 'operations': operations(); break;
        case 'network':
          fields('网络配置', 'network', systems
            ? ['service_ip', 'network_type', 'network_source', 'ipam', 'port', 'access_url']
            : ['ip', 'physical_ip', 'network', 'mgmt_ip', 'net_type', 'biz_ip', 'business_network_type']);
          related('IPAM 地址', 'network', (relation) => /IP|地址/.test(relation.label));
          break;
        case 'usage':
          fields(systems ? '使用与归属' : '使用与位置', 'map-pin', systems
            ? ['person', 'department', 'deployment_location', 'description', 'remark']
            : ['person', 'department', 'organization', 'room', 'data_center', 'floor', 'cabinet_name', 'cabinet_row', 'cabinet_col', 'start_u', 'height_u']);
          break;
        case 'hosting':
          fields('承载设备', 'server', ['server_name']);
          section('承载关联', 'link', [['承载关联状态', row.host_linked]]);
          related('承载设备关联', 'server', (relation) => /承载|主机|服务器/.test(relation.label));
          break;
        case 'cabinet': cabinet(); if (cabinetPhotos) photos('机柜设备照片'); break;
        case 'system':
          fields('系统信息', systems ? 'settings' : 'system', systems
            ? ['version', 'provider', 'deployment', 'middleware', 'database_info']
            : ['os', 'os_type', 'os_version', 'provider', 'remark']);
          break;
        case 'photos': photos(); break;
        case 'records': addHistory(root, row); break;
        case 'relations': credentials(); break;
      }
      const activeTab = tabs.find((tab) => tab.key === key);
      root.querySelectorAll('.asset-section').forEach((card) => {
        card.classList.add('record-section');
        const heading = card.querySelector('h3');
        if (heading?.textContent.trim() === activeTab.label) {
          heading.classList.add('record-redundant-title');
          card.dataset.redundantTitle = 'true';
        }
      });
      byId('detail-tab-' + key)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      root.scrollTop = 0;
    };
    tabBar.replaceChildren();
    tabBar.hidden = false;
    tabBar.setAttribute('role', 'tablist');
    tabBar.setAttribute('aria-label', config.label + '详情分区');
    tabBar.setAttribute('aria-orientation', 'horizontal');
    for (const tab of tabs) {
      const control = button('', () => renderTab(tab.key), 'detail-tab');
      control.id = 'detail-tab-' + tab.key;
      control.dataset.detailTab = tab.key;
      control.setAttribute('role', 'tab');
      control.setAttribute('aria-label', tab.label);
      control.setAttribute('aria-controls', 'asset-sheet-body');
      control.title = tab.label;
      control.append(svg(tab.icon), element('span', 'record-tab-label', tab.label));
      control.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const index = tabs.findIndex((entry) => entry.key === active);
        const target = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        renderTab(tabs[target].key);
        byId('detail-tab-' + tabs[target].key).focus();
      });
      tabBar.append(control);
    }
    renderTab(active);
    byId('asset-sheet-footer').replaceChildren();
    if (!byId('asset-sheet').open) byId('asset-sheet').showModal();
  }
  function prepareEditor({ view, row, title, helpers }) {
    prepareHeader({ view, row, title, editing: true, helpers });
    const body = byId('asset-sheet-body');
    body.removeAttribute('role');
    body.removeAttribute('aria-labelledby');
    body.removeAttribute('tabindex');
    delete body.dataset.detailPanel;
  }
  window.assetPrototypeDetail = { show, prepareEditor, groupIcon };
})();

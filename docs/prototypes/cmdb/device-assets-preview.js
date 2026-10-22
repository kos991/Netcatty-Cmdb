(() => {
  'use strict';
  const pages = window.assetPrototypePages;
  const keys = ['terminal', 'infrastructure', 'systems'];
  for (const key of keys) {
    if (!pages?.[key]) throw new Error('缺少资产原型配置：' + key);
  }
  const byId = (id) => document.getElementById(id);
  const state = { view: 'terminal', page: 1, filters: {}, visibleFilters: new Set(), selected: new Set() };
  const text = (value) => value === null || value === undefined || value === '' ? '未配置' : String(value);
  const element = (tag, className, value) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
  };
  const button = (label, action, className = '') => {
    const node = element('button', className, label);
    node.type = 'button';
    node.addEventListener('click', action);
    return node;
  };
  const svg = (name) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#' + name);
    node.append(use);
    node.setAttribute('aria-hidden', 'true');
    return node;
  };
  // 与原生列表一致：名称后显示网络类型色点，颜色取设置中的网络类型颜色。
  const networkColor = (name) => {
    const entries = window.cmdbSettingsPreviewCatalogs?.network?.entries || [];
    const color = entries.find((entry) => entry.name === name)?.color;
    return /^#[0-9A-Fa-f]{6}$/.test(String(color || '')) ? color : '#94A3B8';
  };
  const networkDot = (name) => {
    const label = text(name);
    const dot = element('span', 'asset-type-dot');
    dot.style.backgroundColor = networkColor(label);
    dot.title = '网络类型：' + label;
    dot.setAttribute('aria-label', '网络类型：' + label);
    return dot;
  };
  function showNetcattyHint(line, address) {
    document.querySelectorAll('.asset-netcatty-notice').forEach((notice) => notice.remove());
    const notice = element('span', 'asset-netcatty-notice dialog-note', '请在 Netcatty 客户端中打开 ' + address + ' 的连接。');
    notice.setAttribute('role', 'status');
    line.after(notice);
  }
  const matches = (row, query) => Object.values(row).filter((value) => typeof value === 'string' || typeof value === 'number').join(' ').toLowerCase().includes(query);
  function netcattyAddress(address, prefix = '') {
    const line = element('span', 'asset-address-line');
    const value = element('span', 'asset-address-value', prefix + text(address));
    value.title = prefix + text(address);
    line.append(value);
    if (address) {
      const connect = button('', () => showNetcattyHint(line, address), 'asset-netcatty-link');
      connect.prepend(svg('square-terminal'));
      connect.title = '使用 Netcatty 连接 ' + address + '（需在客户端打开）';
      connect.setAttribute('aria-label', connect.title);
      line.append(connect);
    }
    return line;
  }
  function showNetcattyBrowserHint(line, address) {
    document.querySelectorAll('.asset-netcatty-notice').forEach((notice) => notice.remove());
    const notice = element('span', 'asset-netcatty-notice dialog-note', '请在 Netcatty 浏览器中打开 ' + address + ' 的访问地址（需已关联主机）。');
    notice.setAttribute('role', 'status');
    line.after(notice);
  }
  function netcattyBrowserUrl(address) {
    const line = element('span', 'asset-address-line asset-browser-url');
    const value = element('span', 'asset-address-value', text(address || '未配置'));
    value.title = text(address || '未配置');
    line.append(value);
    if (address && /^https?:\/\//i.test(address)) {
      const open = button('', () => showNetcattyBrowserHint(line, address), 'asset-netcatty-link');
      open.prepend(svg('globe'));
      open.title = '在 Netcatty 浏览器中打开 ' + address;
      open.setAttribute('aria-label', open.title);
      line.append(open);
    }
    return line;
  }
  const visibleFields = (group, values) => group.fields.filter((field) => !field.when || field.when(values));

  function currentRows() {
    const query = byId('asset-search').value.trim().toLowerCase();
    return pages[state.view].rows.filter((row) => (byId('include-archived').checked || row.status !== '已注销') && (!query || matches(row, query)) && Object.entries(state.filters).every(([key, value]) => !value || String(row[key] ?? '') === value || value === '__unconfigured__' && (row[key] === '' || row[key] === undefined)));
  }
  function renderFilters() {
    const config = pages[state.view];
    const root = byId('asset-filter-options');
    const picker = byId('asset-filter-picker-options');
    root.replaceChildren();
    picker.replaceChildren();
    for (const filter of config.filters) {
      const pickerLabel = element('label', 'filter-option');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = state.visibleFilters.has(filter.key);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) state.visibleFilters.add(filter.key);
        else { state.visibleFilters.delete(filter.key); delete state.filters[filter.key]; }
        state.page = 1;
        renderFilters();
        renderTable();
      });
      pickerLabel.append(checkbox, document.createTextNode(filter.label));
      picker.append(pickerLabel);
      if (!state.visibleFilters.has(filter.key)) continue;
      const label = element('label', '', filter.label);
      const select = document.createElement('select');
      select.setAttribute('aria-label', filter.label);
      select.dataset.filterKey = filter.key;
      select.append(new Option('全部', ''));
      const values = [...new Set(config.rows.map((row) => row[filter.key]).filter((value) => value !== '' && value !== undefined && value !== null).map(String))];
      values.forEach((value) => select.append(new Option(value, value)));
      if (config.rows.some((row) => row[filter.key] === '' || row[filter.key] === undefined)) select.append(new Option('未配置', '__unconfigured__'));
      select.value = state.filters[filter.key] || '';
      select.addEventListener('change', () => { state.filters[filter.key] = select.value; state.page = 1; renderTable(); });
      label.append(select);
      root.append(label);
    }
  }
  function renderSelection() {
    byId('asset-selection').hidden = !state.selected.size;
    byId('asset-selected-count').textContent = '已选 ' + state.selected.size + ' 项 · ';
  }
  function renderCrossResults(query) {
    const root = byId('asset-global-results');
    root.replaceChildren();
    if (!query) { root.hidden = true; return; }
    const others = keys.filter((key) => key !== state.view).flatMap((key) => pages[key].rows.filter((row) => (byId('include-archived').checked || row.status !== '已注销') && matches(row, query)).map((row) => ({ key, row })));
    root.hidden = !others.length;
    if (!others.length) return;
    root.append(element('span', '', '其他资产类别匹配 ' + others.length + ' 项：'));
    for (const { key, row } of others) {
      const result = button(pages[key].label + ' · ' + row.name, () => {
        switchView(key, true);
        openDetail(row);
      }, 'quiet global-result');
      result.title = row.name;
      root.append(result);
    }
  }
  function sizeColumns() {
    const columns = pages[state.view].columns;
    const total = columns.reduce((sum, column) => sum + column.width, 0);
    const available = document.querySelector('.asset-table-wrap').clientWidth - 112;
    columns.forEach((column, index) => {
      byId('asset-colgroup').children[index + 1].style.width = (available * column.width / total) + 'px';
    });
  }
  function renderTable() {
    const config = pages[state.view];
    const rows = currentRows();
    const pageSize = Number(byId('asset-page-size').value);
    const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
    state.page = Math.min(state.page, totalPages);
    const visible = rows.slice((state.page - 1) * pageSize, state.page * pageSize);
    const head = byId('asset-table-head');
    const colgroup = byId('asset-colgroup');
    const body = byId('asset-table-body');
    head.replaceChildren();
    colgroup.replaceChildren();
    body.replaceChildren();
    const firstCol = document.createElement('col');
    firstCol.style.width = '32px';
    colgroup.append(firstCol);
    const checkCell = element('th', 'checkbox-cell');
    const all = document.createElement('input');
    all.type = 'checkbox';
    all.setAttribute('aria-label', '选择当前页资产');
    all.checked = !!visible.length && visible.every((row) => state.selected.has(row.id));
    all.indeterminate = !all.checked && visible.some((row) => state.selected.has(row.id));
    all.addEventListener('change', () => {
      visible.forEach((row) => all.checked ? state.selected.add(row.id) : state.selected.delete(row.id));
      renderTable();
    });
    checkCell.append(all);
    head.append(checkCell);
    config.columns.forEach((column) => {
      const col = document.createElement('col');
      colgroup.append(col);
      const th = element('th', column.headerTitle ? 'asset-identity-header' : '', column.label);
      th.title = column.headerTitle || column.label;
      head.append(th);
    });
    const actionCol = document.createElement('col');
    actionCol.style.width = '80px';
    colgroup.append(actionCol);
    head.append(element('th', 'action-cell', '操作'));
    sizeColumns();
    for (const row of visible) {
      const tr = document.createElement('tr');
      tr.dataset.assetId = row.id;
      const td = element('td', 'checkbox-cell');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = state.selected.has(row.id);
      checkbox.setAttribute('aria-label', '选择 ' + row.name);
      checkbox.addEventListener('change', () => { checkbox.checked ? state.selected.add(row.id) : state.selected.delete(row.id); renderTable(); });
      td.append(checkbox);
      tr.append(td);
      for (const column of config.columns) {
        const cell = document.createElement('td');
        let value = text(row[column.key]);
        if (column.key === 'ip' && row.physical_ip) value = '业务 ' + value;
        if (column.kind === 'asset') {
          const nameRow = element('div', 'asset-name-row');
          const link = button(value, () => openDetail(row), 'asset-primary');
          link.title = value;
          const network = state.view === 'terminal' ? row.network : state.view === 'infrastructure' ? row.net_type : row.network_type;
          nameRow.append(link, networkDot(network));
          cell.append(nameRow);
        } else if (column.kind === 'status') {
          const tone = /注销/.test(value) ? 'archived' : /故障|维修|维护|离线|停用/.test(value) ? 'warning' : /闲置|在库|待上线/.test(value) ? 'idle' : '';
          cell.append(element('span', 'asset-status ' + tone, value));
        } else if (column.kind === 'address') {
          cell.append(netcattyBrowserUrl(value));
        } else if (['ip', 'mgmt_ip', 'biz_ip', 'service_ip'].includes(column.key)) {
          cell.append(netcattyAddress(row[column.key], column.key === 'ip' && row.physical_ip ? '业务 ' : column.key === 'mgmt_ip' ? '管理 ' : ''));
        } else {
          const primary = element('span', 'asset-primary' + (/ip$/i.test(column.key) ? ' asset-ip' : ''), value);
          primary.title = value;
          const logos = window.assetPrototypeLogos;
          const logo = logos && (column.key === 'vendor_model' ? logos.vendor(row.vendor) : column.key === 'os' ? logos.operatingSystem(row.os) : null);
          if (logo) {
            const label = element('span', 'asset-brand-label', value);
            primary.textContent = '';
            primary.classList.add('asset-brand-inline');
            primary.append(logo, label);
          }
          cell.append(primary);
        }
        if (column.secondary && row[column.secondary]) {
          const addressPrefix = column.secondary === 'physical_ip' ? '终端 ' : column.secondary === 'biz_ip' ? '业务 ' : '';
          const secondaryText = addressPrefix + String(row[column.secondary]);
          const secondary = ['physical_ip', 'biz_ip'].includes(column.secondary)
            ? netcattyAddress(row[column.secondary], addressPrefix)
            : element('span', 'asset-secondary', secondaryText);
          secondary.classList.add('asset-secondary');
          secondary.title = secondaryText;
          cell.append(secondary);
        }
        tr.append(cell);
      }
      const actions = element('td', 'action-cell');
      // 与原生一致：每行一个紧凑“操作”按钮，菜单分组列出查看、编辑、业务流程和注销归档。
      const more = button('操作', (event) => openActions(row, event.currentTarget), 'asset-row-actions');
      more.setAttribute('aria-label', row.name + ' 的操作');
      more.setAttribute('aria-haspopup', 'menu');
      more.title = row.name + ' 的操作';
      more.append(svg('down'));
      actions.append(more);
      tr.append(actions);
      body.append(tr);
    }
    byId('asset-empty').hidden = !!visible.length;
    byId('asset-count').textContent = '共 ' + rows.length + ' 条 · 第 ' + state.page + ' / ' + totalPages + ' 页';
    byId('asset-prev').disabled = state.page === 1;
    byId('asset-next').disabled = state.page === totalPages;
    renderSelection();
    renderCrossResults(byId('asset-search').value.trim().toLowerCase());
  }
  function switchView(key, keepQuery = false) {
    state.view = keys.includes(key) ? key : 'terminal';
    state.page = 1;
    state.filters = {};
    state.selected.clear();
    state.visibleFilters = new Set(pages[state.view].filters.filter((filter) => ['type', 'department', 'status', ...(state.view === 'infrastructure' ? ['location'] : [])].includes(filter.key)).map((filter) => filter.key));
    byId('asset-view').value = state.view;
    const createLabel = '新增' + pages[state.view].label;
    byId('asset-create-label').textContent = createLabel;
    byId('asset-create-summary').setAttribute('aria-label', createLabel);
    byId('asset-create-summary').title = createLabel;
    byId('include-archived').checked = false;
    if (!keepQuery) byId('asset-search').value = '';
    document.querySelectorAll('dialog[open]').forEach((dialog) => dialog.close());
    document.querySelectorAll('details').forEach((detail) => detail.open = false);
    history.replaceState(null, '', '#' + state.view);
    renderFilters();
    renderTable();
  }
  function addHistory(root, row) {
    const section = element('section', 'asset-section detail-section');
    const heading = element('h3', '', '运维履历（示例）');
    heading.prepend(svg('history'));
    section.append(heading);
    if (Array.isArray(row.history)) {
      const list = element('ol', 'prototype-history');
      for (const item of row.history) {
        const li = document.createElement('li');
        li.append(element('strong', '', item.date + ' · ' + item.title), element('div', '', item.text));
        list.append(li);
      }
      section.append(list);
    } else {
      const record = element('p', 'prototype-history', row.history || '当前示例未设置履历。');
      record.style.whiteSpace = 'pre-wrap';
      section.append(record);
    }
    root.append(section);
  }
  const detailHelpers = { element, button, svg, text, addHistory, netcattyAddress, netcattyBrowserUrl };
  function openDetail(row) {
    const config = pages[state.view];
    window.assetPrototypeDetail.show({
      view: state.view, config, row, helpers: detailHelpers,
      onEdit: () => openEditor(row),
      onOperation: (id) => {
        byId('asset-sheet').close();
        openOperation(row, config.operations.find((operation) => operation.id === id));
      },
    });
  }
  function buildFields(root, groups, values, prefix) {
    root.replaceChildren();
    for (const group of groups) {
      const visible = visibleFields(group, values);
      if (!visible.length) continue;
      const section = element('section', 'asset-section');
      const heading = element('h3', '', group.title);
      heading.prepend(svg(window.assetPrototypeDetail.groupIcon(group.title)));
      section.append(heading);
      const fields = element('div', 'fields');
      for (const field of visible) {
        fields.append(window.assetPrototypeForm.createField(field, values, prefix + '-' + field.key, () => buildFields(root, groups, values, prefix)));
      }
      section.append(fields);
      root.append(section);
    }
  }
  function openEditor(row = null) {
    const config = pages[state.view];
    if (!row) {
      window.assetPrototypeCreate.show({ view: state.view, config });
      return;
    }
    const values = { ...row };
    window.assetPrototypeDetail.prepareEditor({ view: state.view, row: values, title: '编辑' + config.label, helpers: detailHelpers });
    const form = window.assetPrototypeForm.renderForm({ root: byId('asset-sheet-body'), view: state.view, config, values, prefix: 'asset-field', mode: 'edit' });
    const save = element('button', 'primary', '保存（离线不可用）');
    save.disabled = true;
    save.title = '离线原型未接入保存，不会修改资产';
    byId('asset-sheet-footer').replaceChildren(element('span', 'asset-form-offline', '离线原型 · 不会保存'), button('取消', form.requestClose), save);
    if (!byId('asset-sheet').open) byId('asset-sheet').showModal();
  }
  function openOperation(row, operation) {
    byId('asset-actions').close();
    if (operation.id === 'edit') { openEditor(row); return; }
    const root = byId('asset-operation-body');
    root.replaceChildren();
    byId('asset-operation-title').textContent = operation.label + ' · 原型预览';
    if (operation.id === 'history') addHistory(root, row);
    else {
      buildFields(root, [{ title: row.name || '当前所选资产', fields: operation.fields || [] }], { ...row }, 'operation-field');
      if (operation.id === 'archive') root.append(element('p', 'dialog-note', '注销后保留资产资料和履历，可通过“含已注销”查回。此原型不会注销资产。'));
    }
    root.append(element('p', 'dialog-note', '设计示例，确认操作未接入。'));
    byId('asset-operation').showModal();
  }
  function openActions(row, anchor) {
    const dialog = byId('asset-actions');
    const root = byId('asset-actions-body');
    root.replaceChildren();
    const operations = pages[state.view].operations;
    const groups = [
      [{ label: '查看详情', run: () => { dialog.close(); openDetail(row); } }, ...operations.filter((operation) => operation.id === 'edit').map((operation) => ({ label: '编辑资产', run: () => openOperation(row, operation) }))],
      operations.filter((operation) => !['edit', 'archive'].includes(operation.id)).map((operation) => ({ label: operation.label, run: () => openOperation(row, operation) })),
      operations.filter((operation) => operation.id === 'archive').map((operation) => ({ label: operation.label, run: () => openOperation(row, operation), danger: true })),
    ].filter((group) => group.length);
    groups.forEach((group) => {
      const section = element('div', 'asset-actions-group');
      section.setAttribute('role', 'group');
      for (const item of group) {
        const entry = button(item.label, item.run, item.danger ? 'danger' : '');
        entry.setAttribute('role', 'menuitem');
        section.append(entry);
      }
      root.append(section);
    });
    if (dialog.open) dialog.close();
    dialog.show();
    const rect = anchor?.getBoundingClientRect();
    if (rect) {
      dialog.style.top = Math.min(rect.bottom + 4, window.innerHeight - dialog.offsetHeight - 8) + 'px';
      dialog.style.left = Math.max(8, rect.right - dialog.offsetWidth) + 'px';
    }
    root.querySelector('button')?.focus();
  }

  byId('asset-view').addEventListener('change', () => switchView(byId('asset-view').value, true));
  byId('asset-search').addEventListener('input', () => { state.page = 1; renderTable(); });
  byId('asset-filter-reset').addEventListener('click', () => { state.filters = {}; state.page = 1; byId('asset-search').value = ''; renderFilters(); renderTable(); });
  byId('include-archived').addEventListener('change', () => { state.page = 1; renderTable(); });
  byId('asset-page-size').addEventListener('change', () => { state.page = 1; renderTable(); });
  byId('asset-prev').addEventListener('click', () => { state.page--; renderTable(); });
  byId('asset-next').addEventListener('click', () => { state.page++; renderTable(); });
  byId('asset-selection-clear').addEventListener('click', () => { state.selected.clear(); renderTable(); });
  byId('asset-batch-preview').addEventListener('click', () => openOperation({}, { id: 'batch', label: '批量修改', fields: [{ key: 'status', label: '设备状态', kind: 'select', options: [...new Set(pages[state.view].rows.map((row) => row.status))] }] }));
  byId('filter-toggle').addEventListener('click', () => {
    byId('asset-filter-bar').hidden = !byId('asset-filter-bar').hidden;
    byId('filter-toggle').setAttribute('aria-expanded', String(!byId('asset-filter-bar').hidden));
  });
  document.querySelectorAll('[data-create]').forEach((node) => node.addEventListener('click', () => { switchView(node.dataset.create); openEditor(); }));
  document.querySelectorAll('[data-close]').forEach((node) => node.addEventListener('click', () => byId(node.dataset.close).close()));
  // 行操作菜单为非模态浮层：点击外部或按 Esc 关闭。
  document.addEventListener('pointerdown', (event) => {
    const menu = byId('asset-actions');
    if (menu.open && !menu.contains(event.target) && !event.target.closest('.asset-row-actions')) menu.close();
  });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && byId('asset-actions').open) byId('asset-actions').close(); });
  // 设置原型保存网络类型颜色后，列表色点按新颜色重绘。
  window.addEventListener('cmdb-prototype-network-types-changed', () => renderTable());
  document.querySelectorAll('details').forEach((detail) => detail.addEventListener('toggle', () => {
    if (detail.open) document.querySelectorAll('details[open]').forEach((other) => { if (other !== detail) other.open = false; });
  }));
  window.addEventListener('hashchange', () => switchView(location.hash.slice(1)));
  window.addEventListener('resize', sizeColumns);
  // 详情侧栏打开/关闭会改变列表可用宽度；列宽按当前容器重算，避免末列被侧栏遮住。
  const tableWrap = document.querySelector('.asset-table-wrap');
  if (tableWrap && typeof ResizeObserver === 'function') {
    let lastWidth = tableWrap.clientWidth;
    new ResizeObserver(() => {
      if (tableWrap.clientWidth === lastWidth) return;
      lastWidth = tableWrap.clientWidth;
      sizeColumns();
    }).observe(tableWrap);
  }
  switchView(location.hash.slice(1));
  const linkedAssetId = new URLSearchParams(location.search).get('asset');
  if (linkedAssetId) {
    const linkedAsset = pages[state.view].rows.find((row) => row.id === linkedAssetId);
    if (linkedAsset) openDetail(linkedAsset);
    else {
      byId('asset-global-results').hidden = false;
      byId('asset-global-results').textContent = '当前类别未找到所选示例资产：' + linkedAssetId;
    }
  }
})();

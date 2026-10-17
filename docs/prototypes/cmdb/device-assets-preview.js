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
  const matches = (row, query) => Object.values(row).filter((value) => typeof value === 'string' || typeof value === 'number').join(' ').toLowerCase().includes(query);
  function netcattyAddress(row, address, prefix = '') {
    const line = element('span', 'asset-address-line');
    const value = element('span', 'asset-address-value', prefix + text(address));
    value.title = prefix + text(address);
    line.append(value);
    if (address) {
      const connect = button('', () => {
        const root = byId('asset-operation-body');
        root.replaceChildren();
        byId('asset-operation-title').textContent = 'Netcatty 连接预览';
        const values = element('dl', 'asset-detail-values');
        for (const [label, content] of [['设备名称', row.name], ['连接地址', address], ['Netcatty 主机', '未关联'], ['密钥库引用', '未关联']]) {
          const entry = document.createElement('div');
          entry.append(element('dt', '', label), element('dd', '', content));
          values.append(entry);
        }
        const associate = element('button', '', '关联主机与密钥库（示意）');
        associate.disabled = true;
        root.append(values, associate, element('p', 'dialog-note', '设计原型，仅展示此 IP 的连接入口；不读取凭证或发起真实连接。'));
        byId('asset-operation').showModal();
      }, 'asset-netcatty-link');
      connect.prepend(svg('square-terminal'));
      connect.title = '使用 Netcatty 连接 ' + address + '（原型预览）';
      connect.setAttribute('aria-label', connect.title);
      line.append(connect);
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
      head.append(element('th', '', column.label));
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
          const link = button(value, () => openDetail(row), 'asset-primary');
          link.title = value;
          cell.append(link);
        } else if (column.kind === 'status') {
          const tone = /注销/.test(value) ? 'archived' : /故障|维修|维护|离线|停用/.test(value) ? 'warning' : /闲置|在库|待上线/.test(value) ? 'idle' : '';
          cell.append(element('span', 'asset-status ' + tone, value));
        } else if (column.kind === 'address') {
          cell.append(element('span', 'asset-access-address', value));
        } else if (state.view === 'terminal' && column.key === 'ip') {
          cell.append(netcattyAddress(row, row.ip, row.physical_ip ? '业务 ' : ''));
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
          const secondaryText = column.secondary === 'physical_ip' ? '终端 ' + row[column.secondary] : String(row[column.secondary]);
          const secondary = column.secondary === 'physical_ip' && state.view === 'terminal'
            ? netcattyAddress(row, row.physical_ip, '终端 ')
            : element('span', 'asset-secondary', secondaryText);
          secondary.classList.add('asset-secondary');
          secondary.title = secondaryText;
          cell.append(secondary);
        }
        tr.append(cell);
      }
      const actions = element('td', 'action-cell');
      const edit = button('', () => openEditor(row));
      edit.setAttribute('aria-label', '编辑 ' + row.name);
      edit.title = '编辑';
      edit.append(svg('edit'));
      const more = button('', () => openActions(row));
      more.setAttribute('aria-label', '更多操作 ' + row.name);
      more.title = '更多操作';
      more.append(svg('more'));
      actions.append(edit, more);
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
  const detailHelpers = { element, button, svg, text, addHistory, netcattyAddress };
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
    if (prefix === 'asset-field') {
      root.prepend(element('p', 'dialog-note', '表单可调整以预览布局；保存未接入，不修改业务资产。'));
      if (state.view === 'infrastructure' && !/虚拟机|virtual|云主机|容器/i.test(values.type || '')) {
        const photos = element('section', 'asset-section');
        window.assetPrototypeForm.appendPhotos(photos);
        root.append(photos);
      }
      if (state.view !== 'systems') window.assetPrototypeForm.appendCollection(root, values, () => buildFields(root, groups, values, prefix));
      window.assetPrototypeForm.appendCredentials(root, values, prefix);
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
    buildFields(byId('asset-sheet-body'), config.groups, values, 'asset-field');
    const save = element('button', 'primary', '保存（原型示意）');
    save.disabled = true;
    byId('asset-sheet-footer').replaceChildren(button('取消', () => byId('asset-sheet').close()), save);
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
  function openActions(row) {
    const root = byId('asset-actions-body');
    root.replaceChildren();
    root.append(button('查看详情', () => { byId('asset-actions').close(); openDetail(row); }));
    for (const operation of pages[state.view].operations) root.append(button(operation.label, () => openOperation(row, operation)));
    byId('asset-actions').showModal();
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
  document.querySelectorAll('details').forEach((detail) => detail.addEventListener('toggle', () => {
    if (detail.open) document.querySelectorAll('details[open]').forEach((other) => { if (other !== detail) other.open = false; });
  }));
  window.addEventListener('hashchange', () => switchView(location.hash.slice(1)));
  window.addEventListener('resize', sizeColumns);
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

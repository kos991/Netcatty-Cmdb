(() => {
  'use strict';

  // 仅使用本地虚构示例数据；表单草稿不修改组织目录。
  const types = { organization: '组织', department: '部门', group: '分组' };
  const personFields = { organization: 'org_id', department: 'department_id', group: 'group_id' };
  const nodes = [
    { id: 1, name: '星桥示例科技', node_type: 'organization', parent_id: 0, sort_order: 10 },
    { id: 11, name: '信息技术部', node_type: 'department', parent_id: 1, sort_order: 10 },
    { id: 111, name: '终端支持组', node_type: 'group', parent_id: 11, sort_order: 10 },
    { id: 112, name: '平台运维组', node_type: 'group', parent_id: 11, sort_order: 20 },
    { id: 12, name: '产品研发部', node_type: 'department', parent_id: 1, sort_order: 20 },
    { id: 121, name: '业务应用组', node_type: 'group', parent_id: 12, sort_order: 10 },
    { id: 122, name: '质量保障组', node_type: 'group', parent_id: 12, sort_order: 20 },
    { id: 13, name: '综合管理部', node_type: 'department', parent_id: 1, sort_order: 30 },
    { id: 131, name: '行政服务组', node_type: 'group', parent_id: 13, sort_order: 10 },
    { id: 2, name: '远山示例研究中心', node_type: 'organization', parent_id: 0, sort_order: 20 },
    { id: 21, name: '数据服务部', node_type: 'department', parent_id: 2, sort_order: 10 },
    { id: 211, name: '数据治理组', node_type: 'group', parent_id: 21, sort_order: 10 },
    { id: 212, name: '分析研究组', node_type: 'group', parent_id: 21, sort_order: 20 },
    { id: 22, name: '运营协作部', node_type: 'department', parent_id: 2, sort_order: 20 },
    { id: 221, name: '项目支持组', node_type: 'group', parent_id: 22, sort_order: 10 },
  ];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const childrenOf = (id) => nodes.filter((node) => node.parent_id === id).sort((a, b) => a.sort_order - b.sort_order);
  const treeOf = (id = 0) => childrenOf(id).map((node) => ({ ...node, children: treeOf(node.id) }));
  const tree = treeOf();
  const people = [
    [1, '林星禾', 1, 11, 111, '终端支持工程师', '在职'],
    [2, '陈予安', 1, 11, 112, '平台运维工程师', '在职'],
    [3, '周沐言', 1, 11, 111, '服务支持专员', '调休'],
    [4, '许若川', 1, 11, 112, '基础设施架构与可靠性工程师', '在职'],
    [5, '宋知遥', 1, 12, 121, '应用开发工程师', '在职'],
    [6, '沈亦舟', 1, 12, 121, '产品设计师', '在职'],
    [7, '顾清越', 1, 12, 122, '测试工程师', '调休'],
    [8, '唐书宁', 1, 12, 122, '质量保障专员', '离职'],
    [9, '陆闻溪', 1, 13, 131, '行政专员', '在职'],
    [10, '江映初', 1, 13, 0, '综合管理专员', '在职'],
    [11, '方景行', 2, 21, 211, '数据治理工程师', '在职'],
    [12, '叶舒然', 2, 21, 212, '数据分析师', '在职'],
    [13, '温以宁', 2, 21, 211, '数据质量专员', '调休'],
    [14, '白云岑', 2, 22, 221, '项目协调专员', '在职'],
    [15, '贺南乔', 2, 22, 221, '运营协作专员', '离职'],
    [16, '苏望川', 2, 0, 0, '研究顾问', '在职'],
    [17, '程念夏', 0, 0, 0, '待分配岗位', '在职'],
    [18, '孟时雨', 0, 0, 0, '待分配岗位', '调休'],
  ].map(([id, name, org_id, department_id, group_id, title, status]) => ({
    id, name, org_id, department_id, group_id, title, status,
    person_code: `DEMO-${String(id).padStart(4, '0')}`,
    org_name: byId.get(org_id)?.name || '',
    department: byId.get(department_id)?.name || '',
    group_name: byId.get(group_id)?.name || '',
    phone: `010-0000-${String(1000 + id)}`,
    remark: '虚构原型记录；电话为演示占位，不代表真实人员或联系方式。',
  }));
  const assets = [
    { person_id: 1, name: '示例办公笔记本 A', type: '笔记本', code: 'DEMO-TERM-001', status: '在用' },
    { person_id: 1, name: '示例显示器 A', type: '显示器', code: 'DEMO-TERM-002', status: '在用' },
    { person_id: 2, name: '示例运维工作站', type: '台式机', code: 'DEMO-TERM-003', status: '在用' },
    { person_id: 4, name: '示例移动工作站', type: '笔记本', code: 'DEMO-TERM-004', status: '在用' },
    { person_id: 5, name: '示例研发笔记本', type: '笔记本', code: 'DEMO-TERM-005', status: '在用' },
    { person_id: 11, name: '示例数据工作站', type: '台式机', code: 'DEMO-TERM-006', status: '在用' },
    { person_id: 14, name: '示例项目笔记本', type: '笔记本', code: 'DEMO-TERM-007', status: '在用' },
  ];

  const $ = (id) => document.getElementById(id);
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  const icon = (name) => `<svg aria-hidden="true"><use href="#${name}"/></svg>`;
  const pathOf = (id) => {
    const node = byId.get(Number(id));
    return node ? [...pathOf(node.parent_id), node] : [];
  };
  const countFor = (node, records) => records.filter((person) => person[personFields[node.node_type]] === node.id).length;
  const filteredTree = (branches, keyword) => {
    const term = keyword.trim().toLowerCase();
    if (!term) return branches;
    return branches.flatMap((node) => {
      if (node.name.toLowerCase().includes(term)) return [node];
      const children = filteredTree(node.children, term);
      return children.length ? [{ ...node, children }] : [];
    });
  };
  const state = { selectedId: 0, page: 1, pageSize: 10, collapsed: new Set(), maintenanceCollapsed: new Set(), detailId: 0, draft: null };
  const basePeople = () => {
    const term = $('people-search').value.trim().toLowerCase();
    const status = $('people-status').value;
    return people.filter((person) => (!status || person.status === status) && (!term || [person.name, person.person_code].some((value) => value.toLowerCase().includes(term))));
  };

  function treeMarkup(branches, context, records, depth = 0) {
    const maintenance = context === 'maintenance';
    const collapsed = maintenance ? state.maintenanceCollapsed : state.collapsed;
    const selectedId = maintenance ? state.draft?.id : state.selectedId;
    const searching = Boolean($(maintenance ? 'maintenance-search' : 'organization-search').value.trim());
    return branches.map((node) => {
      const hasChildren = node.children.length > 0;
      const expanded = searching || !collapsed.has(node.id);
      return `<div class="node-branch"><div class="node-row${node.id === selectedId ? ' selected' : ''}" style="--depth:${depth}">${hasChildren ? `<button type="button" class="node-toggle" data-node-toggle="${node.id}" aria-expanded="${expanded}" aria-label="${expanded ? '收起' : '展开'}${escape(node.name)}">${icon('chevron')}</button>` : '<span class="node-spacer" aria-hidden="true"></span>'}<button type="button" class="node-select" data-node-id="${node.id}" aria-pressed="${node.id === selectedId}" title="${escape(pathOf(node.id).map((entry) => entry.name).join(' / '))} · ${types[node.node_type]}（示例）">${icon('folder')}<span class="node-name">${escape(node.name)}</span>${maintenance ? `<span class="node-kind">${types[node.node_type]}</span>` : `<span class="node-count">${countFor(node, records)}</span>`}</button></div>${hasChildren && expanded ? treeMarkup(node.children, context, records, depth + 1) : ''}</div>`;
    }).join('');
  }

  function renderMainTree() {
    const records = basePeople();
    const visible = filteredTree(tree, $('organization-search').value);
    $('organization-tree').innerHTML = treeMarkup(visible, 'main', records);
    $('organization-empty').hidden = visible.length > 0;
    $('all-people').setAttribute('aria-pressed', String(state.selectedId === 0));
    $('all-people-count').textContent = records.length;
  }

  function renderPeople() {
    const selected = byId.get(state.selectedId);
    const records = basePeople().filter((person) => !selected || person[personFields[selected.node_type]] === selected.id);
    const pageCount = Math.max(1, Math.ceil(records.length / state.pageSize));
    state.page = Math.min(state.page, pageCount);
    const first = (state.page - 1) * state.pageSize;
    const cell = (value) => `<td title="${escape(value || '未分配')}">${escape(value || '未分配')}</td>`;
    $('people-table-body').innerHTML = records.slice(first, first + state.pageSize).map((person) => `<tr data-person-id="${person.id}"><td title="${escape(person.name)}（虚构示例）"><button type="button" class="person-name-button" data-person-detail="${person.id}" title="查看${escape(person.name)}的示例资料">${escape(person.name)}</button><small class="person-example">示例人员</small></td>${cell(person.person_code)}${cell(person.org_name)}${cell(person.department)}${cell(person.group_name)}${cell(person.title)}<td title="${escape(person.phone)}（虚构示例电话）">${escape(person.phone)}</td><td title="${person.status}"><span class="person-status${person.status === '离职' ? ' inactive' : person.status === '调休' ? ' leave' : ''}">${person.status}</span></td><td><button type="button" class="person-edit-button quiet" data-person-edit="${person.id}" aria-label="编辑${escape(person.name)}（原型表单）" title="编辑人员（原型表单）">${icon('edit')}编辑</button></td></tr>`).join('');
    $('people-empty').hidden = records.length > 0;
    $('people-scope').textContent = selected ? `${selected.name} · ${types[selected.node_type]}` : '全部人员';
    $('people-scope-path').textContent = selected ? `${pathOf(selected.id).map((node) => node.name).join(' / ')} · 示例人员` : '虚构示例人员 · 可点击姓名查看详情';
    $('people-result-count').textContent = `${records.length} 位示例人员`;
    $('people-page-info').textContent = `共 ${records.length} 人 · ${records.length ? first + 1 : 0}–${Math.min(first + state.pageSize, records.length)} · 第 ${state.page} / ${pageCount} 页`;
    $('people-prev').disabled = state.page === 1;
    $('people-next').disabled = state.page >= pageCount;
    $('people-table-body').parentElement.parentElement.scrollTop = 0;
  }

  function refreshPeople() { state.page = 1; renderMainTree(); renderPeople(); }

  function options(select, entries, selected, placeholder = '未分配') {
    select.innerHTML = `<option value="0">${escape(placeholder)}</option>${entries.map((node) => `<option value="${node.id}">${escape(node.label || node.name)}</option>`).join('')}`;
    select.value = String(entries.some((node) => node.id === Number(selected)) ? selected : 0);
  }

  function updatePersonPath() {
    const names = ['person-organization', 'person-department', 'person-group'].map((id) => byId.get(Number($(id).value))?.name).filter(Boolean);
    $('person-affiliation-preview').textContent = `归属预览：${names.join(' / ') || '未分配'}`;
  }

  function openPersonEditor(person = null) {
    if ($('person-detail').open) $('person-detail').close();
    $('person-form').reset();
    $('person-form').dataset.recordId = person ? String(person.id) : '';
    $('person-editor-title').textContent = person ? `编辑人员 · ${person.name}（原型）` : '新增人员（原型）';
    const fields = { 'person-name': 'name', 'person-code': 'person_code', 'person-title': 'title', 'person-phone': 'phone', 'person-status': 'status', 'person-remark': 'remark' };
    Object.entries(fields).forEach(([id, field]) => { $(id).value = person?.[field] || ''; });
    options($('person-organization'), childrenOf(0), person?.org_id);
    options($('person-department'), childrenOf(Number($('person-organization').value)), person?.department_id);
    // Only department children may be selected as groups; organization=0 has no departments.
    if (!$('person-organization').value || $('person-organization').value === '0') options($('person-department'), [], 0);
    options($('person-group'), Number($('person-department').value) ? childrenOf(Number($('person-department').value)) : [], person?.group_id);
    $('person-department').disabled = $('person-organization').value === '0';
    $('person-group').disabled = $('person-department').value === '0';
    updatePersonPath();
    $('person-editor').showModal();
  }

  $('person-organization').addEventListener('change', () => {
    const id = Number($('person-organization').value);
    options($('person-department'), id ? childrenOf(id) : [], 0);
    options($('person-group'), [], 0);
    $('person-department').disabled = !id;
    $('person-group').disabled = true;
    updatePersonPath();
  });
  $('person-department').addEventListener('change', () => {
    const id = Number($('person-department').value);
    options($('person-group'), id ? childrenOf(id) : [], 0);
    $('person-group').disabled = !id;
    updatePersonPath();
  });
  $('person-group').addEventListener('change', updatePersonPath);
  $('person-form').addEventListener('submit', (event) => event.preventDefault());

  let transferTarget = '';
  function renderPersonTab(key) {
    const person = people.find((record) => record.id === state.detailId);
    if (!person) return;
    transferTarget = $('person-transfer-target')?.value ?? transferTarget;
    document.querySelectorAll('[data-person-tab]').forEach((tab) => {
      const selected = tab.dataset.personTab === key;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    const panel = $('person-detail-body');
    panel.setAttribute('aria-labelledby', `person-tab-${key}`);
    const definition = (fields) => `<dl class="person-detail-values">${fields.map(([label, value]) => `<div><dt>${label}</dt><dd>${escape(value || '未分配')}</dd></div>`).join('')}</dl>`;
    const owned = assets.filter((asset) => asset.person_id === person.id);
    const titles = { profile: '人员资料', organization: '组织归属', assets: '名下资产', transfer: '资产交接' };
    let content = '';
    if (key === 'profile') {
      content = `${definition([['姓名', person.name], ['工号', person.person_code], ['岗位', person.title], ['电话', person.phone], ['状态', person.status]])}<section class="person-detail-note"><h4>备注</h4><p>${escape(person.remark)}</p></section><div class="person-detail-danger"><button type="button" disabled>删除人员（原型禁用）</button></div>`;
    } else if (key === 'organization') {
      const path = pathOf(person.group_id || person.department_id || person.org_id).map((node) => node.name).join(' / ');
      content = `${definition([['组织', person.org_name], ['部门', person.department], ['分组', person.group_name]])}<section class="person-detail-note"><h4>归属路径</h4><p>${escape(path || '未分配')}</p></section>`;
    } else if (key === 'assets') {
      content = `<p class="dialog-note">${owned.length} 项 · 虚构示例资产</p>${owned.length ? owned.map((asset) => `<article class="example-asset"><a href="device-assets-preview.html#terminal" title="打开终端资产示例列表，不代表此虚构资产的真实业务详情">${icon('monitor')} ${escape(asset.name)}</a><p>${escape(asset.code)} · ${escape(asset.type)} · ${escape(asset.status)}</p></article>`).join('') : '<p class="dialog-note">该示例人员没有名下示例资产。</p>'}<p class="dialog-note">资产链接仅打开设备资产终端原型；示例编码不对应真实业务记录。</p>`;
    } else {
      content = `<p class="dialog-note">当前名下 ${owned.length} 项示例资产。仅预览交接表单，不写入业务数据。</p><div class="asset-transfer-preview field"><label for="person-transfer-target">接收人（原型表单）</label><select id="person-transfer-target"><option value="">选择接收人</option>${people.filter((record) => record.id !== person.id).map((record) => `<option value="${record.id}"${String(record.id) === transferTarget ? ' selected' : ''}>${escape(record.name)} · ${escape(record.department || record.org_name || '未分配')}（示例）</option>`).join('')}</select><button type="button" disabled>交接资产（原型禁用）</button></div>`;
    }
    panel.innerHTML = `<h3 class="person-detail-section-title">${titles[key]}</h3>${content}`;
    panel.scrollTop = 0;
  }
  function setPersonExpanded(expanded) {
    $('person-detail').classList.toggle('expanded', expanded);
    const button = $('person-detail-expand');
    const label = expanded ? '还原人员详情' : '展开人员详情';
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', String(expanded));
    button.title = label;
    button.innerHTML = icon(expanded ? 'minimize' : 'maximize');
  }
  function openPersonDetail(person) {
    state.detailId = person.id;
    transferTarget = '';
    $('person-detail-title').textContent = person.name;
    $('person-detail-code').textContent = `${person.person_code} · 示例人员`;
    $('person-detail-status').textContent = person.status;
    $('person-detail-status').className = `person-status${person.status === '调休' ? ' leave' : person.status === '离职' ? ' inactive' : ''}`;
    setPersonExpanded(false);
    renderPersonTab('profile');
    $('person-detail').showModal();
  }
  document.querySelector('.person-detail-tabs').addEventListener('click', (event) => {
    const tab = event.target.closest('[data-person-tab]');
    if (tab) renderPersonTab(tab.dataset.personTab);
  });
  document.querySelector('.person-detail-tabs').addEventListener('keydown', (event) => {
    const tabs = [...document.querySelectorAll('[data-person-tab]')];
    const index = tabs.indexOf(event.target);
    if (index < 0 || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1) + tabs.length) % tabs.length;
    renderPersonTab(tabs[next].dataset.personTab);
    tabs[next].focus();
  });
  $('person-detail-expand').addEventListener('click', () => setPersonExpanded(!$('person-detail').classList.contains('expanded')));

  function renderMaintenanceTree() {
    const visible = filteredTree(tree, $('maintenance-search').value);
    $('maintenance-tree').innerHTML = treeMarkup(visible, 'maintenance', people);
    $('maintenance-empty').hidden = visible.length > 0;
  }

  function renderNodePath() {
    const draft = state.draft;
    const ancestors = draft.node_type === 'organization' ? [] : pathOf(Number($('organization-node-parent').value)).map((node) => node.name);
    $('organization-node-path').textContent = `节点路径预览：${[...ancestors, $('organization-node-name').value.trim() || '未命名节点'].join(' / ')}${draft.id ? ` · 示例节点 ID ${draft.id}` : ' · 尚未保存的原型表单'}`;
  }

  function renderNodeEditor() {
    const draft = state.draft;
    $('organization-node-heading').textContent = `${draft.id ? '编辑' : '新增'}${types[draft.node_type]}（原型）`;
    $('organization-node-name').value = draft.name;
    $('organization-node-type').value = draft.node_type;
    $('organization-node-type').disabled = Boolean(draft.id);
    const parentType = { department: 'organization', group: 'department' }[draft.node_type];
    if (parentType) {
      options($('organization-node-parent'), nodes.filter((node) => node.node_type === parentType).map((node) => ({ ...node, label: pathOf(node.id).map((entry) => entry.name).join(' / ') })), draft.parent_id, `请选择上级${types[parentType]}`);
    } else {
      $('organization-node-parent').innerHTML = '<option value="0">顶级组织</option>';
    }
    $('organization-node-parent').disabled = !parentType;
    $('organization-node-sort').value = draft.sort_order;
    $('organization-node-count').value = `${draft.id ? countFor(draft, people) : 0} 人（示例）`;
    const childType = { organization: 'department', department: 'group' }[draft.node_type];
    $('organization-add-child').textContent = childType ? `新增${types[childType]}` : '无下级节点';
    $('organization-add-child').disabled = !draft.id || !childType;
    renderNodePath();
    renderMaintenanceTree();
  }

  function beginNode(nodeType, parentId = 0) {
    state.draft = { id: 0, name: '', node_type: nodeType, parent_id: parentId, sort_order: 0 };
    renderNodeEditor();
    $('organization-node-name').focus();
  }

  function openMaintenance() {
    $('maintenance-search').value = '';
    state.maintenanceCollapsed.clear();
    state.draft = { ...(byId.get(state.selectedId) || nodes[0]) };
    renderNodeEditor();
    $('organization-maintenance').showModal();
  }

  $('organization-node-form').addEventListener('submit', (event) => event.preventDefault());
  $('organization-node-type').addEventListener('change', () => {
    state.draft.node_type = $('organization-node-type').value;
    state.draft.parent_id = 0;
    renderNodeEditor();
  });
  $('organization-node-name').addEventListener('input', () => { state.draft.name = $('organization-node-name').value; renderNodePath(); });
  $('organization-node-parent').addEventListener('change', () => { state.draft.parent_id = Number($('organization-node-parent').value); renderNodePath(); });
  $('organization-node-sort').addEventListener('input', () => { state.draft.sort_order = $('organization-node-sort').value; });
  $('organization-add-root').addEventListener('click', () => beginNode('organization'));
  $('organization-add-child').addEventListener('click', () => {
    const childType = { organization: 'department', department: 'group' }[state.draft.node_type];
    if (state.draft.id && childType) beginNode(childType, state.draft.id);
  });
  $('maintenance-search').addEventListener('input', renderMaintenanceTree);

  function bindTree(containerId, maintenance) {
    $(containerId).addEventListener('click', (event) => {
      const toggle = event.target.closest('[data-node-toggle]');
      const selection = event.target.closest('[data-node-id]');
      if (toggle) {
        const id = Number(toggle.dataset.nodeToggle);
        const collapsed = maintenance ? state.maintenanceCollapsed : state.collapsed;
        collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id);
        maintenance ? renderMaintenanceTree() : renderMainTree();
        $(containerId).querySelector(`[data-node-toggle="${id}"]`)?.focus();
      } else if (selection) {
        const id = Number(selection.dataset.nodeId);
        if (maintenance) {
          state.draft = { ...byId.get(id) };
          renderNodeEditor();
        } else {
          state.selectedId = id;
          state.page = 1;
          renderMainTree();
          renderPeople();
        }
        $(containerId).querySelector(`[data-node-id="${id}"]`)?.focus();
      }
    });
  }
  bindTree('organization-tree', false);
  bindTree('maintenance-tree', true);

  $('people-search').addEventListener('input', refreshPeople);
  $('people-status').addEventListener('change', refreshPeople);
  $('people-filter-toggle').addEventListener('click', () => {
    $('people-status-filter').hidden = !$('people-status-filter').hidden;
    $('people-filter-toggle').setAttribute('aria-expanded', String(!$('people-status-filter').hidden));
  });
  $('organization-search').addEventListener('input', renderMainTree);
  $('all-people').addEventListener('click', () => { state.selectedId = 0; refreshPeople(); });
  $('people-reset').addEventListener('click', () => {
    $('people-search').value = '';
    $('people-status').value = '';
    $('organization-search').value = '';
    state.selectedId = 0;
    state.collapsed.clear();
    refreshPeople();
  });
  $('expand-organizations').addEventListener('click', () => { state.collapsed.clear(); renderMainTree(); });
  $('collapse-organizations').addEventListener('click', () => {
    // Clear the search so explicit collapse is not overridden by search expansion.
    $('organization-search').value = '';
    state.collapsed = new Set(nodes.filter((node) => childrenOf(node.id).length).map((node) => node.id));
    renderMainTree();
  });
  $('people-page-size').addEventListener('change', () => { state.pageSize = Number($('people-page-size').value); state.page = 1; renderPeople(); });
  $('people-prev').addEventListener('click', () => { state.page -= 1; renderPeople(); });
  $('people-next').addEventListener('click', () => { state.page += 1; renderPeople(); });
  $('people-table-body').addEventListener('click', (event) => {
    const detail = event.target.closest('[data-person-detail]');
    const edit = event.target.closest('[data-person-edit]');
    const id = Number(detail?.dataset.personDetail || edit?.dataset.personEdit);
    const person = people.find((record) => record.id === id);
    if (person) detail ? openPersonDetail(person) : openPersonEditor(person);
  });
  $('person-detail-edit').addEventListener('click', () => openPersonEditor(people.find((record) => record.id === state.detailId)));
  $('create-person').addEventListener('click', () => { $('people-create-menu').open = false; openPersonEditor(); });
  $('maintain-organizations').addEventListener('click', () => { $('people-create-menu').open = false; openMaintenance(); });
  document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => $(button.dataset.close).close()));
  document.addEventListener('click', (event) => {
    document.querySelectorAll('details[open]').forEach((menu) => { if (!menu.contains(event.target)) menu.open = false; });
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') document.querySelectorAll('details[open]').forEach((menu) => { menu.open = false; });
  });

  renderMainTree();
  renderPeople();
})();

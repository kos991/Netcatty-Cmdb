(() => {
  'use strict';

  const byOrder = (left, right) => Number(left.sort_order || 0) - Number(right.sort_order || 0) || left.id - right.id;
  const buildTree = (entries) => {
    const ordered = [...entries].sort(byOrder);
    const byId = new Map(ordered.map((entry) => [entry.id, { ...entry, children: [] }]));
    const roots = [];
    ordered.forEach((entry) => {
      const node = byId.get(entry.id), parent = byId.get(entry.parent_id);
      if (parent && parent.id !== node.id) parent.children.push(node);
      else roots.push(node);
    });
    return roots;
  };
  const filterTree = (nodes, query) => !query ? nodes : nodes.flatMap((node) => {
    const children = filterTree(node.children, query);
    return node.name.toLocaleLowerCase().includes(query) || children.length ? [{ ...node, children }] : [];
  });
  const excludedParents = (entries, currentId) => {
    const excluded = new Set(currentId ? [currentId] : []);
    let changed = true;
    while (changed) {
      changed = false;
      entries.forEach((entry) => {
        if (excluded.has(entry.parent_id) && !excluded.has(entry.id)) {
          excluded.add(entry.id);
          changed = true;
        }
      });
    }
    return excluded;
  };

  function mount({ host, catalogs, icon, escape, button, close, projectLabel }) {
    host.insertAdjacentHTML('beforeend', `
      <dialog id="cmdb-settings-catalog" class="cmdb-settings-catalog" aria-labelledby="cmdb-catalog-title" aria-describedby="cmdb-catalog-context">
        <header class="dialog-header"><div><h2 id="cmdb-catalog-title"></h2><p id="cmdb-catalog-context" class="cmdb-catalog-context"></p></div>${close('cmdb-settings-catalog')}</header>
        <div class="cmdb-catalog-layout">
          <aside class="cmdb-catalog-directory" aria-label="项目目录预览">
            <div class="cmdb-catalog-tools">
              <label class="cmdb-catalog-search">${icon('search')}<input id="cmdb-catalog-search" type="search" autocomplete="off" aria-label="搜索项目目录"></label>
              <div class="cmdb-catalog-create">${button(icon('plus') + '<span>新增</span>', 'id="cmdb-catalog-new"')}${button(icon('folder') + '<span>新增子类</span>', 'id="cmdb-catalog-new-child" disabled')}</div>
            </div>
            <div id="cmdb-catalog-entries" class="cmdb-catalog-entries"></div>
          </aside>
          <section class="cmdb-catalog-editor" aria-labelledby="cmdb-catalog-editor-title">
            <div class="cmdb-catalog-editor-heading"><h3 id="cmdb-catalog-editor-title"></h3><p>可预览字段与层级选择，不写入项目配置。</p></div>
            <form id="cmdb-catalog-form"><div id="cmdb-catalog-fields" class="cmdb-catalog-fields"></div></form>
          </section>
        </div>
        <footer class="dialog-footer"><span class="cmdb-catalog-notice">项目目录示例 · 不读取真实记录，保存与删除不可用</span>${button('删除', 'id="cmdb-catalog-delete" disabled title="原型不删除项目配置"')}${button('保存', 'id="cmdb-catalog-save" class="primary" disabled title="原型不保存项目配置"')}</footer>
      </dialog>`);
    const $ = (id) => host.querySelector('#' + id);
    const dialog = $('cmdb-settings-catalog');
    const search = $('cmdb-catalog-search');
    const entriesRoot = $('cmdb-catalog-entries');
    const newButton = $('cmdb-catalog-new');
    const childButton = $('cmdb-catalog-new-child');
    let activeKey = '', draft = null, tree = [], expanded = new Set();
    const catalog = () => catalogs[activeKey];
    const isTaxonomy = () => catalog().kind === 'taxonomy';

    function parentOptions() {
      const excluded = excludedParents(catalog().entries, draft.id);
      const options = [`<option value="0"${!draft.parent_id ? ' selected' : ''}>顶级分类</option>`];
      const append = (nodes, depth) => nodes.forEach((node) => {
        if (!excluded.has(node.id)) options.push(`<option value="${node.id}"${draft.parent_id === node.id ? ' selected' : ''}>${'　'.repeat(depth)}${escape(node.name)}</option>`);
        append(node.children, depth + 1);
      });
      append(tree, 0);
      return options.join('');
    }

    function renderFields() {
      $('cmdb-catalog-editor-title').textContent = (draft.id ? '编辑' : '新增') + catalog().title;
      $('cmdb-catalog-fields').innerHTML = catalog().fields.map((field) => {
        const id = 'cmdb-catalog-field-' + field.key;
        const required = field.required ? ' required' : '';
        const descriptionId = id + '-description';
        const description = field.description ? ` aria-describedby="${descriptionId}"` : '';
        let control;
        if (field.type === 'parent') control = `<select id="${id}" name="${field.key}">${parentOptions()}</select>`;
        else if (field.type === 'textarea') control = `<textarea id="${id}" name="${field.key}" rows="3"${required}${description}>${escape(draft[field.key])}</textarea>`;
        else control = `<input id="${id}" name="${field.key}" type="${field.type || 'text'}" value="${escape(draft[field.key])}"${required}${field.min !== undefined ? ` min="${field.min}"` : ''}${description}>`;
        return `<div class="cmdb-catalog-field"><label for="${id}">${field.label}${field.required ? '<span class="cmdb-catalog-required" aria-hidden="true"> *</span>' : ''}</label>${control}${field.description ? `<p id="${descriptionId}">${escape(field.description)}</p>` : ''}</div>`;
      }).join('');
      childButton.disabled = !draft.id;
    }

    function renderEntries() {
      const query = search.value.trim().toLocaleLowerCase();
      let content;
      if (isTaxonomy()) {
        const nodes = filterTree(tree, query);
        const renderNodes = (items, depth = 0) => `<ul class="cmdb-catalog-tree${depth ? ' cmdb-catalog-tree-children' : ''}">${items.map((node) => {
          const hasChildren = node.children.length > 0, isExpanded = expanded.has(node.id);
          const childId = 'cmdb-catalog-children-' + node.id;
          return `<li><div class="cmdb-catalog-node${draft.id === node.id ? ' is-selected' : ''}">${button(hasChildren ? icon('chevron') : '<span></span>', `class="cmdb-catalog-toggle${isExpanded ? ' is-expanded' : ''}" data-catalog-toggle="${node.id}" aria-label="${escape((isExpanded ? '收起' : '展开') + node.name)}"${hasChildren ? ` aria-expanded="${isExpanded}" aria-controls="${childId}"` : ' disabled tabindex="-1"'}`)}${button(icon('folder') + `<span>${escape(node.name)}</span>`, `class="cmdb-catalog-select" data-catalog-select="${node.id}" aria-pressed="${draft.id === node.id}"`)}</div>${hasChildren ? `<div id="${childId}"${isExpanded ? '' : ' hidden'}>${renderNodes(node.children, depth + 1)}</div>` : ''}</li>`;
        }).join('')}</ul>`;
        content = nodes.length ? renderNodes(nodes) : '';
      } else {
        const entries = catalog().entries.filter((entry) => catalog().fields.some((field) => String(entry[field.key] ?? '').toLocaleLowerCase().includes(query)));
        content = entries.length ? `<ul class="cmdb-catalog-list">${entries.map((entry) => {
          const model = activeKey === 'models';
          const name = model ? entry.model : entry.name;
          const detail = model ? entry.vendor : entry.remark;
          return `<li>${button(`<span class="cmdb-catalog-list-name">${escape(name)}</span><span class="cmdb-catalog-list-detail">${escape(detail)}</span>${!model ? `<span class="cmdb-catalog-list-sort" aria-label="排序 ${entry.sort_order}">${entry.sort_order}</span>` : ''}`, `class="cmdb-catalog-list-select" data-catalog-select="${entry.id}" aria-pressed="${draft.id === entry.id}"`)}</li>`;
        }).join('')}</ul>` : '';
      }
      entriesRoot.innerHTML = content || '<p class="cmdb-catalog-empty" role="status">没有匹配的目录示例。<br>可调整搜索，或新增一项预览。</p>';
    }

    function selectEntry(id) {
      const entry = catalog().entries.find((item) => item.id === id);
      draft = { ...entry };
      renderFields();
      renderEntries();
    }

    function beginCreate(parentId) {
      draft = Object.fromEntries(catalog().fields.map((field) => [field.key, '']));
      draft.id = 0;
      if (isTaxonomy()) draft.parent_id = parentId;
      renderFields();
      renderEntries();
      $('cmdb-catalog-fields').querySelector('input, select, textarea').focus();
    }

    entriesRoot.addEventListener('click', (event) => {
      const toggle = event.target.closest('[data-catalog-toggle]');
      const select = event.target.closest('[data-catalog-select]');
      if (toggle) {
        const id = Number(toggle.dataset.catalogToggle);
        if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
        renderEntries();
        entriesRoot.querySelector(`[data-catalog-toggle="${id}"]`).focus();
      } else if (select) {
        const id = Number(select.dataset.catalogSelect);
        selectEntry(id);
        entriesRoot.querySelector(`[data-catalog-select="${id}"]`).focus();
      }
    });
    search.addEventListener('input', () => {
      if (isTaxonomy() && search.value.trim()) expanded = new Set(catalog().entries.map((entry) => entry.id));
      renderEntries();
    });
    newButton.addEventListener('click', () => beginCreate(0));
    childButton.addEventListener('click', () => beginCreate(draft.id));
    $('cmdb-catalog-form').addEventListener('input', (event) => {
      const control = event.target;
      if (!control.name) return;
      draft[control.name] = control.name === 'parent_id' ? Number(control.value) : control.value;
    });

    return {
      open(key) {
        activeKey = key;
        tree = isTaxonomy() ? buildTree(catalog().entries) : [];
        expanded = new Set(catalog().entries.map((entry) => entry.id));
        search.value = '';
        search.placeholder = '搜索' + catalog().title;
        search.setAttribute('aria-label', '搜索' + catalog().title);
        $('cmdb-catalog-title').textContent = catalog().title;
        $('cmdb-catalog-context').textContent = `当前项目：${projectLabel} · 目录示例，非实际项目记录`;
        newButton.querySelector('span').textContent = isTaxonomy() ? '新增大类' : '新增';
        childButton.hidden = !isTaxonomy();
        if (catalog().entries.length) selectEntry(catalog().entries[0].id);
        else beginCreate(0);
        if (!dialog.open) dialog.showModal();
      },
    };
  }

  window.cmdbSettingsCatalogPreview = { mount };
})();

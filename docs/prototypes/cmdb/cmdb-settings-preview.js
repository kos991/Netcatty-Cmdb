(() => {
  'use strict';
  const openOnLoad = new URLSearchParams(location.search).get('settings') === 'cmdb';
  const icon = (name) => `<svg aria-hidden="true"><use href="#${name}"/></svg>`;
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const button = (label, attributes = '') => `<button type="button" ${attributes}>${label}</button>`;
  const close = (id) => button(icon('close'), `class="icon quiet" data-settings-close="${id}" aria-label="关闭${id === 'cmdb-settings' ? '设置' : '设置表单'}" title="关闭"`);
  const row = (id, label, description, control, keywords = '') => `<div class="cmdb-setting-row" id="${id}" data-setting-label="${label}" data-setting-keywords="${keywords}"><div><strong>${label}</strong><p title="${escape(description)}">${description}</p></div><div class="cmdb-setting-control">${control}</div></div>`;
  const section = (id, title, content, actions = '') => `<section class="cmdb-setting-section" id="${id}" aria-labelledby="${id}-title"><header><h3 id="${id}-title">${title}</h3>${actions}</header><div class="cmdb-setting-card">${content}</div></section>`;
  const toggle = (id, label) => button('<span></span>', `id="${id}" class="cmdb-native-switch" role="switch" aria-label="${label}（预览）" aria-checked="false"`);

  function initialize() {
    const catalogs = window.cmdbSettingsPreviewCatalogs;
    const $ = (id) => document.getElementById(id);
    const projectLabel = '当前项目';
    const catalogRow = (key) => {
      const catalog = catalogs[key];
      const summary = catalog.entries.slice(0, 3).map((entry) => entry.name || `${entry.vendor} / ${entry.model}`).join('、');
      return row('cmdb-row-' + key, catalog.title, summary + (catalog.entries.length > 3 ? '…' : ''), button('编辑', `data-settings-catalog="${key}" aria-label="编辑${catalog.title}"`), key === 'terminal' ? '终端 设备类型 云桌面 设备简称' : catalog.title);
    };
    const assetSection = section('cmdb-settings-assets', '资产类型',
      ['terminal', 'infrastructure', 'systems'].map(catalogRow).join('') +
      row('cmdb-row-naming', '终端命名', '名称留空时自动生成；补全前先预览，已有名称不覆盖', button('命名规则', 'data-settings-preview="naming"'), '设备简称 自动命名 流水号'));
    const networkSection = section('cmdb-settings-network', '网络与型号', ['network', 'models'].map(catalogRow).join(''));
    const workSection = section('cmdb-settings-work', '工单配置',
      row('cmdb-row-rule', '工单编号规则', '固定前缀、日期段、流水号位数和重置周期', button('编辑', 'id="cmdb-rule-open" aria-label="编辑工单编号规则"'), 'GD 编号 日期 流水号') +
      ['categories', 'operations', 'priorities'].map(catalogRow).join(''));
    const templateSection = section('cmdb-settings-templates', '导入模板',
      [['terminal', '终端资产'], ['infrastructure', '基础设施'], ['ip', 'IP 地址']].map(([key, name]) => row('cmdb-row-template-' + key, name, '下载模板后，在对应业务页导入；导出沿用查询条件', button(icon('download') + '下载模板', 'disabled title="离线原型不下载业务文件"'), '导入模板 ' + name)).join(''));
    const projectSection = section('cmdb-settings-project', '项目设置',
      row('cmdb-row-project-name', '项目名称', '资产、组织、地址池和工单归属同一当前项目', '<input id="cmdb-project-name" aria-label="项目名称" placeholder="由宿主当前项目提供">') +
      row('cmdb-row-project-code', '项目编码', '用于项目数据隔离和导入导出识别，不作为资产编码', '<input id="cmdb-project-code" aria-label="项目编码" placeholder="由宿主当前项目提供">'),
      button('保存设置', 'disabled title="离线原型不保存项目资料"'));
    const attachmentSection = section('cmdb-settings-attachments', '附件存储',
      row('cmdb-row-attachment-path', '附件管理路径', '按项目独立保存；目录、可写状态及容量由客户端读取', '<div class="cmdb-control-stack"><input readonly aria-label="附件管理路径" placeholder="未读取当前项目附件目录"><div>' + button('选择目录', 'data-settings-preview="attachment"') + button('恢复默认', 'class="quiet" data-settings-preview="attachment-default"') + '</div></div>', '附件 存储 路径 迁移 目录') +
      row('cmdb-row-attachment-sync', '附件同步', '本地保留明文附件；宿主已解锁且 S3 可用时加密补传', '<span class="cmdb-setting-value">跟随项目</span>', '附件 S3 加密'));
    const cloudSection = section('cmdb-settings-sync', '云同步',
      row('cmdb-row-sync', '同步 Cmdb 数据', '资产、组织及联系电话、IP、工单和履历统一随 Netcatty 云同步', toggle('cmdb-sync-enabled', '同步 Cmdb 数据'), '云同步 资产 组织 联系电话 人员 IP 工单 履历'));
    const maintenanceSection = section('cmdb-settings-maintenance', '数据维护',
      row('cmdb-row-legacy', '旧台账迁入', '将旧终端和基础设施资料迁入当前项目，已有记录跳过', button('查看迁入预览', 'data-settings-preview="legacy"'), '旧台账 数据维护 历史 迁入'));
    const groups = [['app-window', '应用'], ['database', 'Cmdb'], ['palette', '外观'], ['square-terminal', '终端'], ['keyboard', '快捷键'], ['file-type', 'SFTP 文件关联'], ['sparkles', 'AI'], ['cloud', '云同步'], ['hard-drive', '系统']];
    const panels = [
      { id: 'assets', label: '资产目录', icon: 'boxes', content: assetSection + networkSection },
      { id: 'work', label: '工单配置', icon: 'work-order', content: workSection },
      { id: 'templates', label: '导入模板', icon: 'download', content: templateSection },
      { id: 'project', label: '项目存储', icon: 'folder', content: projectSection + attachmentSection },
      { id: 'sync', label: '同步维护', icon: 'cloud', content: cloudSection + maintenanceSection },
    ];
    const host = document.createElement('div');
    host.innerHTML = `
      <dialog id="cmdb-settings" class="cmdb-settings-dialog" aria-labelledby="cmdb-settings-title">
        <header class="cmdb-settings-header"><h2 id="cmdb-settings-title">设置</h2>${close('cmdb-settings')}</header>
        <div class="cmdb-settings-layout">
          <aside class="cmdb-settings-nav" aria-label="宿主设置">
            <div class="cmdb-settings-search" id="cmdb-settings-search">
              ${button(icon('search') + '搜索设置', 'id="cmdb-settings-search-open" aria-label="搜索 Cmdb 设置"')}
              <div class="cmdb-settings-search-input" hidden>${icon('search')}<input id="cmdb-settings-search-input" type="search" placeholder="搜索 Cmdb 设置" aria-label="搜索 Cmdb 设置" role="combobox" aria-controls="cmdb-settings-search-results" aria-expanded="true" aria-autocomplete="list" autocomplete="off">${button(icon('close'), 'id="cmdb-settings-search-close" class="icon quiet" aria-label="收起设置搜索"')}</div>
              <div id="cmdb-settings-search-results" role="listbox" hidden></div>
            </div>
            ${groups.map(([glyph, name]) => `<span class="cmdb-host-setting${name === 'Cmdb' ? ' cmdb-host-setting--active' : ''}"${name === 'Cmdb' ? ' aria-current="page"' : ''}>${icon(glyph)}${name}</span>`).join('')}
          </aside>
          <main class="cmdb-settings-main"><header class="cmdb-settings-heading"><div>${icon('database')}<h2>Cmdb</h2><span class="cmdb-version-badge" data-version-kind="unknown"><span class="cmdb-version-tag" title="正式客户端读取内置服务的真实发布 tag（如 v1.3.1）；未打 tag 的构建显示“开发构建”。原型不读取版本。">${icon('tag')}<span>版本未读取（原型）</span></span>${button(icon('refresh') + '<span>检查更新</span>', 'id="cmdb-version-check" class="cmdb-version-check"')}<span id="cmdb-version-note" class="cmdb-version-note" role="status"></span></span></div><span>Netcatty 当前项目</span></header>
            <nav class="cmdb-settings-tabs" role="tablist" aria-label="Cmdb 配置分区">${panels.map((panel, index) => button(icon(panel.icon) + panel.label, `role="tab" id="cmdb-settings-tab-${panel.id}" data-settings-tab="${panel.id}" aria-controls="cmdb-settings-panel-${panel.id}" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}"`)).join('')}</nav>
            <div class="cmdb-settings-panels">${panels.map((panel, index) => `<div class="cmdb-settings-panel" id="cmdb-settings-panel-${panel.id}" data-settings-panel="${panel.id}" role="tabpanel" aria-labelledby="cmdb-settings-tab-${panel.id}" tabindex="0"${index ? ' hidden' : ''}>${panel.content}</div>`).join('')}</div>
          </main>
        </div>
        <footer class="cmdb-settings-footer">离线设计原型 · 目录为结构样例，不读取项目数据或执行保存 · 仅展示 Cmdb 设置</footer>
      </dialog>`;
    document.body.append(host);
    const helpers = { host, catalogs, icon, escape, button, close, projectLabel };
    const catalogController = window.cmdbSettingsCatalogPreview.mount(helpers);
    const operations = window.cmdbSettingsOperationsPreview.mount(helpers);
    // 原型不联网：检查更新只提示正式客户端行为，不伪造“已是最新”或新版本号。
    $('cmdb-version-check').addEventListener('click', () => { $('cmdb-version-note').textContent = '原型不联网；正式客户端通过 Netcatty 更新通道检查'; });

    function showPanel(id, focus = false) {
      for (const panel of panels) {
        const selected = panel.id === id;
        const tab = $('cmdb-settings-tab-' + panel.id);
        tab.setAttribute('aria-selected', String(selected));
        tab.tabIndex = selected ? 0 : -1;
        $('cmdb-settings-panel-' + panel.id).hidden = !selected;
      }
      if (focus) $('cmdb-settings-tab-' + id).focus();
    }
    host.querySelectorAll('[data-settings-tab]').forEach((tab, index) => {
      tab.addEventListener('click', () => showPanel(tab.dataset.settingsTab));
      tab.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? panels.length - 1
          : (index + (event.key === 'ArrowRight' ? 1 : -1) + panels.length) % panels.length;
        showPanel(panels[next].id, true);
      });
    });

    const windowActions = document.querySelector('.window-actions');
    const settingsButton = document.createElement('button');
    settingsButton.type = 'button';
    settingsButton.className = 'cmdb-host-settings-button';
    settingsButton.setAttribute('aria-label', '设置');
    settingsButton.title = '设置 · Cmdb';
    settingsButton.innerHTML = icon('settings');
    settingsButton.addEventListener('click', () => $('cmdb-settings').showModal());
    windowActions.removeAttribute('aria-hidden');
    windowActions.querySelector('svg').replaceWith(settingsButton);
    host.querySelectorAll('[data-settings-close]').forEach((control) => control.addEventListener('click', () => $(control.dataset.settingsClose).close()));
    host.querySelectorAll('form').forEach((form) => form.addEventListener('submit', (event) => event.preventDefault()));
    host.querySelectorAll('[data-settings-catalog]').forEach((control) => control.addEventListener('click', () => catalogController.open(control.dataset.settingsCatalog)));
    host.querySelectorAll('[data-settings-preview]').forEach((control) => control.addEventListener('click', () => operations.openPreview(control.dataset.settingsPreview)));
    $('cmdb-rule-open').addEventListener('click', () => operations.openRule());
    $('cmdb-sync-enabled').addEventListener('click', (event) => {
      const control = event.currentTarget;
      control.setAttribute('aria-checked', String(control.getAttribute('aria-checked') !== 'true'));
    });

    const search = $('cmdb-settings-search-input'), results = $('cmdb-settings-search-results');
    const searchBox = search.parentElement, searchOpen = $('cmdb-settings-search-open');
    const entries = [...host.querySelectorAll('.cmdb-setting-row')].map((element) => ({
      element, label: element.dataset.settingLabel,
      section: element.closest('section').querySelector('h3').textContent,
      text: (element.dataset.settingLabel + ' ' + element.dataset.settingKeywords + ' ' + element.querySelector('p').textContent).toLowerCase(),
    }));
    let matches = [], active = 0;
    function collapseSearch(restoreFocus = false) {
      search.value = '';
      searchBox.hidden = true;
      results.hidden = true;
      results.replaceChildren();
      searchOpen.hidden = false;
      search.removeAttribute('aria-activedescendant');
      if (restoreFocus) searchOpen.focus();
    }
    function selectResult(index) {
      const entry = matches[index];
      if (!entry) return;
      collapseSearch();
      showPanel(entry.element.closest('[data-settings-panel]').dataset.settingsPanel);
      entry.element.scrollIntoView({ block: 'center' });
      entry.element.tabIndex = -1;
      entry.element.classList.add('cmdb-setting-row--focused');
      entry.element.focus({ preventScroll: true });
      entry.element.addEventListener('blur', () => entry.element.classList.remove('cmdb-setting-row--focused'), { once: true });
    }
    function setActive(index) {
      active = index;
      [...results.querySelectorAll('[role=option]')].forEach((option, i) => option.setAttribute('aria-selected', String(i === active)));
      if (matches.length) search.setAttribute('aria-activedescendant', 'cmdb-search-hit-' + active);
      else search.removeAttribute('aria-activedescendant');
    }
    function renderSearch() {
      const query = search.value.trim().toLowerCase();
      matches = entries.filter((entry) => !query || (entry.text + ' ' + entry.section).toLowerCase().includes(query)).slice(0, 12);
      results.replaceChildren();
      matches.forEach((entry, index) => {
        const control = document.createElement('button');
        control.type = 'button';
        control.id = 'cmdb-search-hit-' + index;
        control.setAttribute('role', 'option');
        control.innerHTML = `<strong>${escape(entry.label)}</strong><small>Cmdb · ${escape(entry.section)}</small>`;
        control.addEventListener('click', () => selectResult(index));
        control.addEventListener('mouseenter', () => setActive(index));
        results.append(control);
      });
      if (!matches.length) {
        const empty = document.createElement('p');
        empty.textContent = '没有匹配的 Cmdb 配置';
        results.append(empty);
      }
      setActive(0);
    }
    searchOpen.addEventListener('click', () => {
      searchOpen.hidden = true; searchBox.hidden = false; results.hidden = false;
      renderSearch(); search.focus();
    });
    $('cmdb-settings-search-close').addEventListener('click', () => collapseSearch(true));
    search.addEventListener('input', renderSearch);
    search.addEventListener('keydown', (event) => {
      if (event.isComposing) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); collapseSearch(true); }
      else if (matches.length && ['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) {
        event.preventDefault();
        if (event.key === 'Enter') selectResult(active);
        else setActive((active + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length);
      }
    });
    $('cmdb-settings').addEventListener('pointerdown', (event) => {
      if (!$('cmdb-settings-search').contains(event.target)) collapseSearch();
    });
    $('cmdb-settings').addEventListener('close', () => collapseSearch());
    if (openOnLoad) $('cmdb-settings').showModal();
  }
  document.addEventListener('DOMContentLoaded', initialize, { once: true });
})();

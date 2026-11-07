/* Standalone browser host: retained documents, no business service or desktop API. */
(() => {
  'use strict';
  const paths = { assets: 'device-assets-preview.html#terminal', organization: 'organization-preview.html', racks: 'rack-layout-preview.html', network: 'network-preview.html', tickets: 'work-order-preview.html' };
  const titles = { assets: '设备资产', organization: '组织架构', racks: '机柜', network: '网络', tickets: '工单与统计', settings: '设置' };
  const content = document.querySelector('.content'), settings = document.getElementById('standalone-settings');
  const tabs = [], tablist = document.querySelector('.workspace-tabs'), add = document.querySelector('.tab-add'), menu = document.getElementById('tab-menu'), context = document.getElementById('tab-context');
  let activeTab, secondary, serial = 0;
  const searchSelector = '.toolbar > .search input, #cmdb-settings-search-input, #cmdb-catalog-search, .pool-editor-search input, .tree-search input';
  const button = (label, run) => { const node = document.createElement('button'); node.type = 'button'; node.textContent = label; node.addEventListener('click', run); return node; };
  let theme = 'dark';
  try { const saved = localStorage.getItem('cmdb-record-preview-theme'); if (['dark', 'light'].includes(saved)) theme = saved; } catch { /* Storage may be unavailable in file previews. */ }
  function applyTheme() {
    document.documentElement.dataset.previewTheme = theme;
    document.documentElement.style.colorScheme = theme;
    tabs.forEach(tab => { if (tab.frame?.contentDocument) { const root = tab.frame.contentDocument.documentElement; root.dataset.previewTheme = theme; root.style.colorScheme = theme; } });
  }
  function placeMenu(menuNode, anchor, win = window) {
    const rect = anchor.getBoundingClientRect(), gap = 4, margin = 8;
    menuNode.style.position = 'fixed'; menuNode.style.bottom = 'auto'; menuNode.style.right = 'auto';
    menuNode.style.maxWidth = `${win.innerWidth - margin * 2}px`;
    menuNode.style.maxHeight = `${win.innerHeight - margin * 2}px`;
    menuNode.style.overflowY = 'auto'; menuNode.style.overscrollBehavior = 'contain';
    const height = menuNode.scrollHeight, below = win.innerHeight - rect.bottom - gap - margin, above = rect.top - gap - margin;
    const up = height > below && above > below, available = Math.max(32, up ? above : below);
    menuNode.style.maxHeight = `${available}px`;
    const box = menuNode.getBoundingClientRect();
    menuNode.style.top = `${Math.max(margin, up ? rect.top - gap - box.height : rect.bottom + gap)}px`;
    menuNode.style.left = `${Math.max(margin, Math.min(rect.left, win.innerWidth - box.width - margin))}px`;
  }
  function installMenus(doc) {
    const win = doc.defaultView;
    const position = detail => { const panel = detail.querySelector(':scope > .menu, :scope > .shell-menu'); if (panel && detail.open) placeMenu(panel, detail.querySelector('summary'), win); };
    doc.addEventListener('toggle', event => { if (event.target.matches('details')) position(event.target); }, true);
    doc.addEventListener('pointerdown', event => doc.querySelectorAll('details[open]').forEach(detail => { if (detail.querySelector(':scope > .menu, :scope > .shell-menu') && !detail.contains(event.target)) detail.open = false; }));
    doc.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      doc.querySelectorAll('details[open]').forEach(detail => { if (!detail.querySelector(':scope > .menu, :scope > .shell-menu')) return; detail.open = false; detail.querySelector('summary')?.focus({ preventScroll: true }); event.preventDefault(); });
    });
    win.addEventListener('resize', () => doc.querySelectorAll('details[open]').forEach(position));
    doc.addEventListener('scroll', event => { if (event.target.closest?.('.menu,.shell-menu')) return; doc.querySelectorAll('details[open]').forEach(position); }, true);
  }
  function decorateSearch(doc) {
    doc.querySelectorAll(searchSelector).forEach(input => {
      if (input.parentElement.querySelector('.search-shortcut')) return;
      input.setAttribute('aria-keyshortcuts', 'Control+f');
      const hint = doc.createElement('kbd'); hint.className = 'search-shortcut'; hint.textContent = 'Ctrl+F'; hint.setAttribute('aria-hidden', 'true'); input.parentElement.append(hint);
    });
  }
  function syncNetworkCatalog() {
    tabs.forEach(tab => { const target = tab.frame?.contentWindow; if (!target?.cmdbSettingsPreviewCatalogs) return; target.cmdbSettingsPreviewCatalogs.network.entries = window.cmdbSettingsPreviewCatalogs.network.entries.map(entry => ({ ...entry })); target.dispatchEvent(new target.Event('cmdb-prototype-network-types-changed')); });
  }
  window.addEventListener('cmdb-prototype-network-types-changed', syncNetworkCatalog);
  function rememberFocus(tab) { const doc = tab?.frame?.contentDocument; if (doc && doc.activeElement !== doc.body) tab.focus = doc.activeElement; }
  function renderTabs() {
    tablist.replaceChildren();
    tabs.forEach(tab => {
      const item = document.createElement('div'); item.className = 'workspace-tab' + (tab === activeTab ? ' active' : '');
      const select = button(titles[tab.page], () => activate(tab)); select.setAttribute('role', 'tab'); select.setAttribute('aria-selected', String(tab === activeTab)); select.setAttribute('aria-controls', tab.frame?.id || settings.id); select.tabIndex = tab === activeTab ? 0 : -1;
      select.addEventListener('keydown', event => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); const index = tabs.indexOf(tab); activate(tabs[event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length]); tablist.querySelector('[aria-selected=true]')?.focus({ preventScroll: true }); });
      const close = button('', () => closeTab(tab)); close.innerHTML = '<svg aria-hidden="true"><use href="#close"/></svg>'; close.className = 'tab-close'; close.setAttribute('aria-label', '关闭' + titles[tab.page] + '标签'); close.title = '关闭标签';
      item.append(select, close); item.addEventListener('contextmenu', event => { event.preventDefault(); context.replaceChildren(button(secondary ? '合并分栏' : '在右侧分栏显示', () => { context.classList.remove('open'); if (secondary) secondary = null; else if (tab.page !== 'settings' && tab !== activeTab && activeTab.page !== 'settings') secondary = tab; else { const other = tabs.find(item => item !== tab && item.page !== 'settings'); if (other && tab.page !== 'settings') { activeTab = other; secondary = tab; } } activate(activeTab); })); context.classList.add('open'); placeMenu(context, item); });
      tablist.append(item);
    });
  }
  function activate(tab) {
    rememberFocus(activeTab); activeTab = tab;
    if (tab === secondary || tab.page === 'settings') secondary = null;
    content.classList.toggle('split', Boolean(secondary));
    settings.hidden = tab.page !== 'settings';
    tabs.forEach(item => {
      if (!item.frame) return;
      const wasHidden = item.frame.hidden; item.frame.hidden = item !== tab && item !== secondary; item.frame.classList.toggle('secondary', item === secondary);
      if (wasHidden && !item.frame.hidden && item.frame.dataset.businessReady === 'true') { const win = item.frame.contentWindow; win.dispatchEvent(new win.Event('cmdb-prototype-visible')); }
    });
    document.querySelectorAll('.activitybar [data-page]').forEach(node => { const selected = node.dataset.page === tab.page; node.classList.toggle('active', selected); if (selected) node.setAttribute('aria-current', 'page'); else node.removeAttribute('aria-current'); });
    renderTabs();
    if (tab.focus?.isConnected) tab.focus.focus({ preventScroll: true });
  }
  function hasDraft(tab) { return [...tab.edits].some(([field, value]) => field.isConnected && (!field.closest('dialog') || field.closest('dialog').open) && field.value !== value); }
  function closeTab(tab) {
    if (hasDraft(tab) && !window.confirm('此标签有未保存的原型草稿，关闭后将丢失。确定关闭？')) return;
    const index = tabs.indexOf(tab); tabs.splice(index, 1); tab.frame?.remove(); if (secondary === tab) secondary = null;
    if (!tabs.length) { open('assets'); return; }
    activate(tab === activeTab ? tabs[Math.min(index, tabs.length - 1)] : activeTab);
  }
  function trackDrafts(doc, tab) {
    doc.addEventListener('focusin', event => { const field = event.target; if (!field.matches('input:not([type=search]),textarea,select') || !field.closest('dialog,.editor-panel') || field.disabled || field.readOnly || tab.edits.has(field)) return; tab.edits.set(field, field.value); });
    doc.addEventListener('close', event => { if (event.target.matches('dialog')) for (const field of tab.edits.keys()) if (event.target.contains(field)) tab.edits.delete(field); }, true);
  }
  function open(page, reuse = false) {
    const existing = tabs.find(tab => tab.page === page);
    if (existing && (reuse || page === 'settings')) { activate(existing); return; }
    const tab = { page, id: ++serial, edits: new Map() }; tabs.push(tab);
    if (page !== 'settings') {
      const frame = document.createElement('iframe'); tab.frame = frame; frame.className = 'business-frame'; frame.id = 'business-view-' + tab.id; frame.dataset.standalone = 'true'; frame.dataset.businessReady = 'false'; frame.style.visibility = 'hidden'; frame.title = titles[page] + '业务页面';
      frame.addEventListener('load', () => {
        const doc = frame.contentDocument; if (!doc) return;
        const root = doc.documentElement; root.style.setProperty('--navigation-width', '0px');
        const sheet = doc.createElement('link'); sheet.rel = 'stylesheet'; sheet.href = 'standalone-business-preview.css';
        sheet.addEventListener('load', () => { frame.dataset.businessReady = 'true'; frame.style.removeProperty('visibility'); const win = frame.contentWindow; if (!frame.hidden) win.dispatchEvent(new win.Event('cmdb-prototype-visible')); }, { once: true });
        doc.head.append(sheet, document.getElementById('standalone-search-style').cloneNode(true));
        const toolbar = doc.querySelector('.surface > .toolbar');
        if (toolbar) { doc.querySelector('.app').prepend(toolbar); const observer = new ResizeObserver(() => root.style.setProperty('--business-top', `${Math.ceil(toolbar.getBoundingClientRect().bottom)}px`)); observer.observe(toolbar); }
        decorateSearch(doc); installMenus(doc); trackDrafts(doc, tab); doc.addEventListener('keydown', shortcuts); applyTheme(); syncNetworkCatalog();
        // Preserve the source document when a business link opens another module.
        doc.addEventListener('click', event => { const link = event.target.closest('a[href]'); if (!link || link.target === '_blank' || event.ctrlKey || event.metaKey) return; const url = new URL(link.href); const targetPage = Object.keys(paths).find(key => new URL(paths[key], location.href).pathname === url.pathname); if (!targetPage || url.origin !== location.origin || url.pathname === doc.location.pathname) return; event.preventDefault(); open(targetPage, true); const target = activeTab.frame; if (url.hash) { if (target.dataset.businessReady === 'true') target.contentWindow.location.hash = url.hash; else target.addEventListener('load', () => { target.contentWindow.location.hash = url.hash; }, { once: true }); } });
      });
      frame.src = paths[page]; content.prepend(frame);
    } else trackDrafts(document, tab);
    activate(tab);
  }
  function shortcuts(event) {
    if (event.isComposing) return;
    if (event.key === 'Escape') context.classList.remove('open');
    if (!event.ctrlKey || event.altKey || event.metaKey) return;
    const key = event.key.toLowerCase();
    if (key === 't') { event.preventDefault(); add.open = true; menu.querySelector('button')?.focus({ preventScroll: true }); }
    else if (key === 'w') { event.preventDefault(); closeTab(activeTab); }
    else if (key === '\\') { event.preventDefault(); secondary = secondary ? null : tabs.find(tab => tab !== activeTab && tab.page !== 'settings'); activate(activeTab); }
    else if (key === 'f') {
      const doc = activeTab.page === 'settings' ? document : activeTab.frame.contentDocument, modal = doc.querySelector('dialog[open]');
      let input = [...(modal || doc).querySelectorAll(searchSelector)].find(node => node.checkVisibility() && !node.closest('[hidden]'));
      if (!input && !modal && activeTab.page === 'settings') { document.getElementById('cmdb-settings-search-open')?.click(); input = document.getElementById('cmdb-settings-search-input'); }
      if (input) { event.preventDefault(); input.focus({ preventScroll: true }); input.select(); }
    }
  }
  Object.keys(titles).forEach(page => menu.append(button(titles[page], () => { add.open = false; open(page); })));
  document.querySelectorAll('.activitybar [data-page]').forEach(node => node.addEventListener('click', () => open(node.dataset.page, true)));
  document.addEventListener('pointerdown', event => { if (!context.contains(event.target)) context.classList.remove('open'); });
  document.addEventListener('keydown', shortcuts); installMenus(document);
  window.addEventListener('beforeunload', event => { if (tabs.some(hasDraft)) { event.preventDefault(); event.returnValue = ''; } });
  document.addEventListener('DOMContentLoaded', () => { decorateSearch(document); const picker = document.getElementById('shell-theme'); picker.value = theme; picker.addEventListener('change', () => { theme = picker.value; applyTheme(); try { localStorage.setItem('cmdb-record-preview-theme', theme); } catch { /* Current session remains usable. */ } }); });
  applyTheme(); open('assets');
})();

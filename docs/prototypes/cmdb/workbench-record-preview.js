(() => {
  'use strict';
  if (window.parent !== window && window.parent.cmdbPrototype) return;
  if (window.frameElement?.id !== 'workbench-view') return;
  const original = document.getElementById('asset-sheet');
  const sheet = document.createElement('section');
  for (const attribute of original.attributes) sheet.setAttribute(attribute.name, attribute.value);
  sheet.classList.add('workbench-record');
  sheet.setAttribute('aria-label', '资产完整资料');
  sheet.hidden = true;
  sheet.append(...original.childNodes);
  original.replaceWith(sheet);
  const surface = document.querySelector('.surface');
  surface.append(sheet);
  let position;
  let opener;
  Object.defineProperty(sheet, 'open', { get: () => !sheet.hidden });
  sheet.show = () => {
    if (sheet.open) return;
    const list = document.querySelector('.asset-table-wrap');
    position = { top: list.scrollTop, left: list.scrollLeft };
    opener = document.activeElement;
    sheet.hidden = false;
    sheet.setAttribute('open', '');
    surface.classList.add('workbench-record-open');
    sheet.querySelector('#asset-sheet-body').scrollTop = 0;
    sheet.querySelector('[data-close="asset-sheet"]').focus({ preventScroll: true });
  };
  sheet.close = () => {
    if (!sheet.open) return;
    sheet.hidden = true;
    sheet.removeAttribute('open');
    surface.classList.remove('workbench-record-open');
    sheet.dispatchEvent(new Event('close'));
    const list = document.querySelector('.asset-table-wrap');
    list.scrollTop = position?.top || 0;
    list.scrollLeft = position?.left || 0;
    if (opener?.isConnected) opener.focus({ preventScroll: true });
  };
  const back = sheet.querySelector('[data-close="asset-sheet"]');
  back.className = 'quiet workbench-record-back';
  back.textContent = '返回列表';
  back.setAttribute('aria-label', '返回资产列表');
  sheet.querySelector('header').prepend(back);
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !sheet.open || document.querySelector('dialog[open]')) return;
    event.preventDefault();
    if (sheet._requestFormClose) sheet._requestFormClose();
    else sheet.close();
  });
  window.workbenchRecord = {
    sheet,
    canLeave: () => !sheet.open || !sheet._requestFormClose || sheet._requestFormClose(),
    prepareHeader({ editing, edit, extra, toolbar, headerActions }) {
      toolbar.hidden = true;
      headerActions.querySelector('.workbench-record-more')?.remove();
      const windowActions = headerActions.querySelector('#asset-header-actions');
      if (windowActions) windowActions.hidden = true;
      if (editing) return;
      edit.className = 'quiet workbench-record-edit';
      edit.textContent = '编辑资产';
      edit.hidden = false;
      const more = document.createElement('details');
      more.className = 'workbench-record-more';
      const summary = document.createElement('summary');
      summary.textContent = '更多操作';
      extra.className = 'menu';
      for (const control of extra.children) {
        control.className = 'quiet';
        control.append(document.createTextNode(control.getAttribute('aria-label')));
      }
      more.append(summary, extra);
      headerActions.append(edit, more);
    },
    renderSections({ tabs, root, nav, render }) {
      root.replaceChildren();
      root.removeAttribute('tabindex');
      nav.replaceChildren();
      nav.className = 'workbench-record-nav';
      nav.setAttribute('role', 'navigation');
      nav.setAttribute('aria-label', '资料分区');
      nav.removeAttribute('aria-orientation');
      nav.hidden = false;
      for (const tab of tabs) {
        const group = document.createElement('section');
        group.id = 'workbench-section-' + tab.key;
        group.className = 'workbench-record-section';
        group.setAttribute('aria-label', tab.label);
        root.append(group);
        render(tab.key, group);
        const anchor = document.createElement('a');
        anchor.href = '#' + group.id;
        anchor.textContent = tab.label;
        anchor.addEventListener('click', event => {
          event.preventDefault();
          root.scrollTo({ top: group.offsetTop - root.offsetTop, behavior: 'auto' });
          nav.querySelectorAll('a').forEach(link => link.removeAttribute('aria-current'));
          anchor.setAttribute('aria-current', 'location');
        });
        nav.append(anchor);
      }
      root.scrollTop = 0;
    },
  };
})();

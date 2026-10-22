/* Offline CMDB prototype theme only; no host or business API calls. */
(() => {
  const storageKey = 'cmdb-record-preview-theme';
  const root = document.documentElement;
  let theme = 'light';
  try {
    if (localStorage.getItem(storageKey) === 'dark') theme = 'dark';
  } catch {
    // File previews may disable storage; switching still works in this page.
  }

  // This script runs in <head>, before styles and the first rendered frame.
  root.dataset.previewTheme = theme;
  root.style.colorScheme = theme;

  document.addEventListener('DOMContentLoaded', () => {
    const windowActions = document.querySelector('.tabs > .window-actions');
    if (!windowActions) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'record-theme-toggle';
    button.className = 'icon quiet';
    button.style.cssText = 'width:28px;height:28px;align-self:center;margin-left:auto;padding:0;flex-shrink:0';
    button.innerHTML = '<svg aria-hidden="true"><use href="#system"/></svg>';
    const icon = button.querySelector('use');

    function updateButton() {
      const dark = root.dataset.previewTheme === 'dark';
      const label = dark ? '切换为浅色' : '切换为深色';
      button.setAttribute('aria-label', label);
      button.title = label;
      icon.setAttribute('href', dark ? '#monitor' : '#system');
    }

    button.addEventListener('click', () => {
      const nextTheme = root.dataset.previewTheme === 'dark' ? 'light' : 'dark';
      root.dataset.previewTheme = nextTheme;
      root.style.colorScheme = nextTheme;
      try {
        localStorage.setItem(storageKey, nextTheme);
      } catch {
        // Keep the current page usable when storage is unavailable.
      }
      updateButton();
    });

    updateButton();
    windowActions.style.marginLeft = '10px';
    windowActions.before(button);
  }, { once: true });
})();

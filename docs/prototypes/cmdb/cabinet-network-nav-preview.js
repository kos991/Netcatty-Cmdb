(() => {
  'use strict';
  const current = location.pathname.split('/').pop();
  const active = current === 'rack-layout-preview.html' ? 'rack' : current === 'network-preview.html' ? 'network' : '';
  const existing = document.querySelector('.rail [aria-label="机柜与网络"]');
  if (!existing) return;
  const parent = document.createElement('a');
  parent.href = 'rack-layout-preview.html';
  parent.className = 'cabinet-network-entry';
  parent.innerHTML = '<svg aria-hidden="true"><use href="#router"/></svg>';
  parent.setAttribute('aria-label', '机柜与网络');
  parent.title = '机柜与网络';
  if (active) parent.classList.add('selected');
  existing.replaceWith(parent);
  if (!active) return;
  const navigation = document.createElement('nav');
  navigation.className = 'cabinet-network-navigation';
  navigation.setAttribute('aria-label', '机柜与网络二级导航');
  for (const [key, label, icon, href] of [
    ['rack', '机柜', 'server', 'rack-layout-preview.html'],
    ['network', '网络', 'network', 'network-preview.html'],
  ]) {
    const link = document.createElement('a');
    link.href = href;
    link.setAttribute('aria-label', label);
    link.innerHTML = `<svg aria-hidden="true"><use href="#${icon}"/></svg><span>${label}</span>`;
    if (active === key) link.setAttribute('aria-current', 'page');
    navigation.append(link);
  }
  document.getElementById(active === 'rack' ? 'rack-toolbar' : 'pool-toolbar').prepend(navigation);
})();

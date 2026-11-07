(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const shared = window.parent !== window ? window.parent.cmdbPrototype : null;
  const grid = $('rack-grid');
  if (!grid) return;
  const panel = document.querySelector('#rack-content .editor-panel');
  const rackStage = $('rack-stage');
  const rackPair = $('rack-pair');
  const rackPanel = $('rack-left-panel') || document.querySelector('#rack-content .rack-panel-left') || document.querySelector('#rack-content .rack-panel');
  const middlePanel = $('rack-middle-panel');
  const rightPanel = $('rack-right-panel');
  const panelsBySide = { left: rackPanel, middle: middlePanel, right: rightPanel };
  const sideOrder = ['left', 'middle', 'right'];
  const toolbar = $('rack-toolbar');
  let rooms = [{ id: 'room-core', name: '核心机房' }, { id: 'room-backup', name: '备份机房' }];
  let cabinets = [
    { id: 'cab-a01', roomId: 'room-core', name: 'A01', total: 42 },
    { id: 'cab-a02', roomId: 'room-core', name: 'A02', total: 42 },
    { id: 'cab-a03', roomId: 'room-core', name: 'A03', total: 42 },
    { id: 'cab-backup-a01', roomId: 'room-backup', name: 'A01', total: 42 },
  ];
  let devices = [
    { id: 'hci-01', name: '虚拟化服务器 HCI-01', code: 'SRV-HCI-01', type: '服务器', vendor: 'Dell', model: 'PowerEdge R750', start: 39, height: 4, roomId: 'room-core', cabinetId: 'cab-a01' },
    { id: 'san-01', name: '存储设备 SAN-01', code: 'STO-SAN-01', type: '存储设备', vendor: 'Huawei', model: 'OceanStor 5310', start: 34, height: 4, roomId: 'room-core', cabinetId: 'cab-a01' },
    { id: 'sw-001', name: '汇聚交换机 SW-001', code: 'NET-SW-001', type: '交换机', vendor: 'H3C', model: 'S6850-56HF', start: 28, height: 2, roomId: 'room-core', cabinetId: 'cab-a02' },
    { id: 'sw-002', name: '接入交换机 SW-002', code: 'NET-SW-002', type: '交换机', vendor: 'H3C', model: 'S5130S-52S', start: 24, height: 2, roomId: 'room-core', cabinetId: 'cab-a01' },
    { id: 'sw-san-01', name: '存储交换机 SW-SAN-01', code: 'NET-SAN-01', type: '交换机', vendor: 'Huawei', model: 'CE6881-48S6CQ', start: 36, height: 2, roomId: 'room-core', cabinetId: 'cab-a03' },
    { id: 'bak-srv-01', name: '备份服务器 BAK-01', code: 'SRV-BAK-01', type: '服务器', vendor: 'Dell', model: 'PowerEdge R750xs', start: 30, height: 4, roomId: 'room-core', cabinetId: 'cab-a03' },
    { id: 'srv-1u-preview', name: '1U 服务器（示例）', code: 'PREVIEW-SRV-1U', type: '服务器', vendor: '', model: '', start: 32, height: 1, roomId: 'room-core', cabinetId: 'cab-a02' },
  ].map((device) => ({ ...device, photos: { front: true, back: false } }));
  devices.push(
    { id: 'unplaced-a', name: '待上架设备 A', code: 'PREVIEW-A', type: '服务器', vendor: '示例厂商', model: '', height: 1, start: null, roomId: null, cabinetId: null, photos: { front: false, back: false } },
    { id: 'unplaced-b', name: '待上架设备 B', code: 'PREVIEW-B', type: '交换机', vendor: 'H3C', model: '', height: 2, start: null, roomId: null, cabinetId: null, photos: { front: false, back: false } },
  );

  // 6 Standard Port Modes (Access / Trunk / Hybrid / Mgmt / LACP / SAN)
  const portModes = [
    { id: 'access', code: 'ACC', label: 'Access 接入', fullLabel: 'Access 接入口', defaultVlan: 'VLAN 30', desc: '单 VLAN Untagged 终端/业务接入' },
    { id: 'trunk', code: 'TRK', label: 'Trunk 干道', fullLabel: 'Trunk 干道口', defaultVlan: 'VLAN 10,20,30', desc: '多 VLAN Tagged 虚拟化/交换机上联' },
    { id: 'hybrid', code: 'HYB', label: 'Hybrid 混杂', fullLabel: 'Hybrid 混杂口', defaultVlan: 'PVID 10 / Tag 20,30', desc: '华为/H3C 混合 Untagged/Tagged 端口' },
    { id: 'mgmt', code: 'MGMT', label: 'Mgmt 带外', fullLabel: 'Mgmt 带外管理口', defaultVlan: 'VLAN 99', desc: 'iDRAC/iLO/HDM/IPMI 或 M-Gig0/0/0 带外管理' },
    { id: 'lacp', code: 'LACP', label: 'LACP 聚合', fullLabel: 'LACP 聚合口', defaultVlan: 'VLAN 50', desc: 'bond0 / Eth-Trunk / BAGG 链路聚合' },
    { id: 'san', code: 'SAN', label: 'SAN 存储', fullLabel: 'SAN / HA 专用口', defaultVlan: 'VSAN 10 / VLAN 200', desc: 'FC 光纤、iSCSI 存储或集群 HA 心跳专用' },
  ];
  const portModeMap = Object.fromEntries(portModes.map((item) => [item.id, item]));
  const getPortMode = (mode) => portModeMap[mode] || portModeMap.access;

  // Explicit offline port presets with default port mode, VLAN, medium and speed
  const devicePorts = {
    'hci-01': [
      { name: 'SFP1', mode: 'trunk', vlan: 'VLAN 10,20,30', medium: 'fiber', speed: '10G', desc: 'Trunk 10G 虚拟化上联' },
      { name: 'SFP2', mode: 'san', vlan: 'VSAN 10 / VLAN 200', medium: 'fiber', speed: '10G', desc: 'SAN 存储光纤备口' },
      { name: 'eth0', mode: 'access', vlan: 'VLAN 30', medium: 'copper', speed: '1G', desc: 'Access 业务接入网卡' },
      { name: 'eth1', mode: 'lacp', vlan: 'VLAN 50', medium: 'fiber', speed: '10G', desc: 'LACP 聚合 / HA 心跳口' },
      { name: 'eth2', mode: 'hybrid', vlan: 'PVID 10 / Tag 20,30', medium: 'copper', speed: '1G', desc: 'Hybrid 混合业务口' },
      { name: 'iDRAC', mode: 'mgmt', vlan: 'VLAN 99 (OOB)', medium: 'copper', speed: '1G', desc: 'Dell iDRAC 带外管理口' },
    ],
    'san-01': [
      { name: 'SFP1', mode: 'san', vlan: 'VSAN 10 / VLAN 200', medium: 'fiber', speed: '10G', desc: 'SAN 主存储光纤口' },
      { name: 'SFP2', mode: 'san', vlan: 'VSAN 20 / VLAN 200', medium: 'fiber', speed: '10G', desc: 'SAN 备存储光纤口' },
      { name: 'eth0', mode: 'lacp', vlan: 'VLAN 50', medium: 'fiber', speed: '10G', desc: 'LACP 存储双活心跳口' },
      { name: 'eth1', mode: 'access', vlan: 'VLAN 100', medium: 'copper', speed: '1G', desc: 'NAS 业务接入口' },
      { name: 'mgmt0', mode: 'mgmt', vlan: 'VLAN 99', medium: 'copper', speed: '1G', desc: '存储带外管理口' },
    ],
    'sw-001': [
      { name: 'XG1/0/1', mode: 'trunk', vlan: 'VLAN 10,20,30', medium: 'fiber', speed: '10G', desc: '10G Trunk 下联宿主机' },
      { name: 'XG1/0/2', mode: 'lacp', vlan: 'VLAN 10-50', medium: 'fiber', speed: '10G', desc: 'BAGG1 聚合上联核心' },
      { name: 'XG1/0/3', mode: 'hybrid', vlan: 'PVID 10 / Tag 20,30', medium: 'fiber', speed: '10G', desc: 'Hybrid 虚拟化混杂口' },
      { name: 'GE1/0/1', mode: 'access', vlan: 'VLAN 10', medium: 'copper', speed: '1G', desc: 'Access 普通业务接入' },
      { name: 'GE1/0/12', mode: 'access', vlan: 'VLAN 30', medium: 'copper', speed: '1G', desc: 'Access 备份服务器接入' },
      { name: 'M-Gig0/0/0', mode: 'mgmt', vlan: 'VLAN 99 (OOB)', medium: 'copper', speed: '1G', desc: '交换机独立带外管理口' },
    ],
    'sw-002': [
      { name: 'GE1/0/8', mode: 'mgmt', vlan: 'VLAN 99', medium: 'copper', speed: '1G', desc: 'OOB 带外管理汇总口' },
      { name: 'GE1/0/1', mode: 'access', vlan: 'VLAN 20', medium: 'copper', speed: '1G', desc: 'Access 终端接入口' },
      { name: 'GE1/0/2', mode: 'hybrid', vlan: 'PVID 20 / Tag 100', medium: 'copper', speed: '1G', desc: 'Hybrid 语音/终端混杂口' },
      { name: 'XG1/0/1', mode: 'trunk', vlan: 'VLAN 1-4094', medium: 'fiber', speed: '10G', desc: 'Trunk 上联汇聚交换机' },
      { name: 'M-Gig0/0/0', mode: 'mgmt', vlan: 'VLAN 99 (OOB)', medium: 'copper', speed: '1G', desc: '独立带外管理口' },
    ],
    'sw-san-01': [
      { name: 'XG1/0/1', mode: 'san', vlan: 'VSAN 10 / VLAN 200', medium: 'fiber', speed: '10G', desc: 'SAN 存储光纤专口' },
      { name: 'FC1/0/1', mode: 'san', vlan: 'VSAN 10', medium: 'fiber', speed: '10G', desc: 'FC 16G 光纤存储口' },
      { name: 'XG1/0/2', mode: 'lacp', vlan: 'VLAN 200', medium: 'fiber', speed: '10G', desc: 'Eth-Trunk 存储聚合口' },
      { name: 'GE1/0/1', mode: 'access', vlan: 'VLAN 200', medium: 'copper', speed: '1G', desc: 'iSCSI 接入电口' },
      { name: 'M-Gig0/0/0', mode: 'mgmt', vlan: 'VLAN 99 (OOB)', medium: 'copper', speed: '1G', desc: '带外管理口' },
    ],
    'bak-srv-01': [
      { name: 'eth0', mode: 'access', vlan: 'VLAN 30', medium: 'copper', speed: '1G', desc: 'Access 备份业务网卡' },
      { name: 'SFP1', mode: 'trunk', vlan: 'VLAN 30,200', medium: 'fiber', speed: '10G', desc: '10G 备份干道口' },
      { name: 'eth1', mode: 'lacp', vlan: 'VLAN 50', medium: 'copper', speed: '1G', desc: 'bond0 聚合网口' },
      { name: 'iDRAC', mode: 'mgmt', vlan: 'VLAN 99 (OOB)', medium: 'copper', speed: '1G', desc: 'iDRAC 带外管理口' },
    ],
  };
  const serverPorts = ['SFP1', 'SFP2', 'eth0', 'eth1', 'eth2', 'eth3', 'mgmt0', 'iDRAC', 'iLO', 'HDM'];
  const storagePorts = ['SFP1', 'SFP2', 'FC1/0/1', 'eth0', 'eth1', 'mgmt0'];
  const switchPorts = [
    'XG1/0/1', 'XG1/0/2', 'XG1/0/3', 'XG1/0/4', 'FC1/0/1', 'M-Gig0/0/0',
    ...Array.from({ length: 24 }, (_, index) => `GE1/0/${index + 1}`),
  ];
  function inferPortSpec(device, portName) {
    const p = String(portName || '');
    const presets = (device && devicePorts[device.id]) || [];
    const hit = presets.find((item) => item.name === p);
    if (hit) return hit;
    const upper = p.toUpperCase();
    if (upper.includes('MGMT') || upper.includes('IDRAC') || upper.includes('ILO') || upper.includes('HDM') || upper.includes('IPMI') || upper.startsWith('M-GIG')) {
      return { name: p, mode: 'mgmt', vlan: 'VLAN 99 (OOB)', medium: 'copper', speed: '1G', desc: 'Mgmt 带外管理口' };
    }
    if (upper.startsWith('FC') || device?.id === 'sw-san-01' || device?.type === '存储设备' && upper.startsWith('SFP')) {
      return { name: p, mode: 'san', vlan: 'VSAN 10 / VLAN 200', medium: 'fiber', speed: '10G', desc: 'SAN 存储专用口' };
    }
    if (upper.startsWith('XG') || upper.startsWith('SFP')) {
      return { name: p, mode: 'trunk', vlan: 'VLAN 10,20,30', medium: 'fiber', speed: '10G', desc: 'Trunk 光纤干道口' };
    }
    if (p === 'eth1' || upper.includes('BOND') || upper.includes('TRUNK')) {
      return { name: p, mode: 'lacp', vlan: 'VLAN 50', medium: 'copper', speed: '1G', desc: 'LACP 聚合口' };
    }
    if (p === 'eth2' || p === 'GE1/0/2') {
      return { name: p, mode: 'hybrid', vlan: 'PVID 10 / Tag 20,30', medium: 'copper', speed: '1G', desc: 'Hybrid 混杂口' };
    }
    return { name: p, mode: 'access', vlan: 'VLAN 30', medium: 'copper', speed: '1G', desc: 'Access 业务接入口' };
  }
  function portsForDevice(device) {
    const presetNames = ((device && devicePorts[device.id]) || []).map((item) => item.name);
    const base = !device ? serverPorts : device.type === '交换机' ? switchPorts : device.type === '存储设备' ? storagePorts : serverPorts;
    return [...new Set([...presetNames, ...base])];
  }
  function defaultPortsForDevice(device) {
    if (!device) return [];
    if (devicePorts[device.id]) return devicePorts[device.id].map((item) => item.name);
    if (device.type === '交换机') return ['XG1/0/1', 'XG1/0/2', 'GE1/0/1', 'GE1/0/8', 'GE1/0/12', 'M-Gig0/0/0'];
    if (device.type === '存储设备') return ['SFP1', 'SFP2', 'eth0', 'eth1', 'mgmt0'];
    return ['SFP1', 'SFP2', 'eth0', 'eth1', 'iDRAC'];
  }

  // Default 5 representative connections across 3 cabinets (A01, A02, A03) with Port Mode & VLAN:
  // 1) Channel 1 (A01 <-> A02) 10G Fiber Trunk: A01 HCI-01 · SFP1 <-> A02 SW-001 · XG1/0/1 (trunk · VLAN 10,20,30)
  // 2) Intra-cabinet C-curve (A01) 10G Fiber LACP/HA: A01 HCI-01 · eth1 <-> A01 SAN-01 · eth0 (lacp · VLAN 50)
  // 3) Intra-cabinet C-curve (A01) 1G Copper Mgmt: A01 SAN-01 · mgmt0 <-> A01 SW-002 · GE1/0/8 (mgmt · VLAN 99)
  // 4) Overhead Cable Tray (A01 <-> A03 across A02) 10G Fiber SAN: A01 SAN-01 · SFP1 <-> A03 SW-SAN-01 · XG1/0/1 (san · VSAN 10 / VLAN 200)
  // 5) Channel 2 (A02 <-> A03) 1G Copper Access: A02 SW-001 · GE1/0/12 <-> A03 BAK-01 · eth0 (access · VLAN 30)
  let connections = [
    { id: 'example-link-1', serverId: 'hci-01', serverPort: 'SFP1', switchId: 'sw-001', switchPort: 'XG1/0/1', medium: 'fiber', speed: '10G', portMode: 'trunk', vlan: 'VLAN 10,20,30' },
    { id: 'example-link-2', serverId: 'hci-01', serverPort: 'eth1', switchId: 'san-01', switchPort: 'eth0', medium: 'fiber', speed: '10G', portMode: 'lacp', vlan: 'VLAN 50' },
    { id: 'example-link-3', serverId: 'san-01', serverPort: 'mgmt0', switchId: 'sw-002', switchPort: 'GE1/0/8', medium: 'copper', speed: '1G', portMode: 'mgmt', vlan: 'VLAN 99' },
    { id: 'example-link-4', serverId: 'san-01', serverPort: 'SFP1', switchId: 'sw-san-01', switchPort: 'XG1/0/1', medium: 'fiber', speed: '10G', portMode: 'san', vlan: 'VSAN 10 / VLAN 200' },
    { id: 'example-link-5', serverId: 'sw-001', serverPort: 'GE1/0/12', switchId: 'bak-srv-01', switchPort: 'eth0', medium: 'copper', speed: '1G', portMode: 'access', vlan: 'VLAN 30' },
  ];
  if (shared) {
    rooms = shared.register('rooms', rooms);
    cabinets = shared.register('racks', cabinets);
    connections = shared.register('connections', connections);
    devices = shared.registerRackDevices(devices);
    document.body.classList.add('rack-workbench');
  }

  let sequence = 0;
  let activeRoomId = rooms[0].id;
  let activeCabinetId = cabinets[0].id;
  const views = {
    left: { roomId: activeRoomId, cabinetId: activeCabinetId },
    middle: { roomId: 'room-core', cabinetId: 'cab-a02' },
    right: { roomId: 'room-core', cabinetId: 'cab-a03' },
  };
  const peerModes = { middle: 'auto', right: 'auto' };
  let activeSide = 'left';
  let selectedConnectionId = connections[0]?.id;
  let connectionDraftId = null;
  let connectionDirty = false;
  let managerDirty = false;
  let managerSearchTerm = '';
  let selectedId = 'hci-01';
  let draft = null;
  let dirty = false;
  let searchTerm = '';
  let managerMode = 'cabinet-edit';
  let managerRoomId = activeRoomId;
  let managerCabinetId = activeCabinetId;
  let pendingUnit = null;
  let activeFilter = 'all'; // 'all' | 'fiber' | 'copper' | 'intra'
  let activePortModeFilter = 'all'; // 'all' | 'access' | 'trunk' | 'hybrid' | 'mgmt' | 'lacp' | 'san'
  let activeSidebarTab = 'device'; // 'device' | 'ports'
  const fields = {
    name: $('device-name'), code: $('asset-code'), type: $('device-type'), vendor: $('vendor'), model: $('model'),
    roomId: $('device-room'), cabinetId: $('device-cabinet'), start: $('start-u'), height: $('height-u'),
  };
  const editorTitle = panel.querySelector('.editor-head h2');
  const editorCaption = panel.querySelector('.editor-head .caption');
  const footer = panel.querySelector('.editor-footer');
  const [unmountButton, resetButton, saveButton] = footer.querySelectorAll('button');
  saveButton.textContent = '保存设备';
  resetButton.textContent = '重置草稿';

  // Status message is kept only as a non-visual SR/API holder so no redundant gray line sits above bottom bar
  const status = document.createElement('p');
  status.id = 'rack-feedback';
  status.className = 'rack-feedback';
  status.setAttribute('role', 'status');
  status.hidden = true;
  document.body.append(status);

  const editorError = document.createElement('p');
  editorError.className = 'rack-editor-error';
  editorError.setAttribute('role', 'alert');
  editorError.hidden = true;
  panel.querySelector('.editor-body').prepend(editorError);

  const emptyEditor = document.createElement('p');
  emptyEditor.className = 'rack-empty-editor';
  panel.querySelector('.editor-body').prepend(emptyEditor);

  const searchResults = document.createElement('div');
  searchResults.className = 'rack-search-results';
  searchResults.hidden = true;
  rackStage.prepend(searchResults);

  let uFocusId = null;
  const cloneDevice = (device) => ({ ...device, start: device.start ?? device.start_u, height: device.height ?? device.height_u, photos: { ...device.photos }, placed: Boolean(device.cabinetId), isNew: false });
  const roomById = (id) => rooms.find((room) => room.id === id);
  const cabinetById = (id) => cabinets.find((cabinet) => cabinet.id === id);
  const deviceById = (id) => devices.find((device) => String(device.id) === String(id));
  const placedIn = (id) => id ? devices.filter((device) => device.cabinetId === id) : [];
  const notify = (text) => { status.textContent = text; };
  const error = (text) => { editorError.textContent = text; editorError.hidden = !text; };
  const isIntraLink = (link) => {
    const a = deviceById(link.serverId), b = deviceById(link.switchId);
    return Boolean(a?.cabinetId && b?.cabinetId && a.cabinetId === b.cabinetId);
  };
  const linkMedium = (link) => link?.medium === 'copper' ? 'copper' : 'fiber';
  const linkMediumLabel = (link) => linkMedium(link) === 'copper' ? `网线 ${link.speed || '1G'}` : `光纤 ${link.speed || '10G'}`;
  const linkPortMode = (link) => getPortMode(link?.portMode || inferPortSpec(deviceById(link?.serverId), link?.serverPort).mode);
  const linkVlanLabel = (link) => (link?.vlan || linkPortMode(link).defaultVlan || '').trim();
  function button(text, action, className = '') {
    const node = document.createElement('button');
    node.type = 'button';
    node.textContent = text;
    node.className = className;
    node.addEventListener('click', action);
    return node;
  }
  function options(select, items, value, placeholder) {
    select.replaceChildren();
    if (placeholder) select.add(new Option(placeholder, ''));
    for (const item of items) select.add(new Option(item.name, item.id));
    select.value = value || '';
  }
  function choiceOptions(select, values, value) {
    const choices = [...new Set([...values, value].filter(Boolean))];
    select.replaceChildren(...choices.map((name) => new Option(name, name)));
    select.value = value || choices[0] || '';
  }
  function canDiscard() {
    return !(dirty || draft?.isNew) || window.confirm('当前设备有未保存的草稿。放弃这些修改？已保存的设备不会改变。');
  }
  function switchSidebarTab(tab) {
    activeSidebarTab = tab === 'ports' ? 'ports' : 'device';
    const isDevice = activeSidebarTab === 'device';
    $('rack-tab-device').classList.toggle('active', isDevice);
    $('rack-tab-device').setAttribute('aria-selected', String(isDevice));
    $('rack-tab-ports').classList.toggle('active', !isDevice);
    $('rack-tab-ports').setAttribute('aria-selected', String(!isDevice));
    $('rack-pane-device').hidden = !isDevice;
    $('rack-pane-ports').hidden = isDevice;
  }
  $('rack-tab-device').addEventListener('click', () => switchSidebarTab('device'));
  $('rack-tab-ports').addEventListener('click', () => switchSidebarTab('ports'));

  // Legend filter buttons
  $('rack-cable-legend').querySelectorAll('[data-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = btn.dataset.filter;
      activeFilter = activeFilter === next && next !== 'all' ? 'all' : next;
      updateLegendFilterUI();
      drawConnections();
      renderSidebarPortsAndLinks();
    });
  });
  function linkMatchesFilter(link) {
    if (activeFilter === 'fiber' && linkMedium(link) !== 'fiber') return false;
    if (activeFilter === 'copper' && linkMedium(link) !== 'copper') return false;
    if (activeFilter === 'intra' && !isIntraLink(link)) return false;
    if (activePortModeFilter !== 'all' && linkPortMode(link).id !== activePortModeFilter) return false;
    return true;
  }
  function updateLegendFilterUI() {
    const fiberCount = connections.filter((item) => linkMedium(item) === 'fiber').length;
    const copperCount = connections.filter((item) => linkMedium(item) === 'copper').length;
    const intraCount = connections.filter((item) => isIntraLink(item)).length;
    $('rack-cable-legend').querySelectorAll('[data-filter]').forEach((btn) => {
      const key = btn.dataset.filter;
      const active = key === activeFilter;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
      let countBadge = btn.querySelector('.legend-count');
      if (!countBadge) {
        countBadge = document.createElement('span');
        countBadge.className = 'legend-count';
        btn.append(countBadge);
      }
      if (key === 'all') countBadge.textContent = `(${connections.length})`;
      if (key === 'fiber') countBadge.textContent = `(${fiberCount})`;
      if (key === 'copper') countBadge.textContent = `(${copperCount})`;
      if (key === 'intra') countBadge.textContent = `(${intraCount})`;
    });
  }

  function placementError(candidate) {
    if (!candidate.placed && !candidate.cabinetId) return '';
    const cabinet = cabinetById(candidate.cabinetId);
    if (!cabinet || cabinet.roomId !== candidate.roomId) return '请选择有效的机房与机柜。';
    if (!Number.isInteger(candidate.start) || !Number.isInteger(candidate.height) || candidate.start < 1 || candidate.height < 1) return '起始 U 位与占用 U 数必须为正整数。';
    const end = candidate.start + candidate.height - 1;
    if (end > cabinet.total) return `范围 ${candidate.start}–${end}U 超出 ${cabinet.total}U 机柜。`;
    const overlap = placedIn(cabinet.id).find((device) => device.id !== candidate.id && candidate.start <= device.start + device.height - 1 && end >= device.start);
    return overlap ? `位置冲突：${overlap.name} 已占用 ${overlap.start}–${overlap.start + overlap.height - 1}U。` : '';
  }
  function readDraft() {
    if (!draft) return;
    for (const key of ['name', 'code', 'type', 'vendor', 'model']) draft[key] = fields[key].value.trim();
    draft.height = Number(fields.height.value);
    if (draft.placed) {
      draft.roomId = fields.roomId.value;
      draft.cabinetId = fields.cabinetId.value;
      draft.start = Number(fields.start.value);
    }
  }
  function updatePositionHint() {
    const summary = $('rack-position-summary');
    const indicator = panel.querySelector('.position-hint strong');
    if (!draft) { summary.textContent = '选择设备或点击空 U 位开始'; indicator.textContent = ''; return; }
    if (!draft.placed) { summary.textContent = '未上架 · 点击空 U 位可安排上架'; indicator.textContent = '未分配位置'; return; }
    const cabinet = cabinetById(draft.cabinetId);
    summary.textContent = `范围 ${draft.start || '?'}–${draft.start + draft.height - 1 || '?'}U / 共 ${cabinet?.total || '?'}U`;
    const issue = placementError(draft);
    indicator.innerHTML = `<svg aria-hidden="true"><use href="#${issue ? 'triangle-alert' : 'check'}"/></svg> ${issue ? '位置冲突' : '位置可用'}`;
    indicator.classList.toggle('rack-invalid', Boolean(issue));
  }
  function renderPhotos() {
    const photos = panel.querySelectorAll('.hardware-photos > .photo');
    photos.forEach((photo, index) => {
      const side = index ? 'back' : 'front';
      const present = Boolean(draft?.photos?.[side]);
      photo.classList.toggle('rack-photo-present', present);
      photo.classList.toggle('rack-photo-missing', !present);
      photo.querySelector('.photo-label').textContent = `${index ? '背面' : '正面'} · ${present ? '面板示意图' : '未设置示意图'}`;
      const last = photo.querySelector('span:not(.photo-label):not(.light)');
      if (index && last) last.textContent = present ? '背面硬件示意' : '未设置示意图';
    });
  }
  function renderPortModeFilterBar() {
    const bar = $('rack-port-mode-bar');
    const resetBtn = $('rack-mode-filter-reset');
    if (!bar) return;
    bar.replaceChildren();
    if (resetBtn) {
      resetBtn.hidden = activePortModeFilter === 'all';
      resetBtn.onclick = () => {
        activePortModeFilter = 'all';
        renderPortModeFilterBar();
        renderSidebarPortsAndLinks();
        drawConnections();
      };
    }
    for (const mode of portModes) {
      const count = connections.filter((link) => linkPortMode(link).id === mode.id).length;
      const active = activePortModeFilter === mode.id;
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `rack-mode-chip mode-${mode.id}${active ? ' active' : ''}`;
      chip.dataset.portMode = mode.id;
      chip.setAttribute('aria-pressed', String(active));
      chip.title = `${mode.fullLabel}（${mode.code}）· ${mode.desc} · 默认 ${mode.defaultVlan}`;
      const dot = document.createElement('i');
      dot.className = 'mode-dot';
      const text = document.createElement('span');
      text.textContent = mode.label;
      const codeEl = document.createElement('small');
      codeEl.textContent = count ? `(${count})` : mode.code;
      chip.append(dot, text, codeEl);
      chip.addEventListener('click', () => {
        activePortModeFilter = activePortModeFilter === mode.id ? 'all' : mode.id;
        renderPortModeFilterBar();
        renderSidebarPortsAndLinks();
        drawConnections();
      });
      bar.append(chip);
    }
  }

  function renderSidebarPortsAndLinks() {
    renderPortModeFilterBar();
    const portsContainer = $('rack-device-ports');
    const linksContainer = $('rack-sidebar-links');
    const countBadge = $('rack-sidebar-link-count');
    if (!portsContainer || !linksContainer) return;
    portsContainer.replaceChildren();
    linksContainer.replaceChildren();

    const currentDevice = deviceById(selectedId) || draft;
    if (!currentDevice || currentDevice.isNew) {
      const note = document.createElement('p');
      note.className = 'caption';
      note.textContent = '请先在左侧机柜选择一台已保存设备以查看端口状态。';
      portsContainer.append(note);
    } else {
      const deviceLinks = connections.filter((link) => link.serverId === currentDevice.id || link.switchId === currentDevice.id);
      const portNames = [...new Set([
        ...defaultPortsForDevice(currentDevice),
        ...deviceLinks.map((link) => link.serverId === currentDevice.id ? link.serverPort : link.switchPort),
      ])];

      const headerRow = document.createElement('div');
      headerRow.className = 'rack-port-table-head';
      headerRow.innerHTML = '<span>端口 / 口型模式</span><span>VLAN / 状态与对端</span><span>操作</span>';
      portsContainer.append(headerRow);

      for (const portName of portNames) {
        const link = deviceLinks.find((item) => (item.serverId === currentDevice.id && item.serverPort === portName) || (item.switchId === currentDevice.id && item.switchPort === portName));
        const spec = inferPortSpec(currentDevice, portName);
        const modeObj = link ? linkPortMode(link) : getPortMode(spec.mode);
        const vlanStr = link ? linkVlanLabel(link) : (spec.vlan || modeObj.defaultVlan);
        if (activePortModeFilter !== 'all' && modeObj.id !== activePortModeFilter) continue;

        const row = document.createElement('div');
        row.className = `rack-port-row${link ? ' occupied' : ''}`;
        row.dataset.portName = portName;
        row.dataset.portMode = modeObj.id;

        const leftCol = document.createElement('div');
        leftCol.className = 'port-col-main';
        const nameEl = document.createElement('span');
        nameEl.className = 'port-name';
        nameEl.textContent = portName;
        const modeTag = document.createElement('span');
        modeTag.className = `rack-mode-tag mode-${modeObj.id}`;
        modeTag.textContent = modeObj.label;
        modeTag.title = `${modeObj.fullLabel}（${modeObj.code}）· ${spec.desc || modeObj.desc}`;
        leftCol.append(nameEl, modeTag);

        const midCol = document.createElement('div');
        midCol.className = 'port-col-detail';
        const vlanEl = document.createElement('span');
        vlanEl.className = 'port-vlan';
        vlanEl.textContent = vlanStr;

        if (link) {
          const isSource = link.serverId === currentDevice.id;
          const peerDevice = deviceById(isSource ? link.switchId : link.serverId);
          const peerPort = isSource ? link.switchPort : link.serverPort;
          const peerEl = document.createElement('span');
          peerEl.className = 'port-peer occupied';
          peerEl.textContent = `${linkMedium(link) === 'copper' ? '网线' : '光纤'} ↔ ${peerDevice?.name.split(' ').at(-1) || '设备'}·${peerPort}`;
          peerEl.title = `${portName} · ${modeObj.fullLabel} · ${vlanStr} ↔ ${peerDevice?.name || ''} · ${peerPort}`;
          midCol.append(vlanEl, peerEl);
          const locateBtn = button('定位', () => { selectConnection(link.id); locateConnection(link); });
          row.append(leftCol, midCol, locateBtn);
        } else {
          const idleEl = document.createElement('span');
          idleEl.className = 'port-peer';
          idleEl.textContent = `空闲 · ${spec.desc || modeObj.desc}`;
          idleEl.title = `${portName} · ${modeObj.fullLabel} · 默认 ${vlanStr} · 点击配线自动带入`;
          midCol.append(vlanEl, idleEl);
          const connectBtn = button('配线', () => openConnection(null, {
            deviceId: currentDevice.id,
            port: portName,
            portMode: modeObj.id,
            vlan: vlanStr,
            medium: spec.medium,
            speed: spec.speed,
          }));
          row.append(leftCol, midCol, connectBtn);
        }
        portsContainer.append(row);
      }
    }

    const visibleCabinets = new Set(shared ? workbenchIds : sideOrder.map((side) => views[side].cabinetId).filter(Boolean));
    const allPairLinks = connections.filter((link) => {
      const a = deviceById(link.serverId), b = deviceById(link.switchId);
      return visibleCabinets.has(a?.cabinetId) || visibleCabinets.has(b?.cabinetId);
    });
    const pairLinks = allPairLinks.filter((link) => linkMatchesFilter(link));
    countBadge.textContent = pairLinks.length === allPairLinks.length
      ? `${pairLinks.length} 条`
      : `${pairLinks.length}/${allPairLinks.length} 条`;

    if (!pairLinks.length) {
      const empty = document.createElement('p');
      empty.className = 'caption';
      empty.textContent = activePortModeFilter !== 'all' || activeFilter !== 'all'
        ? '当前筛选条件下暂无匹配的跳线连接。'
        : shared ? '当前所选机柜暂无跳线连接。' : '当前三柜暂无跳线连接。';
      linksContainer.append(empty);
      return;
    }

    for (const link of pairLinks) {
      const a = deviceById(link.serverId), b = deviceById(link.switchId);
      const intra = isIntraLink(link);
      const medium = linkMedium(link);
      const modeObj = linkPortMode(link);
      const vlanStr = linkVlanLabel(link);
      const item = document.createElement('div');
      item.className = `rack-sidebar-link-item${link.id === selectedConnectionId ? ' is-selected' : ''}`;
      item.setAttribute('role', 'button');
      item.tabIndex = 0;

      const top = document.createElement('div');
      top.className = 'rack-sidebar-link-top';
      const mTag = document.createElement('span');
      mTag.className = `rack-medium-tag ${medium}`;
      mTag.textContent = medium === 'copper' ? `网线 ${link.speed || '1G'}` : `光纤 ${link.speed || '10G'}`;
      const modeTag = document.createElement('span');
      modeTag.className = `rack-mode-tag mode-${modeObj.id}`;
      modeTag.textContent = `${modeObj.code}${vlanStr ? ` · ${vlanStr}` : ''}`;
      modeTag.title = `${modeObj.fullLabel} · ${vlanStr}`;
      top.append(mTag, modeTag);

      if (intra) {
        const iTag = document.createElement('span');
        iTag.className = 'rack-medium-tag intra';
        iTag.textContent = `同柜 ${cabinetById(a?.cabinetId)?.name || ''}`;
        top.append(iTag);
      } else {
        const cTag = document.createElement('span');
        cTag.className = 'badge';
        cTag.textContent = `${cabinetById(a?.cabinetId)?.name || '未上架'} ↔ ${cabinetById(b?.cabinetId)?.name || '未上架'}`;
        top.append(cTag);
      }

      const endpoints = document.createElement('div');
      endpoints.className = 'rack-sidebar-link-endpoints';
      const shortA = a?.name.split(' ').at(-1) || a?.name || '设备';
      const shortB = b?.name.split(' ').at(-1) || b?.name || '设备';
      endpoints.textContent = `${shortA} · ${link.serverPort} ${intra ? '↷' : '↔'} ${shortB} · ${link.switchPort}`;

      const meta = document.createElement('div');
      meta.className = 'rack-sidebar-link-meta';
      const detailSpan = document.createElement('span');
      detailSpan.textContent = `${modeObj.fullLabel} · ${a?.name || ''} → ${b?.name || ''}`;
      const editBtn = button('编辑', (ev) => { ev.stopPropagation(); openConnection(link.id); }, 'quiet');
      editBtn.style.height = '20px';
      editBtn.style.padding = '0 6px';
      meta.append(detailSpan, editBtn);

      item.append(top, endpoints, meta);
      item.addEventListener('click', () => {
        selectConnection(link.id);
        locateConnection(link);
      });
      item.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          selectConnection(link.id);
          locateConnection(link);
        }
      });
      linksContainer.append(item);
    }
  }

  // ---------- Workbench (shared cmdbPrototype) integration ----------
  const workbenchIds = [];
  let workbenchPage = 0;
  let workbenchPageSize = 1;
  let workbenchResizeFrame = 0;
  const workbenchScrollPositions = new Map();
  function workbenchCapacity() {
    const style = getComputedStyle(rackPair);
    const available = rackPair.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const gap = parseFloat(style.columnGap) || 64;
    const minimum = parseFloat(style.getPropertyValue('--rack-readable-width')) || 320;
    return Math.max(1, Math.floor((available + gap) / (minimum + gap)));
  }
  function renderWorkbenchPager() {
    const pager = $('rack-workbench-pager');
    if (!pager) return;
    const pages = Math.max(1, Math.ceil(workbenchIds.length / workbenchPageSize));
    pager.querySelector('[data-page-count]').textContent = `${workbenchPage + 1}/${pages} 组 · 已选 ${workbenchIds.length} 柜`;
    pager.querySelector('[data-page-prev]').disabled = workbenchPage === 0;
    pager.querySelector('[data-page-next]').disabled = workbenchPage >= pages - 1;
  }
  function resizeWorkbench() {
    if (!shared || !rackPair.clientWidth || workbenchResizeFrame) return;
    workbenchResizeFrame = requestAnimationFrame(() => {
      workbenchResizeFrame = 0;
      const size = workbenchCapacity();
      if (size === workbenchPageSize) return;
      workbenchPageSize = size;
      workbenchPage = Math.floor(Math.max(0, workbenchIds.indexOf(activeCabinetId)) / size);
      renderWorkbenchPanels();
    });
  }
  function selectAllWorkbenchCabinets() {
    workbenchIds.splice(0, workbenchIds.length, ...cabinets.map((cabinet) => cabinet.id));
    workbenchPage = Math.floor(Math.max(0, workbenchIds.indexOf(activeCabinetId)) / workbenchCapacity());
    renderWorkbenchPanels();
  }
  function workbenchPhysicalAssets() {
    const all = shared?.assetsByKind?.infrastructure;
    if (!Array.isArray(all)) return [];
    return all.filter((row) => !/虚拟|云主机|容器/.test(row.type || '') && row.status !== '已注销');
  }
  function workbenchSlotOf(cabinetId) {
    return sideOrder.find((side) => views[side]?.cabinetId === String(cabinetId)) || null;
  }
  function buildWorkbenchPanel(cabinet) {
    const section = document.createElement('section');
    section.className = 'rack-panel rack-workbench-panel';
    section.innerHTML = '<div class="panel-heading"><h1></h1><span class="rack-anchor-badge"></span><button class="rack-units-edit" type="button" aria-label="编辑机柜总 U 数" title="编辑机柜总 U 数"><span class="rack-total-units">42U</span><svg><use href="#edit"/></svg></button><button type="button" class="quiet rack-workbench-remove" aria-label="移出当前排柜" title="移出当前排柜"><svg aria-hidden="true"><use href="#close"/></svg></button></div><p class="caption rack-capacity-summary"></p><div class="usage"><span></span></div><div class="rack-scroll"><div class="rack-frame"><div class="rack-grid"></div></div></div>';
    section.querySelector('.rack-grid').dataset.cabId = cabinet.id;
    section.querySelector('.rack-units-edit').addEventListener('click', () => { activateSide(workbenchSlotOf(cabinet.id)); openManager('cabinet-edit'); });
    section.querySelector('.rack-workbench-remove').addEventListener('click', () => dropWorkbenchCabinet(cabinet.id));
    section.querySelector('.rack-scroll').addEventListener('scroll', scheduleConnections, { passive: true });
    return section;
  }
  function renderWorkbenchPanels() {
    if (!shared) return;
    for (const side of sideOrder) workbenchScrollPositions.set(views[side]?.cabinetId, panelsBySide[side]?.querySelector('.rack-scroll')?.scrollTop || 0);
    workbenchPageSize = workbenchCapacity();
    workbenchPage = Math.max(0, Math.min(workbenchPage, Math.ceil(workbenchIds.length / workbenchPageSize) - 1));
    rackPair.querySelectorAll('.rack-workbench-empty').forEach((node) => node.remove());
    for (const panelNode of Object.values(panelsBySide)) panelNode?.remove();
    for (const key of Object.keys(panelsBySide)) delete panelsBySide[key];
    for (const key of Object.keys(views)) delete views[key];
    sideOrder.length = 0;
    const keepActive = activeCabinetId;
    const pageIds = workbenchIds.slice(workbenchPage * workbenchPageSize, (workbenchPage + 1) * workbenchPageSize);
    for (const [index, cabinetId] of pageIds.entries()) {
      const cabinet = cabinetById(cabinetId);
      if (!cabinet) continue;
      const slot = `s${index}`;
      sideOrder.push(slot);
      views[slot] = { roomId: cabinet.roomId, cabinetId };
      const panelNode = buildWorkbenchPanel(cabinet);
      panelNode.dataset.rackSlot = slot;
      panelNode.querySelector('.rack-anchor-badge').textContent = `${roomById(cabinet.roomId)?.name || ''} · ${cabinet.name}`;
      rackPair.append(panelNode);
      panelsBySide[slot] = panelNode;
    }
    if (!sideOrder.length) {
      const empty = document.createElement('p');
      empty.className = 'rack-empty-grid rack-workbench-empty';
      empty.textContent = '尚未选择机柜：在顶部「选择机房与机柜」中勾选任意数量、任意机房的机柜。';
      rackPair.append(empty);
      activeSide = 'left';
      activeCabinetId = null;
    } else {
      const slot = workbenchSlotOf(keepActive) || sideOrder[0];
      activeSide = slot;
      activeRoomId = views[slot].roomId;
      activeCabinetId = views[slot].cabinetId;
    }
    rackPair.append(wireLayer);
    renderRack();
    for (const side of sideOrder) panelsBySide[side].querySelector('.rack-scroll').scrollTop = workbenchScrollPositions.get(views[side].cabinetId) || 0;
    renderWorkbenchPager();
  }
  function ensureWorkbenchCabinet(cabinetId) {
    const cabinet = cabinetById(String(cabinetId));
    if (!cabinet) return null;
    if (!workbenchIds.includes(cabinet.id)) workbenchIds.push(cabinet.id);
    workbenchPageSize = workbenchCapacity();
    const page = Math.floor(workbenchIds.indexOf(cabinet.id) / workbenchPageSize);
    if (page !== workbenchPage || !workbenchSlotOf(cabinet.id)) {
      workbenchPage = page;
      activeCabinetId = cabinet.id;
      renderWorkbenchPanels();
    }
    const slot = workbenchSlotOf(cabinet.id);
    if (slot) activateSide(slot);
    return slot;
  }
  function dropWorkbenchCabinet(cabinetId) {
    const index = workbenchIds.indexOf(String(cabinetId));
    if (index < 0) return;
    workbenchIds.splice(index, 1);
    if (String(cabinetId) === String(activeCabinetId)) activeCabinetId = null;
    renderWorkbenchPanels();
    fillEditor();
  }
  function renderWorkbenchSelectors() {
    const details = toolbar.querySelector('.room');
    if (!details) return;
    const chosen = workbenchIds.map(cabinetById).filter(Boolean);
    const label = chosen.length
      ? `${chosen.length} 柜 · ${chosen.map((cabinet) => `${roomById(cabinet.roomId)?.name || ''}/${cabinet.name}`).join('、')}`
      : '未选择机柜';
    const choice = details.querySelector('#rack-choice');
    if (choice) choice.textContent = label;
    else {
      const summary = details.querySelector('summary');
      summary.textContent = label;
      summary.insertAdjacentHTML('beforeend', '<svg aria-hidden="true"><use href="#down"/></svg>');
    }
    const menu = details.querySelector('.menu');
    menu.replaceChildren();
    for (const room of rooms) {
      const heading = document.createElement('strong'); heading.textContent = room.name; menu.append(heading);
      const roomCabinets = cabinets.filter((item) => item.roomId === room.id);
      for (const cabinet of roomCabinets) {
        const item = document.createElement('label');
        item.className = 'rack-picker-option rack-workbench-check';
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = workbenchIds.includes(cabinet.id);
        box.addEventListener('change', () => { if (box.checked) ensureWorkbenchCabinet(cabinet.id); else dropWorkbenchCabinet(cabinet.id); });
        item.append(box, document.createTextNode(` ${cabinet.name} · ${cabinet.total}U · ${placedIn(cabinet.id).length} 台`));
        menu.append(item);
      }
      if (!roomCabinets.length) menu.append(button('暂无空机柜 · 去新建', () => { details.open = false; focusManager(); }, 'rack-picker-option'));
    }
    const actions = document.createElement('div'); actions.className = 'rack-picker-actions';
    actions.append(
      button('选择全部机柜', selectAllWorkbenchCabinets, 'rack-picker-option'),
      button('仅保留当前柜', () => { workbenchIds.length = 0; if (activeCabinetId) workbenchIds.push(activeCabinetId); renderWorkbenchPanels(); fillEditor(); }, 'rack-picker-option'),
      button('维护机房与机柜', () => { details.open = false; focusManager(); }, 'rack-picker-option'),
    );
    menu.append(actions);
  }
  function openDeviceEditor(tab = 'device') {
    if (!shared) return;
    const dialog = $('rack-workbench-editor');
    if (!dialog) return;
    switchSidebarTab(tab);
    fillEditor();
    if (!dialog.open) dialog.showModal();
  }
  function refreshFromShared() {
    if (!shared) return;
    devices = workbenchPhysicalAssets();
    for (let index = workbenchIds.length - 1; index >= 0; index--) if (!cabinetById(workbenchIds[index])) workbenchIds.splice(index, 1);
    if (selectedId) {
      const current = deviceById(selectedId);
      if (!current) { selectedId = null; draft = null; }
      else if (!dirty) {
        const positionChanged = draft && (draft.cabinetId !== current.cabinetId || draft.start !== current.start || draft.height !== current.height);
        draft = cloneDevice(current);
        if (current.cabinetId && positionChanged) {
          if (!workbenchIds.includes(current.cabinetId)) workbenchIds.push(current.cabinetId);
          activeCabinetId = current.cabinetId;
          workbenchPage = Math.floor(workbenchIds.indexOf(current.cabinetId) / workbenchPageSize);
          uFocusId = current.id;
        }
      }
    }
    renderWorkbenchPanels();
    fillEditor();
    if (uFocusId) requestAnimationFrame(scrollSelected);
  }
  function locateWorkbenchAsset(id) {
    const asset = deviceById(id);
    if (!asset) return false;
    if (asset.cabinetId) ensureWorkbenchCabinet(asset.cabinetId);
    selectedId = asset.id;
    uFocusId = asset.id;
    draft = cloneDevice(asset);
    dirty = false;
    renderRack();
    fillEditor();
    scrollSelected();
    return true;
  }
  function workbenchOpenObject(type, id, options = {}) {
    if (!shared) return false;
    if (type === 'rack') {
      const slot = ensureWorkbenchCabinet(id);
      panelsBySide[slot]?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
      return Boolean(slot);
    }
    if (type === 'infrastructure') return locateWorkbenchAsset(id);
    return false;
  }
  function initializeWorkbench() {
    if (!shared) return;
    const pager = document.createElement('div');
    pager.id = 'rack-workbench-pager';
    pager.innerHTML = '<strong>机柜画布</strong><button type="button" data-page-prev>上一组</button><span data-page-count aria-live="polite"></span><button type="button" data-page-next>下一组</button>';
    for (const [selector, delta] of [['[data-page-prev]', -1], ['[data-page-next]', 1]]) pager.querySelector(selector).addEventListener('click', () => {
      if (!canDiscard()) return;
      workbenchPage += delta;
      renderWorkbenchPanels();
    });
    rackStage.insertBefore(pager, rackPair);
    window.addEventListener('resize', resizeWorkbench);
    const dialog = document.createElement('dialog');
    dialog.id = 'rack-workbench-editor';
    dialog.className = 'rack-prototype-dialog record-shell record-dialog rack-editor-dialog';
    dialog.setAttribute('aria-labelledby', 'rack-workbench-editor-title');
    dialog.innerHTML = '<header class="dialog-header record-header"><h2 id="rack-workbench-editor-title">设备属性与端口</h2><button type="button" class="icon quiet" aria-label="关闭设备编辑"><svg aria-hidden="true"><use href="#close"/></svg></button></header>';
    const closeEditor = () => { if (canDiscard()) { dirty = false; draft = deviceById(selectedId) ? cloneDevice(deviceById(selectedId)) : null; dialog.close(); } };
    dialog.querySelector('.dialog-header button').addEventListener('click', closeEditor);
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); closeEditor(); });
    dialog.append(panel);
    document.body.append(dialog);
    const queryFilters = document.createElement('div');
    queryFilters.className = 'rack-query-filters';
    queryFilters.append($('rack-cable-legend'), panel.querySelector('.rack-port-mode-section'));
    toolbar.append(queryFilters);
    const linkHeading = $('rack-sidebar-link-count').previousElementSibling;
    if (linkHeading) linkHeading.lastChild.textContent = '当前所选机柜跳线清单';
    const createMenu = toolbar.querySelector('.rack-create-menu .menu');
    if (createMenu) createMenu.append(button('编辑选中设备', () => { createMenu.closest('details').open = false; openDeviceEditor(); }));
    devices = workbenchPhysicalAssets();
    rackPair.addEventListener('scroll', scheduleConnections, { passive: true });
    workbenchIds.length = 0;
    for (const cabinet of cabinets) workbenchIds.push(cabinet.id);
    renderWorkbenchPanels();
    fillEditor();
    const unsubscribe = shared.subscribe(refreshFromShared);
    window.addEventListener('unload', () => unsubscribe());
    Object.defineProperty(window, 'workbenchAdapter', { value: Object.freeze({
      openObject: workbenchOpenObject,
      refresh: refreshFromShared,
      selector: () => ({
        rooms: rooms.map((room) => ({ id: room.id, name: room.name })),
        racks: cabinets.map((cabinet) => ({ id: cabinet.id, label: `${roomById(cabinet.roomId)?.name || '机房'} · ${cabinet.name}`, roomId: cabinet.roomId })),
        currentId: activeCabinetId || null,
        selectedIds: [...workbenchIds],
      }),
      selectCabinet: (id) => workbenchOpenObject('rack', id),
      setCabinets: (ids) => {
        const next = [...new Set(ids.map(String).filter((id) => cabinetById(id)))];
        const added = next.find((id) => !workbenchIds.includes(id));
        workbenchIds.splice(0, workbenchIds.length, ...next);
        const focus = added || activeCabinetId;
        workbenchPage = Math.floor(Math.max(0, workbenchIds.indexOf(focus)) / workbenchCapacity());
        activeCabinetId = focus;
        renderWorkbenchPanels();
        fillEditor();
      },
      searchInput,
      filterButton: queryFilters.querySelector('button'),
      filters: queryFilters,
      menus: [
        { label: '新建机柜', run: () => openManager('cabinet-new') },
        { label: '新建机房', run: () => openManager('room-new') },
        { label: '维护机房与机柜', run: () => openManager('cabinet-edit') },
        { label: '编辑选中设备', run: () => openDeviceEditor() },
        { label: '端口与跳线清单', run: () => openDeviceEditor('ports') },
        { label: '未上架与冲突设备', run: () => { openDeviceEditor(); $('rack-unplaced-fold').open = true; $('rack-unplaced-fold').scrollIntoView({ block: 'nearest' }); } },
        { label: '新增端口连接', run: () => document.querySelector('.rack-add-connection')?.click() },
        { label: '选择全部机柜', run: selectAllWorkbenchCabinets },
        { label: '仅保留当前机柜', run: () => { workbenchIds.length = 0; if (activeCabinetId) workbenchIds.push(activeCabinetId); renderWorkbenchPanels(); fillEditor(); } },
      ],
    }), writable: false, configurable: false });
  }
  function fillEditor() {
    error('');
    const exists = Boolean(draft);
    emptyEditor.hidden = exists;
    const cabinet = cabinetById(activeCabinetId);
    emptyEditor.textContent = cabinet ? `${cabinet.name} ${placedIn(cabinet.id).length ? '尚未选择设备' : '是空机柜'}。点击左侧任意空 U 位，可新增设备或上架已有设备。` : '当前机房尚无机柜。请在管理区新建空机柜。';
    editorTitle.textContent = draft ? draft.name || '新增设备草稿' : '未选择设备';
    const cabName = draft?.cabinetId ? cabinetById(draft.cabinetId)?.name : null;
    editorCaption.textContent = draft
      ? (draft.isNew ? '草稿 · 尚未保存，不占用机柜 U 位'
        : draft.staged ? '上架草稿 · 确认保存后才占用 U 位'
        : draft.placed ? `当前选中 · ${cabName ? `${cabName} 机柜 · ` : ''}${draft.start}–${draft.start + draft.height - 1}U · ${draft.height}U`
        : '未上架设备 · 不占用机柜 U 位')
      : '点击机柜设备查看属性，或点击空 U 位上架';
    for (const [key, field] of Object.entries(fields)) {
      field.removeAttribute('readonly');
      field.disabled = !exists;
      if (!['roomId', 'cabinetId', 'type', 'vendor'].includes(key)) field.value = draft?.[key] ?? '';
    }
    choiceOptions(fields.type, ['交换机', '服务器', '存储设备', '路由器', '防火墙', '其他'], draft?.type);
    choiceOptions(fields.vendor, ['未指定', 'H3C', 'Huawei', 'Cisco', 'Dell', '示例厂商'], draft?.vendor);
    options(fields.roomId, rooms, draft?.roomId || activeRoomId);
    const formRoom = fields.roomId.value;
    options(fields.cabinetId, cabinets.filter((item) => item.roomId === formRoom), draft?.cabinetId || activeCabinetId, '请选择机柜');
    for (const key of ['roomId', 'cabinetId', 'start']) fields[key].disabled = !draft?.placed;
    saveButton.disabled = resetButton.disabled = !exists;
    unmountButton.disabled = !exists || draft.isNew || !deviceById(draft.id)?.cabinetId;
    deleteDeviceButton.disabled = !exists || draft.isNew;
    panel.querySelector('.editor-head button').disabled = !exists || draft.isNew;
    panel.querySelector('.image-actions button').disabled = !exists;
    updatePositionHint();
    renderPhotos();
    renderSidebarPortsAndLinks();
  }
  function recomputeAutoPeers() {
    if (shared) return;
    const anchorCabId = views.left.cabinetId;
    const anchorRoomId = views.left.roomId;
    const roomCabs = cabinets.filter((item) => item.roomId === anchorRoomId);
    const anchorIdx = roomCabs.findIndex((item) => item.id === anchorCabId);

    const orderedCandidates = [];
    const pushCandidate = (cab) => {
      if (!cab || cab.id === anchorCabId) return;
      if (!orderedCandidates.some((existing) => existing.id === cab.id)) orderedCandidates.push(cab);
    };

    if (anchorIdx >= 0) {
      for (let i = anchorIdx + 1; i < roomCabs.length; i++) pushCandidate(roomCabs[i]);
      for (let i = anchorIdx - 1; i >= 0; i--) pushCandidate(roomCabs[i]);
    } else {
      for (const cab of roomCabs) pushCandidate(cab);
    }

    if (anchorCabId) {
      for (const link of connections) {
        const devA = deviceById(link.serverId);
        const devB = deviceById(link.switchId);
        if (devA?.cabinetId === anchorCabId && devB?.cabinetId && devB.cabinetId !== anchorCabId) {
          pushCandidate(cabinetById(devB.cabinetId));
        } else if (devB?.cabinetId === anchorCabId && devA?.cabinetId && devA.cabinetId !== anchorCabId) {
          pushCandidate(cabinetById(devA.cabinetId));
        }
      }
    }

    for (const cab of cabinets) pushCandidate(cab);
    const fallback = cabinetById(anchorCabId) || cabinets[0] || null;

    if (peerModes.middle === 'auto') {
      const midCab = orderedCandidates.find((cab) => peerModes.right !== 'manual' || cab.id !== views.right.cabinetId)
        || orderedCandidates[0]
        || fallback;
      views.middle = { roomId: midCab?.roomId || anchorRoomId, cabinetId: midCab?.id || null };
    }
    if (peerModes.right === 'auto') {
      const rightCab = orderedCandidates.find((cab) => cab.id !== views.middle.cabinetId)
        || orderedCandidates[1]
        || orderedCandidates[0]
        || fallback;
      views.right = { roomId: rightCab?.roomId || anchorRoomId, cabinetId: rightCab?.id || null };
    }
  }

  function scrollSelected() {
    const targetPanel = panelsBySide[activeSide] || rackPanel;
    const node = targetPanel?.querySelector('.device.selected');
    if (node) node.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }
  function renderSelectors() {
    if (shared) { renderWorkbenchSelectors(); return; }
    const details = toolbar.querySelector('.room');
    const left = views.left;
    const choiceNode = details.querySelector('#rack-choice');
    const choiceText = `${roomById(left.roomId)?.name || '机房'} · ${cabinetById(left.cabinetId)?.name || '暂无机柜'} (${cabinetById(left.cabinetId)?.total || 42}U)`;
    if (choiceNode) choiceNode.textContent = choiceText;
    else {
      const summary = details.querySelector('summary');
      summary.textContent = choiceText;
      summary.insertAdjacentHTML('beforeend', '<svg aria-hidden="true"><use href="#down"/></svg>');
    }
    const menu = details.querySelector('.menu');
    menu.replaceChildren();
    for (const room of rooms) {
      const heading = document.createElement('strong'); heading.textContent = room.name; menu.append(heading);
      const items = cabinets.filter((item) => item.roomId === room.id);
      for (const cabinet of items) {
        const option = button(`${cabinet.name} · ${cabinet.total}U · ${placedIn(cabinet.id).length} 台`, () => {
          if (navigateSide('left', room.id, cabinet.id)) details.open = false;
        }, 'rack-picker-option');
        option.setAttribute('aria-current', String(cabinet.id === left.cabinetId)); menu.append(option);
      }
      if (!items.length) menu.append(button('暂无机柜 · 选择此机房', () => {
        if (navigateSide('left', room.id, null)) details.open = false;
      }, 'rack-picker-option'));
    }
    const actions = document.createElement('div'); actions.className = 'rack-picker-actions';
    actions.append(button('管理设置', () => { details.open = false; activateSide('left'); openManager('cabinet-edit'); }, 'rack-picker-option'));
    menu.append(actions);

    for (const slot of ['middle', 'right']) {
      const targetPanel = panelsBySide[slot];
      const peer = targetPanel?.querySelector('.rack-peer-picker');
      if (!peer) continue;
      const slotCab = cabinetById(views[slot].cabinetId);
      const isAuto = peerModes[slot] === 'auto';
      const peerSummary = peer.querySelector('summary');
      peerSummary.textContent = isAuto
        ? '自动（相邻）'
        : `${roomById(views[slot].roomId)?.name || '机房'}/${slotCab?.name || '无'}`;
      peerSummary.insertAdjacentHTML('beforeend', '<svg aria-hidden="true"><use href="#down"/></svg>');
      const peerMenu = peer.querySelector('.menu');
      peerMenu.replaceChildren();
      const autoOpt = button('自动（相邻机柜）', () => {
        if (!canDiscard()) return;
        peerModes[slot] = 'auto';
        recomputeAutoPeers();
        activateSide(slot);
        navigate(views[slot].roomId, views[slot].cabinetId, null, false);
        peer.open = false;
      }, 'rack-picker-option');
      autoOpt.setAttribute('aria-current', String(isAuto));
      peerMenu.append(autoOpt);

      for (const room of rooms) {
        const heading = document.createElement('strong'); heading.textContent = room.name; peerMenu.append(heading);
        const items = cabinets.filter((item) => item.roomId === room.id);
        for (const cabinet of items) {
          const sameAsLeft = cabinet.id === views.left.cabinetId;
          const opt = button(`${cabinet.name} · ${cabinet.total}U · ${placedIn(cabinet.id).length} 台${sameAsLeft ? '（同柜对照）' : ''}`, () => {
            if (navigateSide(slot, room.id, cabinet.id)) peer.open = false;
          }, 'rack-picker-option');
          opt.setAttribute('aria-current', String(!isAuto && cabinet.id === views[slot].cabinetId));
          peerMenu.append(opt);
        }
        if (!items.length) peerMenu.append(button('暂无机柜', () => {
          if (navigateSide(slot, room.id, null)) peer.open = false;
        }, 'rack-picker-option'));
      }
    }
  }
  function activateSide(side) {
    activeSide = panelsBySide[side] ? side : shared ? sideOrder[0] : 'left';
    if (!views[activeSide]) { activeCabinetId = null; return; }
    activeRoomId = views[activeSide].roomId;
    activeCabinetId = views[activeSide].cabinetId;
  }
  function navigateSide(side, roomId, cabinetId) {
    if (!canDiscard()) return false;
    if (side === 'left') {
      peerModes.middle = 'auto';
      peerModes.right = 'auto';
    } else {
      peerModes[side] = 'manual';
    }
    activateSide(side);
    return navigate(roomId, cabinetId, null, false);
  }
  function renderFold() {
    const fold = $('rack-unplaced-fold');
    if (!fold) return;
    const unplaced = devices.filter((device) => !device.cabinetId);
    const conflicts = devices.filter((device) => device.cabinetId && placementError(device));
    fold.querySelector('summary').innerHTML = `<svg class="fold-arrow" aria-hidden="true"><use href="#right"/></svg>未上架 ${unplaced.length} <span style="margin:0 6px;color:var(--border)">/</span><span style="color:var(--warning)">冲突 ${conflicts.length}</span><span style="margin-left:auto;font-size:11px;color:var(--muted)">查看设备</span>`;
    const body = fold.querySelector('.fold-body');
    body.replaceChildren();
    if (shared) {
      for (const device of [...unplaced, ...conflicts]) {
        const issue = device.cabinetId ? placementError(device) : '未上架';
        const row = document.createElement('div');
        row.append(button(`${device.name} · ${issue}`, () => shared.openObject('infrastructure', device.id), device.cabinetId ? 'pill warning' : 'pill'));
        row.append(button('编辑位置', () => { if (selectDevice(device.id)) openDeviceEditor(); }, 'quiet'));
        body.append(row);
      }
      if (!unplaced.length && !conflicts.length) body.textContent = '所有设备均已正常上架。';
      return;
    }
    for (const device of unplaced) body.append(button(`${device.name} · ${device.height}U`, () => selectDevice(device.id), 'pill'));
    for (const device of conflicts) body.append(button(`${device.name} · ${placementError(device)}`, () => selectDevice(device.id), 'pill warning'));
    if (!unplaced.length && !conflicts.length) body.textContent = '所有设备均已正常上架。';
  }
  function renderSearch() {
    searchResults.replaceChildren();
    searchResults.hidden = !searchTerm;
    if (!searchTerm) return;
    const matches = devices.filter((device) => `${device.name} ${device.code} ${device.model} ${device.ip || ''} ${device.mgmt_ip || ''} ${device.biz_ip || ''} ${device.person || ''} ${roomById(device.roomId)?.name || ''} ${cabinetById(device.cabinetId)?.name || ''}`.toLowerCase().includes(searchTerm));
    const heading = document.createElement('span');
    heading.textContent = `匹配 ${matches.length} 台：`;
    searchResults.append(heading);
    for (const device of matches) searchResults.append(button(`${device.name} · ${cabinetById(device.cabinetId)?.name || '未上架'}`, () => shared ? shared.openObject('infrastructure', device.id) : selectDevice(device.id)));
  }

  function bindPortAction(badge, action) {
    badge.setAttribute('role', 'button');
    badge.setAttribute('aria-label', badge.title);
    badge.tabIndex = 0;
    badge.addEventListener('click', (event) => {
      event.stopPropagation();
      action();
    });
    badge.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      event.stopPropagation();
      badge.click();
    });
  }

  function portSideForMiddleDevice(device, link) {
    const isServerSide = link.serverId === device.id;
    const peerDevice = deviceById(isServerSide ? link.switchId : link.serverId);
    const peerCabId = peerDevice?.cabinetId;
    if (peerCabId && peerCabId === views.left.cabinetId && views.left.cabinetId !== views.middle.cabinetId) {
      return 'left';
    }
    if (peerCabId && peerCabId === views.middle.cabinetId && views.left.cabinetId === views.middle.cabinetId) {
      return isServerSide ? 'right' : 'left';
    }
    return 'right';
  }

  function renderRackView(side) {
    const view = views[side];
    const targetPanel = panelsBySide[side];
    if (!targetPanel) return;
    const targetGrid = targetPanel.querySelector('.rack-grid');
    const cabinet = cabinetById(view.cabinetId);
    targetGrid.replaceChildren();
    targetPanel.querySelector('h1').textContent = cabinet ? `${shared ? `${roomById(cabinet.roomId)?.name || ''} · ` : ''}${cabinet.name} 机柜` : '暂无机柜';
    targetPanel.querySelector('.rack-units-edit').disabled = !cabinet;
    targetPanel.querySelector('.rack-total-units').textContent = cabinet ? `${cabinet.total}U` : '—';
    const placed = placedIn(cabinet?.id);
    const used = placed.reduce((sum, device) => sum + device.height, 0);
    targetPanel.querySelector('.rack-capacity-summary').textContent = cabinet ? `已用 ${used}U · 空闲 ${cabinet.total - used}U · 已上架 ${placed.length} 台` : '在顶部目录新建空机柜';
    targetPanel.querySelector('.usage > span').style.width = cabinet ? `${used / cabinet.total * 100}%` : '0%';
    targetGrid.style.gridTemplateRows = cabinet ? `repeat(${cabinet.total}, 24px)` : 'auto';
    if (!cabinet) {
      const note = document.createElement('p');
      note.className = 'rack-empty-grid';
      note.textContent = '此机房暂无机柜';
      targetGrid.append(note);
      return;
    }
    targetGrid.setAttribute('aria-label', `${roomById(cabinet.roomId)?.name || ''} ${cabinet.name} · ${cabinet.total}U 机柜预览`);
    const choose = (device) => { uFocusId = null; selectDevice(device.id, side); };
    const empty = (unit) => { if (!canDiscard()) return; activateSide(side); openUnit(unit); };

    // Left & Middle cabinets: U-label col 1 (left), slot col 2 (right)
    // Right cabinet: slot col 1 (left), U-label col 2 (right)
    const labelCol = side === 'right' ? 2 : 1;
    const slotCol = side === 'right' ? 1 : 2;

    for (let unit = cabinet.total; unit >= 1; unit--) {
      const occupying = placed.find((device) => unit >= device.start && unit < device.start + device.height);
      const label = button(String(unit), () => occupying ? choose(occupying) : empty(unit), 'u-label');
      const slot = button('', () => occupying ? choose(occupying) : empty(unit), 'slot');
      for (const node of [label, slot]) {
        node.setAttribute('aria-label', `${cabinet.name} ${unit}U · ${occupying ? occupying.name : '空闲，可新增或上架设备'}`);
        node.style.gridRow = cabinet.total + 1 - unit;
      }
      label.style.gridColumn = labelCol;
      slot.style.gridColumn = slotCol;
      if (occupying) {
        slot.tabIndex = -1;
        if (side === 'middle') label.tabIndex = -1;
      }
      targetGrid.append(label, slot);
    }

    for (const device of placed) {
      const node = button('', () => choose(device), `device${device.id === selectedId ? ' selected' : ''}${shared && device.person_id ? ' owner-linked' : ''}${shared && device.id === uFocusId ? ' u-focus' : ''}`);
      node.dataset.deviceId = device.id;
      node.dataset.deviceType = device.type || '其他';
      node.dataset.units = String(device.height);
      node.setAttribute('aria-pressed', String(device.id === selectedId));
      node.style.gridColumn = String(slotCol);
      node.style.gridRow = `${cabinet.total + 1 - (device.start + device.height - 1)}/span ${device.height}`;
      node.title = `${device.name}（${device.start}–${device.start + device.height - 1}U）· ${device.vendor || ''} ${device.model || ''} · 点击查看或编辑完整属性与端口`;
      if (shared) node.addEventListener('dblclick', (event) => { event.stopPropagation(); openDeviceEditor(); });

      const main = document.createElement('div');
      main.className = 'device-chassis-main';
      const led = document.createElement('span');
      led.className = 'device-led';
      led.setAttribute('aria-hidden', 'true');

      const info = document.createElement('div');
      info.className = 'device-info';
      const titleRow = document.createElement('div');
      titleRow.className = 'device-title-row';
      const typeTag = document.createElement('span');
      typeTag.className = 'device-type-tag';
      typeTag.textContent = `${device.height}U`;
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = device.name;
      if (shared) name.addEventListener('click', (event) => { event.stopPropagation(); shared.openObject('infrastructure', device.id); });
      titleRow.append(typeTag, name);

      const meta = document.createElement('span');
      meta.className = 'meta';
      const endU = device.start + device.height - 1;
      const vendorModel = [device.vendor !== '未指定' ? device.vendor : '', device.model].filter(Boolean).join(' · ') || device.code || device.type;
      meta.textContent = `${device.start}–${endU}U · ${vendorModel}`;
      info.append(titleRow, meta);
      if (shared) {
        const contact = document.createElement('span');
        contact.className = 'rack-card-links';
        for (const ip of [device.ip, device.mgmt_ip, device.biz_ip, device.service_ip, device.physical_ip].filter(Boolean).slice(0, 2)) {
          const ipLink = button(String(ip).split('/')[0], (event) => { event.stopPropagation(); shared.openObject('ip', String(ip).split('/')[0]); }, 'rack-mini-link');
          ipLink.title = `打开 IP 资产详情 · ${ip}`;
          contact.append(ipLink);
        }
        if (device.person_id) {
          const person = (shared.people || []).find((item) => String(item.id) === String(device.person_id));
          const owner = device.person || device.person_name || device.owner || person?.name || '';
          if (owner) {
            const personLink = button(owner, (event) => { event.stopPropagation(); shared.openObject('person', device.person_id); }, 'rack-mini-link');
            personLink.title = `打开人员详情 · ${owner}`;
            contact.append(personLink);
          }
        }
        info.append(contact);
      }
      main.append(led, info);

      const portsLeftStrip = document.createElement('div');
      portsLeftStrip.className = 'device-ports-strip ports-left';
      const portsRightStrip = document.createElement('div');
      portsRightStrip.className = 'device-ports-strip ports-right';

      const links = connections
        .filter((link) => link.serverId === device.id || link.switchId === device.id)
        .sort((a, b) => {
          const peerA = deviceById(a.serverId === device.id ? a.switchId : a.serverId);
          const peerB = deviceById(b.serverId === device.id ? b.switchId : b.serverId);
          const midCab = views.middle?.cabinetId;
          const isOverheadA = peerA?.cabinetId && peerA.cabinetId !== device.cabinetId && peerA.cabinetId !== midCab && device.cabinetId !== midCab;
          const isOverheadB = peerB?.cabinetId && peerB.cabinetId !== device.cabinetId && peerB.cabinetId !== midCab && device.cabinetId !== midCab;
          if (isOverheadA !== isOverheadB) return isOverheadA ? -1 : 1;
          return (peerB?.start || 0) - (peerA?.start || 0);
        });

      if (links.length) {
        for (const link of links) {
          const isServerSide = link.serverId === device.id;
          const portName = isServerSide ? link.serverPort : link.switchPort;
          const peerDevice = deviceById(isServerSide ? link.switchId : link.serverId);
          const peerPort = isServerSide ? link.switchPort : link.serverPort;
          const medium = linkMedium(link);
          const modeObj = linkPortMode(link);
          const vlanStr = linkVlanLabel(link);
          const peerSlot = shared ? sideOrder.find((slot) => views[slot].cabinetId === peerDevice?.cabinetId) : null;
          const badgeSide = shared ? (peerSlot && sideOrder.indexOf(peerSlot) < sideOrder.indexOf(side) ? 'left' : 'right') : side === 'left' ? 'right' : side === 'right' ? 'left' : portSideForMiddleDevice(device, link);
          const badge = document.createElement('span');
          badge.className = `port-badge rack-port-badge port-${medium} mode-${modeObj.id}${link.id === selectedConnectionId ? ' is-selected' : ''}`;
          badge.dataset.connectionId = link.id;
          badge.dataset.endpoint = isServerSide ? 'server' : 'switch';
          badge.dataset.portName = portName;
          badge.dataset.portMode = modeObj.id;
          badge.dataset.portSide = badgeSide;
          badge.textContent = device.height === 1 ? portName : `${portName}·${modeObj.code}`;
          badge.title = `${portName} · ${modeObj.fullLabel} (${modeObj.code}) · ${vlanStr} · [${linkMediumLabel(link)}] ↔ ${peerDevice?.name || ''} · ${peerPort}`;
          bindPortAction(badge, () => {
            if (selectDevice(device.id, side)) selectConnection(link.id);
          });
          if (badgeSide === 'left') portsLeftStrip.append(badge);
          else portsRightStrip.append(badge);
        }
      } else {
        const idlePort = defaultPortsForDevice(device)[0] || 'eth0';
        const spec = inferPortSpec(device, idlePort);
        const modeObj = getPortMode(spec.mode);
        const badgeSide = side === 'right' ? 'left' : 'right';
        const badge = document.createElement('span');
        badge.className = `port-badge rack-port-badge port-idle mode-${modeObj.id}`;
        badge.dataset.portName = idlePort;
        badge.dataset.portMode = modeObj.id;
        badge.dataset.portSide = badgeSide;
        badge.textContent = device.height === 1 ? idlePort : `${idlePort}·${modeObj.code}`;
        badge.title = `${idlePort} · ${modeObj.fullLabel} (${modeObj.code}) · ${spec.vlan || modeObj.defaultVlan} · 空闲端口（点击快速配线）`;
        bindPortAction(badge, () => {
          openConnection(null, { deviceId: device.id, port: idlePort, portMode: modeObj.id, vlan: spec.vlan || modeObj.defaultVlan });
        });
        if (badgeSide === 'left') portsLeftStrip.append(badge);
        else portsRightStrip.append(badge);
      }

      node.append(portsLeftStrip, main, portsRightStrip);
      targetGrid.append(node);
    }
  }

  function renderRack() {
    recomputeAutoPeers();
    updateLegendFilterUI();
    renderSelectors();
    for (const side of sideOrder) renderRackView(side);
    renderFold();
    renderSearch();
    syncManagerSelection();
    renderConnections();
    renderSidebarPortsAndLinks();
    requestAnimationFrame(drawConnections);
  }
  function navigate(roomId, cabinetId, deviceId = null, guard = true) {
    if (guard && !canDiscard()) return false;
    if (shared) {
      if (cabinetId) {
        const slot = ensureWorkbenchCabinet(cabinetId);
        if (slot) activateSide(slot);
      } else {
        activeRoomId = roomId;
        activeCabinetId = null;
      }
      selectedId = deviceId || placedIn(cabinetId).at(0)?.id || null;
      draft = selectedId ? cloneDevice(deviceById(selectedId)) : null;
      dirty = false;
      renderRack();
      fillEditor();
      scrollSelected();
      return true;
    }
    activeRoomId = roomId;
    activeCabinetId = cabinetId;
    views[activeSide] = { roomId, cabinetId };
    if (activeSide === 'left') recomputeAutoPeers();
    selectedId = deviceId || placedIn(cabinetId).at(0)?.id || null;
    draft = selectedId ? cloneDevice(deviceById(selectedId)) : null;
    dirty = false;
    renderRack();
    fillEditor();
    scrollSelected();
    return true;
  }
  function selectDevice(id, side = activeSide) {
    const device = deviceById(id);
    if (!device || !canDiscard()) return false;
    if (shared && device.cabinetId) {
      const slot = ensureWorkbenchCabinet(device.cabinetId);
      if (slot) activateSide(slot);
      selectedId = device.id;
      draft = cloneDevice(device);
      dirty = false;
      renderRack();
      fillEditor();
      scrollSelected();
      return true;
    }
    if (shared) side = activeSide;
    if (device.cabinetId) {
      const matchingSlot = sideOrder.find((slot) => views[slot].cabinetId === device.cabinetId);
      activateSide(matchingSlot || side);
      navigate(device.roomId, device.cabinetId, id, false);
    } else {
      activateSide(side);
      selectedId = id;
      draft = cloneDevice(device);
      dirty = false;
      renderRack();
      fillEditor();
    }
    return true;
  }

  function makeDialog(id, title, body, footerMarkup = '') {
    const dialog = document.createElement('dialog');
    dialog.id = id;
    dialog.className = 'rack-prototype-dialog record-shell record-dialog';
    dialog.setAttribute('aria-labelledby', `${id}-title`);
    dialog.innerHTML = `<header class="dialog-header record-header"><h2 id="${id}-title"></h2><button type="button" class="icon quiet" aria-label="关闭"><svg aria-hidden="true"><use href="#close"/></svg></button></header>${body}${footerMarkup}`;
    dialog.querySelector('h2').textContent = title;
    dialog.querySelector('.dialog-body')?.classList.add('record-body');
    dialog.querySelector('.dialog-footer')?.classList.add('record-footer');
    dialog.querySelector('.dialog-header button').addEventListener('click', () => dialog.close());
    document.body.append(dialog);
    return dialog;
  }

  toolbar.querySelectorAll('[data-create-mode]').forEach((node) => node.addEventListener('click', () => {
    node.closest('details').open = false; activateSide('left'); openManager(node.dataset.createMode);
  }));

  const unitDialog = makeDialog('rack-unit-actions', '空 U 位操作', '<div class="dialog-body"><p class="dialog-note">仅在本页预览中编辑，保存前不改变机柜占用。</p><div class="rack-unit-actions"></div><label class="field rack-mount-choice">选择未上架设备<select id="rack-mount-device"></select></label><p id="rack-unit-feedback" role="status"></p></div>');
  const newDeviceButton = button('新增设备', () => stageDevice(null), 'primary');
  const mountDeviceButton = button('上架已有设备', () => stageDevice($('rack-mount-device').value));
  unitDialog.querySelector('.rack-unit-actions').append(newDeviceButton, mountDeviceButton);

  function openUnit(unit) {
    const cabinet = cabinetById(activeCabinetId);
    if (!cabinet) return;
    pendingUnit = unit;
    $('rack-unit-actions-title').textContent = `在 ${cabinet.name} 的 ${unit}U`;
    const available = devices.filter((device) => !device.cabinetId);
    options($('rack-mount-device'), available, available[0]?.id, available.length ? null : '暂无未上架设备');
    mountDeviceButton.disabled = !available.length;
    $('rack-unit-feedback').textContent = shared ? '新增或上架将在独立编辑对话框预填位置；保存后同步资产与机柜占用。' : '新增设备将在右侧栏打开空白草稿；上架已有设备将预填位置，均须保存后确认。';
    unitDialog.showModal();
  }
  function stageDevice(id) {
    if (!canDiscard()) return;
    const existing = id ? deviceById(id) : null;
    if (id && (!existing || existing.cabinetId)) { $('rack-unit-feedback').textContent = '请选择未上架设备。'; return; }
    draft = existing ? cloneDevice(existing) : { id: null, name: '', code: '', type: '交换机', vendor: '未指定', model: '', height: 1, photos: { front: false, back: false }, isNew: true };
    draft.roomId = activeRoomId;
    draft.cabinetId = activeCabinetId;
    draft.start = pendingUnit;
    draft.placed = true;
    draft.staged = true;
    selectedId = existing?.id || null;
    dirty = true;
    unitDialog.close();
    switchSidebarTab('device');
    renderRack();
    fillEditor();
    if (shared) { openDeviceEditor(); notify('已在独立设备编辑对话框打开草稿；保存后同步共享机柜占用。'); }
    else notify('已在右侧栏打开设备草稿；点击「保存设备」才会提交到本页内存。');
    fields.name.focus();
  }

  for (const field of [fields.start, fields.height]) {
    field.type = 'number'; field.min = '1'; field.max = '60'; field.step = '1';
  }
  fields.name.required = true;
  for (const [key, field] of Object.entries(fields)) {
    field.addEventListener('input', () => {
      if (!draft) return;
      if (key === 'roomId') {
        options(fields.cabinetId, cabinets.filter((cabinet) => cabinet.roomId === fields.roomId.value), '', '请选择机柜');
      }
      dirty = true;
      readDraft();
      editorCaption.textContent = draft.isNew ? '新增设备草稿 · 尚未保存' : '设备修改草稿 · 尚未保存';
      error('');
      updatePositionHint();
    });
  }

  saveButton.addEventListener('click', () => {
    readDraft();
    if (!draft) return;
    if (!draft.name) { error('请填写设备名称。'); fields.name.focus(); return; }
    if (!Number.isInteger(draft.height) || draft.height < 1 || draft.height > 60) { error('占用 U 数必须为 1–60 的整数。'); return; }
    const issue = placementError(draft);
    if (issue) { error(issue); return; }
    const original = deviceById(draft.id);
    if (original && original.type !== draft.type && connections.some((link) => link.serverId === draft.id || link.switchId === draft.id)) {
      error('设备仍有端口跳线连接，请先删除相关连接再更改设备类型。'); return;
    }
    let saved = { ...draft, id: draft.id || `local-device-${++sequence}`, photos: { ...draft.photos } };
    delete saved.isNew; delete saved.staged; delete saved.placed;
    if (!draft.placed) { saved.start = null; saved.roomId = null; saved.cabinetId = null; }
    if (shared) {
      saved.start_u = saved.start;
      saved.height_u = saved.height;
      delete saved.start; delete saved.height;
      if (!original) delete saved.id;
      try { saved = shared.saveAsset('infrastructure', saved, { id: original?.id, title: original ? '更新机柜设备' : '新增机柜设备' }); }
      catch (issue) { error(issue.message); return; }
    } else {
      const index = devices.findIndex((device) => device.id === saved.id);
      if (index < 0) devices.push(saved); else devices[index] = saved;
    }
    dirty = false;
    draft = cloneDevice(saved);
    selectedId = saved.id;
    if (saved.cabinetId) { activeRoomId = saved.roomId; activeCabinetId = saved.cabinetId; }
    if (shared) {
      if (saved.cabinetId) ensureWorkbenchCabinet(saved.cabinetId);
    } else {
      views[activeSide] = { roomId: activeRoomId, cabinetId: activeCabinetId };
    }
    renderRack(); fillEditor(); scrollSelected();
    notify(shared ? `已保存「${saved.name}」并同步共享机柜占用与履历。` : `已保存「${saved.name}」到本页预览内存。`);
  });

  resetButton.addEventListener('click', () => {
    if (!canDiscard()) return;
    const selected = deviceById(selectedId);
    draft = selected ? cloneDevice(selected) : null;
    dirty = false;
    renderRack(); fillEditor();
    notify('已放弃未保存的设备修改。');
  });

  unmountButton.addEventListener('click', () => {
    const device = deviceById(selectedId);
    if (!device?.cabinetId || !canDiscard() || !window.confirm(`将「${device.name}」下架到未上架设备？仅影响本页预览。`)) return;
    if (shared) {
      try { shared.changeAsset(`infrastructure:${device.id}`, { roomId: null, cabinetId: null, start_u: null }, '设备下架'); }
      catch (issue) { error(issue.message); return; }
    } else { device.roomId = null; device.cabinetId = null; device.start = null; }
    draft = cloneDevice(device); dirty = false;
    renderRack(); fillEditor();
    notify(shared ? '设备已下架并同步共享机柜占用；可点击空 U 位重新上架。' : '设备已下架，仍保留在右侧栏底部「未上架」列表，可点击空 U 位再次上架。');
  });

  const deleteDeviceButton = button('删除设备', () => {
    const device = deviceById(selectedId);
    if (!device || !canDiscard() || !window.confirm(`删除本页示例设备「${device.name}」及其端口连接？刷新恢复示例。`)) return;
    if (shared) {
      try { shared.archiveAsset(`infrastructure:${device.id}`, '从机柜管理归档设备'); }
      catch (issue) { error(issue.message); return; }
    } else devices.splice(devices.indexOf(device), 1);
    for (let i = connections.length - 1; i >= 0; i--) if (connections[i].serverId === device.id || connections[i].switchId === device.id) connections.splice(i, 1);
    if (shared) shared.notify();
    selectedId = placedIn(activeCabinetId)[0]?.id || null;
    draft = selectedId ? cloneDevice(deviceById(selectedId)) : null;
    dirty = false;
    renderRack(); fillEditor();
    notify(shared ? '设备已从共享原型归档移除，关联端口连接已清理并记录履历。' : '已删除本页示例设备及其连接。');
  }, 'quiet');
  footer.prepend(deleteDeviceButton);

  // Room & Cabinet Manager Dialog (aligned with network-preview.html #pool-editor)
  const manager = document.createElement('dialog');
  manager.id = 'rack-manager';
  manager.className = 'rack-prototype-dialog pool-maintenance record-shell record-dialog';
  manager.setAttribute('aria-labelledby', 'rack-manager-title');
  manager.innerHTML = `
    <header class="dialog-header record-header">
      <h2 id="rack-manager-title">维护机房与机柜</h2>
      <button type="button" class="icon quiet rack-manager-close" aria-label="关闭维护机房与机柜"><svg aria-hidden="true"><use href="#close"/></svg></button>
    </header>
    <div class="rack-manager-body">
      <aside class="rack-directory" aria-label="机房与机柜目录">
        <label class="rack-directory-search"><svg aria-hidden="true"><use href="#search"/></svg><input id="rack-directory-find" type="search" aria-label="搜索机房或机柜" placeholder="搜索机房、机柜名称"></label>
        <div id="rack-directory-list" class="rack-directory-list" role="listbox" aria-label="机房与机柜列表"></div>
      </aside>
      <form id="rack-management-form" class="rack-management-form dialog-body record-body">
        <section class="record-section">
          <h3 id="rack-management-title" class="section-title"></h3>
          <p id="rack-management-scope" class="rack-management-scope"></p>
          <div class="record-fields fields">
            <div class="field full"><label for="rack-management-room">所属机房</label><select id="rack-management-room"></select></div>
            <div class="field full"><label for="rack-management-name">名称</label><input id="rack-management-name" required maxlength="80"></div>
            <div id="rack-management-capacity" class="field full"><label for="rack-management-number">机柜总 U 数（1–60）</label><div class="rack-capacity-controls"><input id="rack-management-range" type="range" min="1" max="60" step="1" value="42" aria-label="机柜总 U 数滑块"><input id="rack-management-number" type="number" min="1" max="60" step="1" required value="42" aria-label="机柜总 U 数"></div></div>
          </div>
          <p class="dialog-note">机柜容量不是设备高度。新建机柜始终为空；修改总 U 数会保留当前设备，且不能小于最高占用 U 位。同名机柜按所属机房隔离。</p>
          <p id="rack-management-error" class="rack-editor-error" role="alert" hidden></p>
          <p id="rack-management-status" class="dialog-note" role="status"></p>
        </section>
      </form>
    </div>
    <footer class="dialog-footer record-footer">
      <button type="button" class="rack-manager-cancel">关闭</button>
      <button type="submit" form="rack-management-form" class="primary" id="rack-management-save">保存预览</button>
    </footer>`;
  document.body.append(manager);
  function discardManager() { return !managerDirty || window.confirm('机房 / 机柜有未保存修改，放弃草稿？'); }
  function closeManager() { if (discardManager()) { managerDirty = false; manager.close(); } }
  manager.querySelector('.rack-manager-close').addEventListener('click', closeManager);
  manager.querySelector('.rack-manager-cancel').addEventListener('click', closeManager);
  manager.addEventListener('cancel', (event) => { event.preventDefault(); closeManager(); });
  $('rack-management-form').addEventListener('input', () => { managerDirty = true; });
  $('rack-directory-find').addEventListener('input', () => {
    managerSearchTerm = $('rack-directory-find').value.trim().toLowerCase();
    renderDirectory();
  });

  function renderDirectory() {
    const directory = $('rack-directory-list');
    if (!directory) return;
    directory.replaceChildren();
    const needle = managerSearchTerm;
    let matchCount = 0;
    for (const room of rooms) {
      const roomCabinets = cabinets.filter((item) => item.roomId === room.id);
      const roomMatches = !needle || room.name.toLowerCase().includes(needle);
      const filteredCabinets = roomMatches
        ? roomCabinets
        : roomCabinets.filter((cab) => cab.name.toLowerCase().includes(needle));
      if (!roomMatches && !filteredCabinets.length) continue;
      matchCount++;
      const group = document.createElement('section');
      const totalUnits = roomCabinets.reduce((sum, cabinet) => sum + cabinet.total, 0);
      const usedUnits = roomCabinets.reduce((sum, cabinet) => sum + placedIn(cabinet.id).reduce((units, device) => units + device.height, 0), 0);
      const heading = button('', () => {
        if (!discardManager()) return;
        managerRoomId = room.id;
        managerCabinetId = roomCabinets[0]?.id || null;
        managerMode = managerCabinetId ? 'cabinet-edit' : 'cabinet-new';
        renderManager();
      }, `rack-directory-room${room.id === managerRoomId && (!managerCabinetId || managerMode !== 'cabinet-edit') ? ' selected' : ''}`);
      const title = document.createElement('strong'); title.textContent = room.name;
      const metadata = document.createElement('small');
      metadata.textContent = `${roomCabinets.length} 个机柜 · 已用 ${usedUnits}/${totalUnits}U`;
      heading.append(title, metadata);
      group.append(heading);
      const children = document.createElement('div'); children.className = 'rack-directory-cabinets';
      for (const cabinet of filteredCabinets) {
        const isSelected = managerMode === 'cabinet-edit' && cabinet.id === managerCabinetId;
        const item = button('', () => {
          if (!discardManager()) return;
          managerRoomId = room.id; managerCabinetId = cabinet.id; managerMode = 'cabinet-edit'; renderManager();
        }, `rack-directory-cabinet${isSelected ? ' selected' : ''}`);
        item.setAttribute('aria-selected', String(isSelected));
        const name = document.createElement('span'); name.textContent = cabinet.name;
        const detail = document.createElement('span'); detail.className = 'rack-directory-meta'; detail.textContent = `${cabinet.total}U · ${placedIn(cabinet.id).length} 台`;
        item.append(name, detail);
        children.append(item);
      }
      if (!roomCabinets.length) { const note = document.createElement('small'); note.textContent = '暂无机柜（点击新建）'; children.append(note); }
      group.append(children);
      directory.append(group);
    }
    if (!matchCount) {
      const empty = document.createElement('p');
      empty.className = 'dialog-note';
      empty.textContent = '没有匹配的机房或机柜';
      directory.append(empty);
    }
  }
  function renderManager() {
    managerDirty = false;
    renderDirectory();
    const cabinet = cabinetById(managerCabinetId);
    const roomNew = managerMode === 'room-new';
    const editing = managerMode === 'cabinet-edit' && cabinet;
    options($('rack-management-room'), rooms, managerRoomId);
    $('rack-management-room').closest('.field').hidden = roomNew;
    $('rack-management-room').disabled = roomNew;
    $('rack-management-title').textContent = roomNew ? '新建机房' : editing ? `编辑选中机柜 · ${cabinet.name}` : '新建空机柜';
    const storageNote = shared ? '保存后同步资产位置与履历；刷新页面恢复示例。' : '原型不保存业务数据。';
    $('rack-management-scope').textContent = roomNew
      ? `新建表单为空白；创建机房后可继续在该机房下新建空机柜。${storageNote}`
      : editing
        ? `左侧可搜索并切换任意机房与机柜，右侧编辑当前所选。${storageNote}`
        : `新建表单为空白，不覆盖当前机柜；也可在左侧点击任意机柜切换为编辑。${storageNote}`;
    $('rack-management-name').value = editing ? cabinet.name : '';
    $('rack-management-name').placeholder = roomNew ? '例如：测试机房' : '例如：A-88';
    $('rack-management-capacity').hidden = roomNew;
    $('rack-management-number').disabled = $('rack-management-range').disabled = roomNew;
    $('rack-management-number').value = $('rack-management-range').value = editing ? cabinet.total : 42;
    $('rack-management-error').hidden = true;
    $('rack-management-status').textContent = '';
    $('rack-management-save').textContent = '保存预览';
  }
  function openManager(mode = 'cabinet-edit') {
    if (!discardManager()) return;
    closeAllDropdownMenus();
    managerRoomId = activeRoomId; managerCabinetId = activeCabinetId;
    managerMode = mode === 'cabinet-edit' && !activeCabinetId ? 'cabinet-new' : mode;
    renderManager();
    if (!manager.open) manager.showModal();
  }
  function focusManager() { openManager(); }
  function syncManagerSelection() {
    if (manager.open) { renderDirectory(); return; }
    managerRoomId = activeRoomId; managerCabinetId = activeCabinetId;
    managerMode = activeCabinetId ? 'cabinet-edit' : 'cabinet-new';
    renderManager();
  }
  $('rack-management-range').addEventListener('input', () => { $('rack-management-number').value = $('rack-management-range').value; });
  $('rack-management-number').addEventListener('input', () => {
    if ($('rack-management-number').validity.valid) $('rack-management-range').value = $('rack-management-number').value;
  });
  $('rack-management-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const fail = (text) => { $('rack-management-error').textContent = text; $('rack-management-error').hidden = false; };
    const name = $('rack-management-name').value.trim();
    if (!name) { fail('名称不能为空。'); return; }
    if (!canDiscard()) return;
    if (managerMode === 'room-new') {
      if (rooms.some((room) => room.name === name)) { fail('已存在同名机房。'); return; }
      const room = { id: `local-room-${++sequence}`, name };
      rooms.push(room);
      managerDirty = false;
      navigate(room.id, null, null, false);
      managerRoomId = room.id; managerCabinetId = null; managerMode = 'cabinet-new'; renderManager();
      $('rack-management-name').focus({ preventScroll: true });
      $('rack-management-status').textContent = `已创建机房「${name}」，可继续新建空机柜。`;
      notify(`已创建机房「${name}」，尚无机柜；可继续新建空机柜。`);
      if (shared) shared.record({ title: '新建机房', text: name, objectType: 'room', objectId: room.id });
      return;
    }
    const roomId = $('rack-management-room').value;
    const total = Number($('rack-management-number').value);
    if (!roomById(roomId)) { fail('请选择有效机房。'); return; }
    if (!Number.isInteger(total) || total < 1 || total > 60) { fail('机柜总 U 数必须为 1–60 的整数。'); return; }
    const editing = managerMode === 'cabinet-edit' ? cabinetById(managerCabinetId) : null;
    if (cabinets.some((cabinet) => cabinet.roomId === roomId && cabinet.name === name && cabinet.id !== editing?.id)) { fail('当前机房已存在同名机柜；不同机房可以使用相同名称。'); return; }
    if (editing) {
      const occupied = placedIn(editing.id);
      const highest = Math.max(0, ...occupied.map((device) => device.start + device.height - 1));
      if (total < highest) { fail(`当前设备最高占用 ${highest}U，不能缩小到 ${total}U。设备位置保持不变。`); return; }
      Object.assign(editing, { name, roomId, total });
      for (const device of occupied) device.roomId = roomId;
      if (shared) {
        for (const device of occupied) {
          device.room = roomById(roomId).name;
          device.cabinet = name;
        }
        for (const side of sideOrder) if (views[side].cabinetId === editing.id) views[side].roomId = roomId;
      }
      navigate(roomId, editing.id, null, false);
    } else {
      const cabinet = { id: `local-cabinet-${++sequence}`, roomId, name, total };
      cabinets.push(cabinet);
      navigate(roomId, cabinet.id, null, false);
    }
    if (shared) renderWorkbenchPanels();
    managerRoomId = activeRoomId;
    managerCabinetId = activeCabinetId;
    managerMode = 'cabinet-edit';
    renderManager();
    $('rack-management-status').textContent = `已${editing ? '修改' : '创建空'}机柜「${name}」· ${total}U。`;
    notify(`已${editing ? '修改' : '创建空'}机柜「${name}」· ${total}U。`);
    if (shared) shared.record({ title: editing ? '维护机柜' : '新建机柜', text: `${name} · ${total}U`, objectType: 'rack', objectId: activeCabinetId, assetKeys: placedIn(activeCabinetId).map((device) => `infrastructure:${device.id}`) });
  });

  $('rack-units-edit').addEventListener('click', () => { activateSide('left'); focusManager(); });
  middlePanel?.querySelector('.rack-units-edit')?.addEventListener('click', () => { activateSide('middle'); focusManager(); });
  rightPanel?.querySelector('.rack-units-edit')?.addEventListener('click', () => { activateSide('right'); focusManager(); });
  const searchInput = toolbar.querySelector('.search input');
  searchInput.addEventListener('input', () => { searchTerm = searchInput.value.trim().toLowerCase(); renderSearch(); });

  const detailDialog = makeDialog('rack-device-info', '设备详情（预览）', '<div class="dialog-body"><p id="rack-device-info-content"></p><p class="dialog-note">仅展示本页已保存的原型设备，无接口、SSH 或真实采集。</p></div>');
  panel.querySelector('.editor-head button').addEventListener('click', () => {
    const device = deviceById(selectedId);
    if (!device) return;
    if (shared) { shared.openObject('infrastructure', device.id); return; }
    const cabinet = cabinetById(device.cabinetId);
    $('rack-device-info-content').textContent = `${device.name} · ${device.code || '无资产编号'} · ${device.type} · ${device.model || '未填写型号'} · ${cabinet ? `${roomById(cabinet.roomId).name} / ${cabinet.name} / ${device.start}–${device.start + device.height - 1}U` : '未上架'}`;
    detailDialog.showModal();
  });

  const photoDialog = makeDialog('rack-photo-editor', '设备照片示意（本地预览）', '<div class="dialog-body"><p class="dialog-note">不上传、不读取本地文件，不连接真实设备。以下只设置正反面示意图；仍需保存设备才会提交本页修改。</p><div class="rack-photo-actions"></div></div>');
  function updatePhotoActions() {
    const actions = photoDialog.querySelector('.rack-photo-actions');
    actions.replaceChildren();
    for (const [side, text] of [['front', '正面'], ['back', '背面']]) {
      actions.append(button(`${draft.photos[side] ? '移除' : '设置'}${text}示意图`, () => {
        draft.photos[side] = !draft.photos[side]; dirty = true; renderPhotos(); updatePhotoActions();
        editorCaption.textContent = '照片示意草稿 · 保存设备后生效';
      }));
    }
  }
  panel.querySelector('.image-actions button').addEventListener('click', () => {
    if (!draft) return;
    updatePhotoActions(); photoDialog.showModal();
  });

  function selectFromQuery(query, allowSnapshot = false) {
    const requestedRoom = query.room ? rooms.find((room) => room.name === query.room || room.id === query.room) : roomById(activeRoomId);
    const requestedCabinet = requestedRoom && (query.cabinet ? cabinets.find((cabinet) => cabinet.roomId === requestedRoom.id && (cabinet.name === query.cabinet || cabinet.id === query.cabinet)) : cabinetById(activeCabinetId));
    const device = devices.find((item) => ((!query.device && !query.name) || [item.id, item.name, item.code].includes(query.device) || (query.name && item.name === query.name) || (query.code && item.code === query.code)) && (!query.room || item.roomId === requestedRoom?.id) && (!query.cabinet || item.cabinetId === requestedCabinet?.id));
    if (device && (query.device || query.name)) return selectDevice(device.id);
    if (!shared && allowSnapshot && query.name && query.room && query.cabinet) {
      const start = Number(query.start);
      const height = Number(query.height);
      if (!Number.isInteger(start) || !Number.isInteger(height) || start < 1 || height < 1 || start + height - 1 > 60) {
        notify('链接中的原型设备位置无效（要求整数且在 1–60U 内）；未创建或强制覆盖设备。'); return false;
      }
      let room = requestedRoom;
      if (!room) { room = { id: `snapshot-room-${++sequence}`, name: query.room }; rooms.push(room); }
      let cabinet = cabinets.find((item) => item.roomId === room.id && item.name === query.cabinet);
      if (!cabinet) { cabinet = { id: `snapshot-cabinet-${++sequence}`, roomId: room.id, name: query.cabinet, total: Math.max(42, start + height - 1) }; cabinets.push(cabinet); }
      const snapshot = { id: query.device && !deviceById(query.device) ? query.device : `snapshot-device-${++sequence}`, name: query.name, code: query.code || '', type: '其他', vendor: '未指定', model: '资产原型传入示例', roomId: room.id, cabinetId: cabinet.id, start, height, photos: { front: false, back: false } };
      const issue = placementError(snapshot);
      if (issue) { notify(`未导入链接中的原型快照：${issue}`); return false; }
      devices.push(snapshot);
      navigate(room.id, cabinet.id, snapshot.id, false);
      notify('已定位资产原型传入的本地示例快照。');
      return true;
    }
    if (requestedRoom && (!query.cabinet || requestedCabinet)) {
      const result = navigate(requestedRoom.id, requestedCabinet?.id || cabinets.find((item) => item.roomId === requestedRoom.id)?.id || null);
      if (query.device || query.name) notify('未找到匹配的本地原型设备；链接需提供 name/start/height 才能导入示例快照。');
      return result && !(query.device || query.name);
    }
    notify('没有匹配的本地机房 / 机柜；不会查询真实业务数据。');
    return false;
  }
  const snapshots = (items) => Object.freeze(items.map((item) => Object.freeze({ ...item, ...(item.photos ? { photos: Object.freeze({ ...item.photos }) } : {}) })));

  // Single-line bottom connection control bar
  const connectionSection = $('rack-connections');

  const connectionDialog = makeDialog(
    'rack-connection-dialog',
    '端口跳线与串联配线',
    `<form id="rack-connection-form">
      <div class="dialog-body">
        <div class="rack-link-endpoints">
          <fieldset class="rack-link-endpoint"><legend>本端</legend>
            <label class="field">机房 / 机柜 / 设备<select id="rack-link-server" required></select></label>
            <p id="rack-link-server-location" class="rack-link-location"></p>
            <label class="field">本端端口<select id="rack-link-server-port" required aria-controls="rack-link-server-port-choices"></select></label>
            <div id="rack-link-server-port-choices" class="rack-link-port-choices" role="group" aria-label="本端可选端口"></div>
          </fieldset>
          <span class="rack-link-direction" aria-label="连接至">→</span>
          <fieldset class="rack-link-endpoint"><legend>对端</legend>
            <label class="field">机房 / 机柜 / 设备<select id="rack-link-switch" required></select></label>
            <p id="rack-link-switch-location" class="rack-link-location"></p>
            <label class="field">对端端口<select id="rack-link-switch-port" required aria-controls="rack-link-switch-port-choices"></select></label>
            <div id="rack-link-switch-port-choices" class="rack-link-port-choices" role="group" aria-label="对端可选端口"></div>
          </fieldset>
        </div>
        <fieldset class="rack-link-properties"><legend>连接参数</legend><div class="fields record-fields">
          <label class="field">线缆介质<select id="rack-link-medium"><option value="fiber">光纤 SFP+/LC（10G 光纤）</option><option value="copper">网线 RJ45（1G 网线）</option></select></label>
          <label class="field">速率规格<select id="rack-link-speed"><option value="10G">10G</option><option value="25G">25G</option><option value="1G">1G</option><option value="40G">40G</option></select></label>
          <label class="field">端口模式（Port Mode）<select id="rack-link-port-mode">
            <option value="access">Access 接入口（ACC · 单 VLAN 接入）</option>
            <option value="trunk">Trunk 干道口（TRK · 多 VLAN 干道）</option>
            <option value="hybrid">Hybrid 混杂口（HYB · 混合标签口）</option>
            <option value="mgmt">Mgmt 带外管理口（MGMT · OOB 带外）</option>
            <option value="lacp">LACP 聚合口（LACP · 链路聚合）</option>
            <option value="san">SAN 存储专用口（SAN · 存储/心跳）</option>
          </select></label>
          <label class="field">VLAN / 标识<input id="rack-link-vlan" placeholder="如 VLAN 10 或 VLAN 10,20,30" required maxlength="64"></label>
        </div></fieldset>
        <p id="rack-link-port-comparison" class="rack-link-port-comparison" role="status"></p>
        <p class="dialog-note">本端 → 对端；两侧列表可滚动浏览，每个端口仅能占用一次。切换本端端口或模式会回填连接参数推荐值；对端推荐值不自动覆盖连接参数。</p>
        <p id="rack-link-error" class="rack-editor-error" role="alert"></p>
      </div>
      <footer class="dialog-footer"><button type="submit" class="primary">保存连接（预览）</button></footer>
    </form>`
  );
  const connectionError = $('rack-link-error');

  function placedDevices() {
    return devices.filter((device) => Boolean(device.cabinetId));
  }
  function endpointLabel(device) {
    return `${roomById(device.roomId)?.name} / ${cabinetById(device.cabinetId)?.name} / ${device.name}（${device.type}）`;
  }
  function portOccupation(deviceId, portName) {
    const owner = connections.find((link) => (link.serverId === deviceId && link.serverPort === portName) ||
      (link.switchId === deviceId && link.switchPort === portName));
    return owner ? owner.id === connectionDraftId ? 'current' : 'other' : 'free';
  }
  function refreshPortChoices(selectPortEl) {
    const deviceEl = $(selectPortEl.id === 'rack-link-server-port' ? 'rack-link-server' : 'rack-link-switch');
    const dev = deviceById(deviceEl.value);
    const list = $(`${selectPortEl.id}-choices`);
    list.replaceChildren();
    for (const option of selectPortEl.options) {
      const spec = inferPortSpec(dev, option.value);
      const state = portOccupation(dev?.id, option.value);
      const selected = selectPortEl.value === option.value;
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'rack-link-port-choice';
      item.dataset.occupation = state;
      item.setAttribute('aria-pressed', String(selected));
      const title = document.createElement('strong');
      title.textContent = option.value;
      const status = document.createElement('span');
      status.className = 'rack-link-port-state';
      status.textContent = state === 'current' ? '本连接占用 · 可选' : state === 'other' ? '其他连接占用 · 不可保存' : '空闲';
      const details = document.createElement('small');
      details.textContent = `${getPortMode(spec.mode).label} · ${spec.vlan || getPortMode(spec.mode).defaultVlan}`;
      item.append(title, status, details);
      item.title = `${option.value} · ${details.textContent} · ${status.textContent}`;
      item.addEventListener('click', () => {
        selectPortEl.value = option.value;
        selectPortEl.dispatchEvent(new Event('change', { bubbles: true }));
      });
      list.append(item);
    }
    const chosen = list.querySelector('[aria-pressed="true"]');
    if (chosen) list.scrollTop = Math.max(0, chosen.offsetTop - list.offsetTop - (list.clientHeight - chosen.offsetHeight) / 2);
  }
  function refreshPortComparison() {
    const portA = $('rack-link-server-port').value;
    const portB = $('rack-link-switch-port').value;
    const devA = deviceById($('rack-link-server').value);
    const devB = deviceById($('rack-link-switch').value);
    const specA = inferPortSpec(devA, portA);
    const specB = inferPortSpec(devB, portB);
    const configured = `${getPortMode($('rack-link-port-mode').value).label} · ${$('rack-link-vlan').value.trim()}`;
    const recommended = (spec) => `${getPortMode(spec.mode).label} · ${spec.vlan || getPortMode(spec.mode).defaultVlan}`;
    const mismatch = [specA, specB].some((spec) => spec.mode !== $('rack-link-port-mode').value ||
      (spec.vlan || getPortMode(spec.mode).defaultVlan) !== $('rack-link-vlan').value.trim());
    const comparison = $('rack-link-port-comparison');
    comparison.dataset.conflict = String(mismatch);
    comparison.textContent = `连接参数：${configured}。本端 ${portA} 推荐：${recommended(specA)}；对端 ${portB} 推荐：${recommended(specB)}。${mismatch ? '注意：连接参数与至少一端的端口推荐不一致，请核对后保存。' : '两端推荐与连接参数一致。'}`;
    for (const selectEl of [$('rack-link-server-port'), $('rack-link-switch-port')]) {
      refreshPortChoices(selectEl);
    }
  }
  function refreshEndpointPortOptions(selectDeviceEl, selectPortEl, preferredPort) {
    const dev = deviceById(selectDeviceEl.value);
    const list = portsForDevice(dev);
    selectPortEl.replaceChildren();
    for (const portName of list) {
      const spec = inferPortSpec(dev, portName);
      const state = portOccupation(dev?.id, portName);
      selectPortEl.add(new Option(`${portName} · ${getPortMode(spec.mode).label} · ${spec.vlan || getPortMode(spec.mode).defaultVlan} [${state === 'current' ? '本连接占用' : state === 'other' ? '其他连接占用' : '空闲'}]`, portName));
    }
    if (preferredPort && !list.includes(preferredPort)) selectPortEl.add(new Option(preferredPort, preferredPort));
    selectPortEl.value = preferredPort || list.find((port) => !isPortOccupiedByOther(dev?.id, port, connectionDraftId)) || list[0] || '';
    const location = $(`${selectDeviceEl.id}-location`);
    if (location) location.textContent = dev ? endpointLabel(dev) : '请选择已上架设备';
    refreshPortChoices(selectPortEl);
  }
  function syncLinkFormFromPortSelection() {
    const devA = deviceById($('rack-link-server').value);
    const portA = $('rack-link-server-port').value;
    const spec = inferPortSpec(devA, portA);
    const modeObj = getPortMode(spec.mode);
    $('rack-link-port-mode').value = modeObj.id;
    $('rack-link-vlan').value = spec.vlan || modeObj.defaultVlan;
    if (spec.medium) {
      $('rack-link-medium').value = spec.medium;
      $('rack-link-speed').value = spec.speed || (spec.medium === 'copper' ? '1G' : '10G');
    }
  }
  $('rack-link-server').addEventListener('change', () => {
    refreshEndpointPortOptions($('rack-link-server'), $('rack-link-server-port'));
    syncLinkFormFromPortSelection();
    refreshPortComparison();
  });
  $('rack-link-server-port').addEventListener('change', () => {
    syncLinkFormFromPortSelection();
    refreshPortComparison();
  });
  $('rack-link-switch').addEventListener('change', () => {
    refreshEndpointPortOptions($('rack-link-switch'), $('rack-link-switch-port'));
    refreshPortComparison();
  });
  $('rack-link-switch-port').addEventListener('change', refreshPortComparison);
  $('rack-link-port-mode').addEventListener('change', () => {
    const modeObj = getPortMode($('rack-link-port-mode').value);
    $('rack-link-vlan').value = modeObj.defaultVlan;
    if (modeObj.id === 'san' || modeObj.id === 'trunk') {
      $('rack-link-medium').value = 'fiber';
      $('rack-link-speed').value = '10G';
    } else if (modeObj.id === 'mgmt' || modeObj.id === 'access') {
      $('rack-link-medium').value = 'copper';
      $('rack-link-speed').value = '1G';
    }
    refreshPortComparison();
  });
  $('rack-link-medium').addEventListener('change', () => {
    $('rack-link-speed').value = $('rack-link-medium').value === 'copper' ? '1G' : '10G';
  });
  $('rack-link-vlan').addEventListener('input', refreshPortComparison);

  function openConnection(id = null, preset = null) {
    connectionDraftId = id;
    const link = connections.find((item) => item.id === id);
    const allPlaced = placedDevices();
    const defaultA = preset?.deviceId
      || link?.serverId
      || allPlaced.find((d) => d.cabinetId === (shared ? activeCabinetId : views.left.cabinetId) && d.type !== '交换机')?.id
      || allPlaced[0]?.id;
    const defaultB = link?.switchId
      || allPlaced.find((d) => d.id !== defaultA && d.cabinetId === (shared ? workbenchIds[1] : views.right.cabinetId))?.id
      || allPlaced.find((d) => d.id !== defaultA)?.id
      || allPlaced[0]?.id;

    options($('rack-link-server'), allPlaced.map((device) => ({ id: device.id, name: endpointLabel(device) })), defaultA, '请选择本端设备');
    options($('rack-link-switch'), allPlaced.map((device) => ({ id: device.id, name: endpointLabel(device) })), defaultB, '请选择对端设备');

    const devA = deviceById(defaultA);
    const devB = deviceById(defaultB);
    const firstIdlePort = (dev, excludePort = null) => portsForDevice(dev).find((p) => p !== excludePort && !isPortOccupiedByOther(dev?.id, p, id)) || portsForDevice(dev)[0] || 'eth0';
    const defaultPortA = preset?.port || link?.serverPort || firstIdlePort(devA);
    const defaultPortB = link?.switchPort || firstIdlePort(devB, defaultA === defaultB ? defaultPortA : null);
    refreshEndpointPortOptions($('rack-link-server'), $('rack-link-server-port'), defaultPortA);
    refreshEndpointPortOptions($('rack-link-switch'), $('rack-link-switch-port'), defaultPortB);

    const specA = inferPortSpec(devA, defaultPortA);
    const inferredMode = preset?.portMode || link?.portMode || specA.mode || 'access';
    const modeObj = getPortMode(inferredMode);
    $('rack-link-port-mode').value = modeObj.id;
    $('rack-link-vlan').value = preset?.vlan || link?.vlan || specA.vlan || modeObj.defaultVlan;

    const inferredMedium = preset?.medium || link?.medium || specA.medium || (String(defaultPortA).startsWith('SFP') || String(defaultPortA).startsWith('XG') ? 'fiber' : 'copper');
    $('rack-link-medium').value = inferredMedium;
    $('rack-link-speed').value = preset?.speed || link?.speed || specA.speed || (inferredMedium === 'copper' ? '1G' : '10G');
    refreshPortComparison();

    connectionError.textContent = '';
    connectionDirty = false;
    $('rack-connection-dialog-title').textContent = id ? '编辑端口连接（示例）' : '新增端口连接（示例）';
    connectionDialog.showModal();
    for (const list of connectionDialog.querySelectorAll('.rack-link-port-choices')) {
      const chosen = list.querySelector('[aria-pressed="true"]');
      if (chosen) list.scrollTop = Math.max(0, chosen.offsetTop - list.offsetTop - (list.clientHeight - chosen.offsetHeight) / 2);
    }
  }

  function closeConnection() {
    if (connectionDirty && !window.confirm('连接有未保存修改，放弃草稿？')) return;
    connectionDirty = false; connectionDialog.close();
  }
  connectionDialog.querySelector('.dialog-header button').replaceWith(button('关闭', closeConnection, 'quiet'));
  connectionDialog.addEventListener('cancel', (event) => { event.preventDefault(); closeConnection(); });
  $('rack-connection-form').addEventListener('input', () => { connectionDirty = true; });
  $('rack-connection-form').addEventListener('change', () => { connectionDirty = true; });
  connectionSection.querySelector('.rack-add-connection').addEventListener('click', () => openConnection());
  panel.querySelector(shared ? '.rack-quick-connect:not(#rack-mode-filter-reset)' : '.rack-quick-connect')?.addEventListener('click', () => {
    const dev = deviceById(selectedId);
    openConnection(null, dev?.cabinetId ? { deviceId: dev.id } : null);
  });

  function isPortOccupiedByOther(deviceId, portName, ignoreLinkId) {
    return connections.some((link) => link.id !== ignoreLinkId && (
      (String(link.serverId) === String(deviceId) && link.serverPort === portName) ||
      (String(link.switchId) === String(deviceId) && link.switchPort === portName)
    ));
  }

  $('rack-connection-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const modeObj = getPortMode($('rack-link-port-mode').value);
    const vlanInput = $('rack-link-vlan').value.trim() || modeObj.defaultVlan;
    const candidate = {
      id: connectionDraftId || `local-link-${sequence + 1}`,
      serverId: $('rack-link-server').value,
      serverPort: $('rack-link-server-port').value,
      switchId: $('rack-link-switch').value,
      switchPort: $('rack-link-switch-port').value,
      medium: $('rack-link-medium').value === 'copper' ? 'copper' : 'fiber',
      speed: $('rack-link-speed').value || ($('rack-link-medium').value === 'copper' ? '1G' : '10G'),
      portMode: modeObj.id,
      vlan: vlanInput,
    };
    const devA = deviceById(candidate.serverId);
    const devB = deviceById(candidate.switchId);
    if (!devA?.cabinetId || !devB?.cabinetId) {
      connectionError.textContent = '请选择已上架的两端设备。'; return;
    }
    candidate.serverId = devA.id;
    candidate.switchId = devB.id;
    if (candidate.serverId === candidate.switchId && candidate.serverPort === candidate.switchPort) {
      connectionError.textContent = '同一设备的自环连接不能使用相同端口。'; return;
    }
    if (isPortOccupiedByOther(candidate.serverId, candidate.serverPort, connectionDraftId) ||
        isPortOccupiedByOther(candidate.switchId, candidate.switchPort, connectionDraftId)) {
      connectionError.textContent = '端口已被其他连接占用，请修改端口或先编辑 / 删除原连接。'; return;
    }
    const index = connections.findIndex((link) => link.id === connectionDraftId);
    if (index < 0) { sequence++; connections.push(candidate); } else connections[index] = candidate;
    selectedConnectionId = candidate.id;
    connectionDirty = false;
    connectionDialog.close();
    renderRack();
    notify('端口连接与模式配置已保存到本页内存。');
    if (shared) shared.record({ title: index < 0 ? '新增端口连接' : '修改端口连接', text: `${devA.name} ${candidate.serverPort} ↔ ${devB.name} ${candidate.switchPort}`, assetKeys: [devA, devB].map((device) => `infrastructure:${device.id}`) });
  });

  function locateConnection(link) {
    if (!canDiscard()) return;
    const server = deviceById(link.serverId), target = deviceById(link.switchId);
    if (!server?.cabinetId || !target?.cabinetId) { notify('连接包含未上架设备，请先上架再定位。'); return; }
    if (shared) {
      ensureWorkbenchCabinet(target.cabinetId);
      ensureWorkbenchCabinet(server.cabinetId);
      const serverSlot = workbenchSlotOf(server.cabinetId);
      if (serverSlot) activateSide(serverSlot);
      selectedId = server.id;
      draft = cloneDevice(server);
      dirty = false;
      renderRack();
      fillEditor();
      requestAnimationFrame(() => {
        for (const panelNode of Object.values(panelsBySide)) {
          if (!panelNode) continue;
          for (const id of [server.id, target.id]) {
            const node = [...panelNode.querySelectorAll('.device')].find((item) => item.dataset.deviceId === id);
            if (!node) continue;
            const scroller = panelNode.querySelector('.rack-scroll');
            scroller.scrollTop += node.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 72;
          }
        }
        drawConnections();
      });
      return;
    }
    const visibleSlotsFor = (cabId) => sideOrder.filter((slot) => views[slot].cabinetId === cabId && panelsBySide[slot]?.offsetParent !== null);
    if (server.cabinetId === target.cabinetId) {
      if (!visibleSlotsFor(server.cabinetId).length) {
        views.left = { roomId: server.roomId, cabinetId: server.cabinetId };
        recomputeAutoPeers();
      }
    } else if (!visibleSlotsFor(server.cabinetId).length || !visibleSlotsFor(target.cabinetId).length) {
      views.left = { roomId: server.roomId, cabinetId: server.cabinetId };
      peerModes.middle = 'auto';
      peerModes.right = 'auto';
      recomputeAutoPeers();
      if (!visibleSlotsFor(target.cabinetId).length) {
        peerModes.middle = 'manual';
        views.middle = { roomId: target.roomId, cabinetId: target.cabinetId };
      }
    }
    const serverSlot = sideOrder.find((slot) => views[slot].cabinetId === server.cabinetId) || 'left';
    activateSide(serverSlot);
    selectedId = server.id;
    draft = cloneDevice(server);
    dirty = false;
    renderRack();
    fillEditor();
    requestAnimationFrame(() => {
      for (const slot of sideOrder) {
        const targetPanel = panelsBySide[slot];
        if (!targetPanel) continue;
        for (const id of [server.id, target.id]) {
          const node = [...targetPanel.querySelectorAll('.device')].find((item) => item.dataset.deviceId === id);
          if (node) {
            const scroller = targetPanel.querySelector('.rack-scroll');
            scroller.scrollTop += node.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 72;
          }
        }
      }
      drawConnections();
    });
  }

  function selectConnection(id) {
    selectedConnectionId = id;
    renderConnections();
    renderSidebarPortsAndLinks();
    updateConnectionHighlights();
    drawConnections();
  }

  function updateConnectionHighlights() {
    const link = connections.find((item) => item.id === selectedConnectionId);
    document.querySelectorAll('#rack-content .device').forEach((node) => {
      node.classList.toggle('connection-endpoint', Boolean(link && [link.serverId, link.switchId].some((id) => String(id) === node.dataset.deviceId)));
    });
    document.querySelectorAll('.port-badge[data-connection-id]').forEach((badge) => {
      badge.classList.toggle('is-selected', badge.dataset.connectionId === selectedConnectionId);
    });
  }

  function renderConnections() {
    const list = connectionSection.querySelector('.rack-connection-list');
    list.replaceChildren();
    const actions = $('rack-connection-actions');
    actions.replaceChildren();
    $('rack-connection-count').textContent = `连接 ${connections.length}`;
    const link = connections.find((item) => item.id === selectedConnectionId) || connections[0];
    selectedConnectionId = link?.id || null;
    if (!link) { list.textContent = '暂无连接'; return; }
    const row = document.createElement('div');
    row.className = 'rack-connection-row';
    row.dataset.connectionId = link.id;
    if (connections.length > 1) {
      const select = document.createElement('select');
      select.className = 'rack-connection-select';
      options(select, connections.map((item, index) => {
        const s = deviceById(item.serverId)?.name.split(' ').at(-1) || '设备';
        const t = deviceById(item.switchId)?.name.split(' ').at(-1) || '设备';
        const m = linkPortMode(item);
        return { id: item.id, name: `${index + 1}/${connections.length} [${m.code}] ${s}↔${t}` };
      }), link.id);
      select.addEventListener('change', () => selectConnection(select.value));
      row.append(select);
    }
    const server = deviceById(link.serverId), target = deviceById(link.switchId);
    const intra = isIntraLink(link);
    const medium = linkMedium(link);
    const modeObj = linkPortMode(link);
    const vlanStr = linkVlanLabel(link);
    const text = document.createElement('div');
    text.className = 'rack-connection-summary';

    const mBadge = document.createElement('span');
    mBadge.className = `rack-medium-tag ${medium}`;
    mBadge.textContent = linkMediumLabel(link);
    const modeBadge = document.createElement('span');
    modeBadge.className = `rack-mode-tag mode-${modeObj.id}`;
    modeBadge.textContent = `${modeObj.code}${vlanStr ? ` (${vlanStr})` : ''}`;
    modeBadge.title = `${modeObj.fullLabel} · ${vlanStr}`;
    text.append(mBadge, modeBadge);

    if (intra) {
      const iBadge = document.createElement('span');
      iBadge.className = 'rack-medium-tag intra';
      iBadge.textContent = `同柜串联`;
      text.append(iBadge);
    }

    const title = document.createElement('strong');
    const locationText = document.createElement('span');
    locationText.className = 'conn-loc';
    const shortName = (device) => device?.name.split(' ').at(-1) || '已删除设备';
    const location = (device) => device?.cabinetId ? `${roomById(device.roomId)?.name}/${cabinetById(device.cabinetId)?.name}` : '未上架';
    title.textContent = `${shortName(server)} · ${link.serverPort} ${intra ? '↷' : '↔'} ${shortName(target)} · ${link.switchPort}`;
    locationText.textContent = intra ? `（${location(server)} · ${modeObj.label} · ${vlanStr}）` : `（${location(server)} → ${location(target)} · ${modeObj.label}）`;
    text.append(title, locationText);
    if (shared) {
      for (const [device, port, label] of [[server, link.serverPort, '本端'], [target, link.switchPort, '对端']]) {
        if (!device?.cabinetId || workbenchSlotOf(device.cabinetId)) continue;
        const peer = button(`${label}在其他组 · ${location(device)} · ${port}`, () => {
          if (canDiscard()) locateWorkbenchAsset(device.id);
        }, 'quiet rack-cross-page-peer');
        peer.title = `${device.name} · ${location(device)} · ${port}；点击定位所在柜组`;
        text.append(peer);
      }
    }
    text.title = Array.from(text.children, (item) => item.title || item.textContent).join(' · ');
    actions.append(
      button('定位', () => locateConnection(link)),
      button('编辑', () => openConnection(link.id)),
      button('删除', () => {
        if (!window.confirm('删除这条本页示例端口连接？')) return;
        connections.splice(connections.indexOf(link), 1);
        renderRack();
        notify('已删除本页示例连接。');
        if (shared) shared.record({ title: '删除端口连接', text: `${link.serverPort} ↔ ${link.switchPort}`, assetKeys: [link.serverId, link.switchId].map((id) => `infrastructure:${id}`) });
      })
    );
    row.append(text);
    list.append(row);
  }

  // SVG Wire Layer + Anime.js animations (Cross-cabinet S-curve & Intra-cabinet C-curve)
  const svgNS = 'http://www.w3.org/2000/svg';
  const wireLayer = document.createElementNS(svgNS, 'svg');
  wireLayer.id = 'rack-wire-layer';
  wireLayer.setAttribute('aria-label', '已保存端口连接示意线');
  rackPair.append(wireLayer);

  const anime = window.anime;
  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const wireAnimations = new Map();
  let wireFrame = 0, pageActive = true;

  function cancelWire(id) {
    const entry = wireAnimations.get(id);
    entry?.animations.forEach((animation) => animation.cancel());
    entry?.group.remove();
    wireAnimations.delete(id);
  }
  function synchronizeMotion() {
    if (motionPreference.matches) {
      for (const id of [...wireAnimations.keys()]) cancelWire(id);
      scheduleConnections();
      wireLayer.dataset.motion = 'reduced';
      return;
    }
    const paused = !pageActive || document.hidden || Boolean(document.querySelector('dialog[open]'));
    for (const entry of wireAnimations.values()) {
      entry.animations.forEach((animation) => paused ? animation.pause() : animation.play());
    }
    wireLayer.dataset.motion = paused ? 'paused' : typeof anime?.animate === 'function' ? 'running' : 'unavailable';
  }
  function scheduleConnections() {
    if (!wireFrame && pageActive) wireFrame = requestAnimationFrame(() => { wireFrame = 0; drawConnections(); });
  }

  function drawConnections() {
    updateConnectionHighlights();
    const visible = new Set();
    const bounds = rackPair.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const wireWidth = bounds.width;
    if (shared) wireLayer.style.width = `${wireWidth}px`;
    wireLayer.setAttribute('viewBox', `0 0 ${wireWidth} ${bounds.height}`);

    function anchor(targetPanel, link, endpoint, preferredSide) {
      if (!targetPanel || targetPanel.offsetParent === null) return null;
      const node = [...targetPanel.querySelectorAll('[data-endpoint]')].find(
        (item) => item.dataset.connectionId === link.id && item.dataset.endpoint === endpoint
      );
      if (!node) return null;
      const box = node.getBoundingClientRect();
      const clip = targetPanel.querySelector('.rack-scroll').getBoundingClientRect();
      const frameBox = targetPanel.querySelector('.rack-frame').getBoundingClientRect();
      if (!frameBox.width || !clip.height) return null;
      const edgeSide = preferredSide || node.dataset.portSide || (targetPanel === rightPanel ? 'left' : 'right');
      const rawY = box.top + box.height / 2;
      let clamped = null;
      if (box.bottom <= clip.top + 2) clamped = 'up';
      else if (box.top >= clip.bottom - 2) clamped = 'down';
      const clampedY = Math.max(clip.top + 8, Math.min(clip.bottom - 8, rawY));
      return {
        x: (edgeSide === 'right' ? frameBox.right : frameBox.left) - bounds.left + (shared ? rackPair.scrollLeft : 0),
        y: clampedY - bounds.top,
        clipTop: clip.top - bounds.top,
        side: edgeSide,
        clamped,
      };
    }

    const slotIndexMap = Object.fromEntries(sideOrder.map((side, index) => [side, index]));
    const activeSlots = sideOrder.filter((slot) => panelsBySide[slot] && panelsBySide[slot].offsetParent !== null);
    const stacked = !shared && activeSlots.length > 1
      && panelsBySide[activeSlots[1]].getBoundingClientRect().top >= panelsBySide[activeSlots[0]].getBoundingClientRect().bottom - 1;
    const stackedRight = stacked ? Math.max(...activeSlots.map((slot) => panelsBySide[slot].querySelector('.rack-frame').getBoundingClientRect().right - bounds.left)) : 0;
    let stackedRouteCount = 0;
    const intraOrderByChannel = Object.fromEntries(sideOrder.map((side) => [side, 0]));
    let overheadTrayCount = 0;
    let overheadTrayBounds = null;

    for (const link of connections) {
      const intra = isIntraLink(link);
      const devA = deviceById(link.serverId);
      const devB = deviceById(link.switchId);
      if (!devA?.cabinetId || !devB?.cabinetId) continue;

      let start = null, end = null;
      let routeType = 'channel'; // 'channel' | 'overhead' | 'intra' | 'stack'
      let slotA = null, slotB = null;

      if (!intra) {
        slotA = activeSlots.find((s) => views[s].cabinetId === devA.cabinetId);
        slotB = activeSlots.find((s) => s !== slotA && views[s].cabinetId === devB.cabinetId);
        if (slotA && slotB) {
          const idxA = slotIndexMap[slotA];
          const idxB = slotIndexMap[slotB];
          if (stacked) {
            routeType = 'stack';
            start = anchor(panelsBySide[slotA], link, 'server', 'right');
            end = anchor(panelsBySide[slotB], link, 'switch', 'right');
          } else if (!shared && Math.abs(idxA - idxB) === 2 && activeSlots.includes('middle')) {
            routeType = 'overhead';
            start = anchor(panelsBySide[slotA], link, 'server', idxA === 0 ? 'right' : 'left');
            end = anchor(panelsBySide[slotB], link, 'switch', idxB === 0 ? 'right' : 'left');
          } else {
            routeType = 'channel';
            start = anchor(panelsBySide[slotA], link, 'server', idxA < idxB ? 'right' : 'left');
            end = anchor(panelsBySide[slotB], link, 'switch', idxB < idxA ? 'right' : 'left');
          }
        }
      } else {
        const matchingSlots = activeSlots.filter((s) => views[s].cabinetId === devA.cabinetId);
        if (matchingSlots.length >= 2) {
          slotA = matchingSlots[0];
          slotB = matchingSlots[1];
          const idxA = slotIndexMap[slotA];
          const idxB = slotIndexMap[slotB];
          routeType = stacked ? 'stack' : Math.abs(idxA - idxB) === 2 && activeSlots.includes('middle') ? 'overhead' : 'channel';
          start = anchor(panelsBySide[slotA], link, 'server', stacked || idxA < idxB ? 'right' : 'left');
          end = anchor(panelsBySide[slotB], link, 'switch', stacked || idxB < idxA ? 'right' : 'left');
        } else if (matchingSlots.length === 1) {
          slotA = matchingSlots[0];
          const edgeSide = slotA === 'right' ? 'left' : 'right';
          start = anchor(panelsBySide[slotA], link, 'server', edgeSide);
          end = anchor(panelsBySide[slotA], link, 'switch', edgeSide);
          routeType = 'intra';
        }
      }

      if (!start || !end) continue;
      visible.add(link.id);

      let geometry = '';
      let labelPoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };

      if (routeType === 'stack') {
        const laneX = Math.min(wireWidth - 8, stackedRight + 16 + (stackedRouteCount++ % 3) * 12);
        geometry = `M ${start.x} ${start.y} H ${laneX} V ${end.y} H ${end.x}`;
        labelPoint = { x: stackedRight + (wireWidth - stackedRight) / 2, y: (start.y + end.y) / 2 };
      } else if (routeType === 'overhead') {
        const trayIdx = overheadTrayCount++;
        const dir = end.x >= start.x ? 1 : -1;
        const x1 = start.x + dir * (16 + trayIdx * 7);
        const x2 = end.x - dir * (16 + trayIdx * 7);
        const trayBaseY = Math.max(10, Math.min(start.clipTop, end.clipTop) - 11);
        const ty = trayBaseY - trayIdx * 5;
        const r = 8;
        geometry = [
          `M ${start.x} ${start.y}`,
          `L ${x1 - dir * r} ${start.y}`,
          `Q ${x1} ${start.y} ${x1} ${start.y - r}`,
          `L ${x1} ${ty + r}`,
          `Q ${x1} ${ty} ${x1 + dir * r} ${ty}`,
          `L ${x2 - dir * r} ${ty}`,
          `Q ${x2} ${ty} ${x2} ${ty + r}`,
          `L ${x2} ${end.y - r}`,
          `Q ${x2} ${end.y} ${x2 + dir * r} ${end.y}`,
          `L ${end.x} ${end.y}`,
        ].join(' ');
        labelPoint = { x: (x1 + x2) / 2, y: ty };
        overheadTrayBounds = {
          x: Math.min(x1, x2) - 8,
          y: ty - 8,
          width: Math.abs(x2 - x1) + 16,
          height: 16,
        };
      } else if (routeType === 'channel') {
        const dx = end.x - start.x;
        const c1x = start.x + dx * 0.42;
        const c2x = start.x + dx * 0.58;
        geometry = `M ${start.x} ${start.y} C ${c1x} ${start.y}, ${c2x} ${end.y}, ${end.x} ${end.y}`;
        labelPoint = { x: (start.x + end.x) / 2, y: start.y + (end.y - start.y) * 0.56 };
      } else {
        const slotKey = slotA || 'left';
        const slotIndex = intraOrderByChannel[slotKey]++;
        const dir = start.side === 'right' ? 1 : -1;
        const spanY = Math.abs(end.y - start.y);
        const arcOffset = Math.min(64, Math.max(24, 24 + slotIndex * 18 + spanY * 0.06));
        const ctrlX = start.x + dir * arcOffset;
        geometry = `M ${start.x} ${start.y} C ${ctrlX} ${start.y}, ${ctrlX} ${end.y}, ${end.x} ${end.y}`;
        labelPoint = { x: start.x + dir * (arcOffset * 0.78), y: (start.y + end.y) / 2 };
      }

      const medium = linkMedium(link);
      const modeObj = linkPortMode(link);
      const vlanStr = linkVlanLabel(link);
      const dimmed = !linkMatchesFilter(link) || Boolean(selectedConnectionId && link.id !== selectedConnectionId);
      const stateKey = `${geometry}|${labelPoint.x}|${labelPoint.y}|${medium}|${link.speed || ''}|${modeObj.id}|${vlanStr}|${dimmed}|${start.clamped || ''}|${end.clamped || ''}`;
      const previous = wireAnimations.get(link.id);

      if (previous?.geometry === stateKey) {
        previous.group.querySelector('path.rack-wire-path')?.classList.toggle('is-selected', link.id === selectedConnectionId);
        previous.group.querySelector('g.rack-wire-badge')?.classList.toggle('is-selected', link.id === selectedConnectionId);
        previous.group.classList.toggle('is-dimmed', dimmed);
        continue;
      }
      cancelWire(link.id);

      const group = document.createElementNS(svgNS, 'g');
      group.setAttribute('class', `rack-wire-group ${medium}${dimmed ? ' is-dimmed' : ''}`);
      group.dataset.routeType = routeType;
      group.dataset.connectionId = link.id;
      wireLayer.append(group);

      const hit = document.createElementNS(svgNS, 'path');
      hit.setAttribute('d', geometry);
      hit.setAttribute('class', 'rack-wire-hit');
      hit.addEventListener('click', () => selectConnection(link.id));
      group.append(hit);

      const path = document.createElementNS(svgNS, 'path');
      path.setAttribute('d', geometry);
      path.setAttribute('class', `rack-wire-path rack-wire-${medium}${link.id === selectedConnectionId ? ' is-selected' : ''}`);
      path.dataset.connectionId = link.id;
      path.dataset.medium = medium;
      path.dataset.intra = String(intra);
      path.dataset.routeType = routeType;
      path.setAttribute('tabindex', '0');
      path.setAttribute('role', 'button');
      path.setAttribute('aria-label', `选择连接 ${link.serverPort} 至 ${link.switchPort}（${linkMediumLabel(link)}）`);
      path.addEventListener('click', () => selectConnection(link.id));
      path.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          selectConnection(link.id);
        }
      });
      const title = document.createElementNS(svgNS, 'title');
      title.textContent = `${linkMediumLabel(link)} · ${modeObj.fullLabel} (${modeObj.code}) · ${vlanStr}${intra ? ' · 同柜串联' : routeType === 'overhead' ? ' · 顶部走线槽跨柜' : ''} · ${link.serverPort} ↔ ${link.switchPort}`;
      path.append(title);
      group.append(path);

      for (const point of [start, end]) {
        const dot = document.createElementNS(svgNS, 'circle');
        dot.setAttribute('class', `rack-wire-endpoint ${medium}`);
        dot.setAttribute('cx', point.x);
        dot.setAttribute('cy', point.y);
        dot.setAttribute('r', '3.4');
        group.append(dot);
        if (point.clamped) {
          const arrow = document.createElementNS(svgNS, 'use');
          arrow.setAttribute('class', `rack-wire-offscreen ${medium}`);
          arrow.setAttribute('x', String(point.x + (point.side === 'right' ? 9 : -9) - 6));
          arrow.setAttribute('y', String(point.y - 6));
          arrow.setAttribute('width', '12');
          arrow.setAttribute('height', '12');
          arrow.setAttribute('aria-hidden', 'true');
          arrow.setAttribute('href', point.clamped === 'up' ? '#up' : '#down');
          group.append(arrow);
        }
      }

      const badgeGroup = document.createElementNS(svgNS, 'g');
      badgeGroup.setAttribute('class', `rack-wire-badge ${medium} mode-${modeObj.id}${link.id === selectedConnectionId ? ' is-selected' : ''}`);
      badgeGroup.dataset.connectionId = link.id;
      badgeGroup.dataset.portMode = modeObj.id;
      const shortVlan = vlanStr.replace(/^VSAN\s*\d+\s*\/\s*/i, '');
      const badgeTextStr = routeType === 'stack' ? modeObj.code : intra
        ? `同柜 · ${modeObj.code} (${shortVlan})`
        : routeType === 'overhead'
          ? `顶部槽 · ${modeObj.code} (${shortVlan})`
          : `${linkMediumLabel(link)} · ${modeObj.code}`;
      const charUnits = [...badgeTextStr].reduce((sum, ch) => sum + (ch.charCodeAt(0) > 255 ? 1.55 : 0.92), 0);
      const pillW = Math.max(routeType === 'stack' ? 36 : 58, Math.round(charUnits * 6.2 + 14));
      const pillH = 16;
      const rect = document.createElementNS(svgNS, 'rect');
      rect.setAttribute('class', 'rack-wire-pill');
      rect.setAttribute('x', String(labelPoint.x - pillW / 2));
      rect.setAttribute('y', String(labelPoint.y - pillH / 2));
      rect.setAttribute('width', String(pillW));
      rect.setAttribute('height', String(pillH));
      const label = document.createElementNS(svgNS, 'text');
      label.setAttribute('class', 'rack-wire-label');
      label.setAttribute('x', String(labelPoint.x));
      label.setAttribute('y', String(labelPoint.y));
      label.textContent = badgeTextStr;
      const badgeTitle = document.createElementNS(svgNS, 'title');
      badgeTitle.textContent = `${linkMediumLabel(link)} · ${modeObj.fullLabel} (${modeObj.code}) · ${vlanStr}`;
      badgeGroup.append(badgeTitle, rect, label);
      badgeGroup.addEventListener('click', () => selectConnection(link.id));
      group.append(badgeGroup);

      const animations = [];
      if (!motionPreference.matches && typeof anime?.animate === 'function') {
        if (!previous && medium === 'fiber') {
          animations.push(anime.animate(anime.svg.createDrawable(path), {
            draw: ['0 0', '0 1'],
            duration: 600,
            ease: 'outQuad',
            autoplay: false,
          }));
        }
        const pulse = document.createElementNS(svgNS, 'circle');
        pulse.setAttribute('class', `rack-link-pulse ${medium}`);
        pulse.setAttribute('r', medium === 'fiber' ? '4.2' : '3.6');
        group.append(pulse);
        animations.push(anime.animate(pulse, {
          ...anime.svg.createMotionPath(path),
          duration: medium === 'fiber' ? 1900 : 2800,
          ease: 'linear',
          loop: true,
          autoplay: false,
        }));
      }
      wireAnimations.set(link.id, { group, geometry: stateKey, animations });
    }

    let trayDecor = wireLayer.querySelector('#rack-overhead-tray-decor');
    if (overheadTrayBounds) {
      if (!trayDecor) {
        trayDecor = document.createElementNS(svgNS, 'g');
        trayDecor.id = 'rack-overhead-tray-decor';
        wireLayer.prepend(trayDecor);
      }
      trayDecor.replaceChildren();
      const trayRect = document.createElementNS(svgNS, 'rect');
      trayRect.setAttribute('class', 'rack-overhead-tray-bg');
      trayRect.setAttribute('x', String(overheadTrayBounds.x));
      trayRect.setAttribute('y', String(overheadTrayBounds.y));
      trayRect.setAttribute('width', String(overheadTrayBounds.width));
      trayRect.setAttribute('height', String(overheadTrayBounds.height));
      const trayLabel = document.createElementNS(svgNS, 'text');
      trayLabel.setAttribute('class', 'rack-overhead-tray-label');
      trayLabel.setAttribute('x', String(overheadTrayBounds.x + 22));
      trayLabel.setAttribute('y', String(overheadTrayBounds.y + overheadTrayBounds.height / 2));
      trayLabel.textContent = '顶部共享走线槽';
      trayDecor.append(trayRect, trayLabel);
    } else if (trayDecor) {
      trayDecor.remove();
    }

    for (const id of [...wireAnimations.keys()]) {
      if (!visible.has(id)) cancelWire(id);
    }
    if (!motionPreference.matches) synchronizeMotion();
    else wireLayer.dataset.motion = 'reduced';
  }

  function positionDropdownMenu(detail) {
    const menu = detail.querySelector(':scope > .menu');
    const summary = detail.querySelector(':scope > summary');
    if (!menu || !summary || !detail.closest('#rack-toolbar, #rack-content')) return;
    if (!menu.dataset.floatingWidth) menu.dataset.floatingWidth = String(menu.getBoundingClientRect().width);
    menu.classList.add('rack-floating-menu');
    const anchor = summary.getBoundingClientRect();
    const margin = 8;
    const gap = 4;
    const width = Math.min(Number(menu.dataset.floatingWidth), window.innerWidth - margin * 2);
    menu.style.width = `${width}px`;
    const below = Math.max(0, window.innerHeight - anchor.bottom - gap - margin);
    const above = Math.max(0, anchor.top - gap - margin);
    const desiredHeight = menu.scrollHeight + 2;
    const openAbove = desiredHeight > below && above > below;
    const height = Math.min(desiredHeight, openAbove ? above : below);
    menu.style.maxHeight = `${height}px`;
    menu.style.setProperty('left', `${Math.max(margin, Math.min(anchor.left, window.innerWidth - width - margin))}px`, 'important');
    menu.style.setProperty('right', 'auto', 'important');
    menu.style.setProperty('top', `${openAbove ? anchor.top - gap - height : anchor.bottom + gap}px`, 'important');
  }
  function positionOpenDropdownMenus() {
    document.querySelectorAll('#rack-toolbar details[open], #rack-content .rack-peer-picker[open]').forEach(positionDropdownMenu);
  }
  window.addEventListener('resize', positionOpenDropdownMenus);
  window.addEventListener('scroll', positionOpenDropdownMenus, { capture: true, passive: true });

  // Ensure only one dropdown menu is open at a time; close on outside click or Escape
  function closeAllDropdownMenus(except = null) {
    document.querySelectorAll('details[open]').forEach((detail) => {
      if (detail !== except && !detail.classList.contains('fold')) {
        detail.open = false;
      }
    });
  }
  document.querySelectorAll('details').forEach((detail) => {
    if (detail.classList.contains('fold')) return;
    detail.addEventListener('toggle', () => {
      if (detail.open) {
        closeAllDropdownMenus(detail);
        positionDropdownMenu(detail);
      }
    });
  });
  document.addEventListener('pointerdown', (event) => {
    document.querySelectorAll('details[open]').forEach((detail) => {
      if (!detail.classList.contains('fold') && !detail.contains(event.target)) {
        detail.open = false;
      }
    });
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !document.querySelector('dialog[open]')) {
      const openDetails = [...document.querySelectorAll('details[open]')].filter((d) => !d.classList.contains('fold'));
      if (openDetails.length) {
        event.preventDefault();
        openDetails.forEach((d) => { d.open = false; });
      }
    }
  });

  for (const targetPanel of Object.values(panelsBySide).filter(Boolean)) {
    targetPanel.querySelector('.rack-scroll').addEventListener('scroll', scheduleConnections, { passive: true });
  }
  const wireResize = new ResizeObserver(() => { resizeWorkbench(); scheduleConnections(); });
  const modalObserver = new MutationObserver(synchronizeMotion);
  function connectWireObservers() {
    wireResize.observe($('rack-content'));
    wireResize.observe(rackPair);
    modalObserver.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
  }
  connectWireObservers();
  document.addEventListener('visibilitychange', synchronizeMotion);
  motionPreference.addEventListener('change', () => {
    for (const id of [...wireAnimations.keys()]) cancelWire(id);
    scheduleConnections();
  });
  window.addEventListener('pagehide', () => {
    pageActive = false;
    cancelAnimationFrame(wireFrame);
    cancelAnimationFrame(workbenchResizeFrame);
    workbenchResizeFrame = 0;
    wireFrame = 0;
    for (const id of [...wireAnimations.keys()]) cancelWire(id);
    wireResize.disconnect();
    modalObserver.disconnect();
    wireLayer.dataset.motion = 'paused';
  });
  window.addEventListener('pageshow', () => {
    pageActive = true;
    connectWireObservers();
    scheduleConnections();
  });

  Object.defineProperty(window, 'rackPrototype', { value: Object.freeze({
    select: (query) => selectFromQuery(query),
    highlight: (query) => selectFromQuery(query),
    focusManager,
    get devices() { return snapshots(devices); },
    get rooms() { return snapshots(rooms); },
    get cabinets() { return snapshots(cabinets); },
    get connections() { return snapshots(connections); },
    get portModes() { return snapshots(portModes); },
    get devicePorts() { return Object.freeze({ ...devicePorts }); },
    get views() {
      if (shared) return Object.freeze(Object.fromEntries(sideOrder.map((side) => [side, Object.freeze({ ...views[side] })])));
      return Object.freeze({
        left: Object.freeze({ ...views.left }),
        middle: Object.freeze({ ...views.middle }),
        right: Object.freeze({ ...views.right }),
        peerModes: Object.freeze({ ...peerModes }),
      });
    },
    get selection() { return Object.freeze({ room: activeRoomId, cabinet: activeCabinetId, device: selectedId }); },
  }), writable: false, configurable: false });

  if (shared) initializeWorkbench();
  draft = deviceById(selectedId) ? cloneDevice(deviceById(selectedId)) : null;
  renderManager();
  renderRack();
  fillEditor();
  requestAnimationFrame(scrollSelected);
  const query = Object.fromEntries(new URLSearchParams(location.search));
  if (query.room || query.cabinet || query.device || query.name) selectFromQuery(query, true);
})();

(() => {
  'use strict';

  // Only the existing scalar fields are written; component drafts are dialog-local.
  const drafts = new WeakMap();
  const keys = new Set(['cpu_info', 'disk_info', 'memory_mb', 'vcpu', 'vCPU']);
  const units = { MB: 1, GB: 1024, TB: 1024 ** 2, PB: 1024 ** 3 };
  const models = ['Intel Core i5-12500', 'Intel Core i5-1345U', 'Intel Core i7-13700', 'Intel Xeon Gold 6330', 'Intel Xeon Silver 4310', 'AMD Ryzen 7 7700', 'AMD EPYC 7313'];
  const media = ['SATA', 'SSD', 'U.2', 'SAS', 'NVMe', 'HDD', 'SATA SSD', 'SAS SSD'];
  // 与原生 hardwarePresetModel 一致的常用预设：只含分项，说明/RAID 保留在当前草稿；仅存本机浏览器，不写业务数据。
  const presetKey = 'cmdb-prototype-hardware-presets';
  const presetParts = { cpu_info: ['count', 'model'], memory_mb: ['amount', 'unit'], disk_info: ['count', 'capacity', 'unit', 'medium'] };
  const defaultPresets = {
    cpu_info: [{ count: '1', model: 'Intel Core i5-12500' }, { count: '1', model: 'Intel Core i7-13700' }, { count: '2', model: 'Intel Xeon Gold 6330' }, { count: '2', model: 'Intel Xeon Silver 4310' }, { count: '2', model: 'AMD EPYC 7313' }],
    memory_mb: [{ amount: '8', unit: 'GB' }, { amount: '16', unit: 'GB' }, { amount: '32', unit: 'GB' }, { amount: '64', unit: 'GB' }, { amount: '128', unit: 'GB' }],
    disk_info: [{ count: '', capacity: '512', unit: 'GB', medium: 'SSD' }, { count: '', capacity: '1', unit: 'TB', medium: 'SSD' }, { count: '2', capacity: '960', unit: 'GB', medium: 'SATA SSD' }, { count: '4', capacity: '4', unit: 'TB', medium: 'SAS' }],
  };
  const presetLabel = (key, preset) => key === 'memory_mb' ? `${preset.amount} ${preset.unit}`
    : key === 'cpu_info' ? `${preset.count ? preset.count + ' × ' : ''}${preset.model}`
      : `${preset.count ? preset.count + ' × ' : ''}${preset.capacity} ${preset.unit}${preset.medium ? ' ' + preset.medium : ''}`;
  const usablePreset = (key, parts) => key === 'cpu_info' ? !!String(parts.model || '').trim()
    : key === 'memory_mb' ? /[1-9]/.test(parts.amount || '') && /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(parts.amount || '')
      : /[1-9]/.test(parts.capacity || '') && /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(parts.capacity || '');
  const readPresets = (key) => {
    try { const stored = JSON.parse(localStorage.getItem(presetKey) || 'null'); if (stored && Object.prototype.hasOwnProperty.call(stored, key)) return stored[key]; } catch { /* 原型偏好读取失败时使用默认 */ }
    return defaultPresets[key];
  };
  const savePresets = (key, list) => {
    let stored = {};
    try { stored = JSON.parse(localStorage.getItem(presetKey) || '{}') || {}; } catch { stored = {}; }
    stored[key] = list;
    try { localStorage.setItem(presetKey, JSON.stringify(stored)); } catch { /* 仅原型示意 */ }
  };
  const node = (tag, className, text) => {
    const result = document.createElement(tag);
    if (className) result.className = className;
    if (text !== undefined) result.textContent = text;
    return result;
  };
  const numeric = (text) => /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(text) && Number.isFinite(Number(text));

  function parse(key, source) {
    if (key === 'memory_mb') {
      const parts = { amount: '', unit: 'GB' };
      if (!source) return { parts, recognized: true };
      if (!numeric(source)) return { parts, recognized: false };
      const amount = Number(source);
      const unit = ['PB', 'TB', 'GB'].find((unit) => amount >= units[unit] && Number.isInteger(amount / units[unit])) || 'MB';
      return { parts: { amount: String(amount / units[unit]), unit }, recognized: true };
    }
    const parts = key === 'cpu_info' ? { count: '', model: '', note: '' } : { count: '', capacity: '', unit: 'GB', medium: '', note: '' };
    if (!source) return { parts, recognized: true };
    if (key === 'cpu_info') {
      const match = source.match(/^(?:(\d+(?:\.\d+)?)\s*[×x*]\s*)?([^/]+?)(?:\s*\/\s*([\s\S]*))?$/);
      if (!match || (!match[1] && !/^(?:Intel|AMD|Apple|ARM|海光|鲲鹏|龙芯)\b/i.test(match[2]))) return { parts, recognized: false };
      return { parts: { count: match[1] || '', model: match[2], note: match[3] || '' }, recognized: true };
    }
    const match = source.match(/^(?:(\d+(?:\.\d+)?)\s*[×x*]\s*)?(\d+(?:\.\d+)?)\s*(MB|GB|TB|PB)\b\s*([^/]*?)(?:\s*\/\s*([\s\S]*))?$/i);
    if (!match) return { parts, recognized: false };
    return { parts: { count: match[1] || '', capacity: match[2], unit: match[3].toUpperCase(), medium: match[4], note: match[5] || '' }, recognized: true };
  }

  function create(field, values, id) {
    const key = field.key;
    if (!keys.has(key)) return null;
    const wrapper = node('div', 'field full asset-hardware-field');
    wrapper.dataset.hardwareField = key;
    const label = node('label', '', key === 'memory_mb' ? '内存容量' : field.label);
    label.htmlFor = id + (key === 'cpu_info' ? '-model' : key === 'disk_info' ? '-capacity' : key === 'memory_mb' ? '-amount' : '');
    if (field.required) label.append(node('span', 'required', '*'));
    const control = node('div', 'asset-hardware-control');
    wrapper.append(label, control);

    if (key === 'vcpu' || key === 'vCPU') {
      const input = node('input');
      input.id = id;
      input.name = key;
      const source = String(values[key] ?? '');
      input.type = !source || numeric(source) ? 'number' : 'text';
      input.step = '1';
      input.required = Boolean(field.required);
      input.value = values[key] ?? '';
      input.placeholder = '自由填写核数，不限预设';
      input.addEventListener('input', () => { values[key] = input.value; });
      control.append(input);
      return wrapper;
    }

    let fields = drafts.get(values);
    if (!fields) { fields = {}; drafts.set(values, fields); }
    const source = String(values[key] ?? '');
    let draft = fields[key];
    if (!draft || draft.source !== source) draft = fields[key] = { source, ...parse(key, source) };
    const components = node('div', 'asset-hardware-parts');
    const advanced = node('details', 'asset-hardware-advanced');
    const summary = node('summary', '', key === 'memory_mb' ? '原始 MB 值' : '说明与完整配置');
    const advancedBody = node('div', 'asset-hardware-advanced-body');
    advanced.open = !draft.recognized;
    advanced.append(summary, advancedBody);
    const inputs = {};
    const add = (part, title, options) => {
      const holder = node('div', 'asset-hardware-part');
      const caption = node('label', '', title);
      caption.htmlFor = id + '-' + part;
      const input = node(part === 'unit' ? 'select' : 'input');
      input.id = id + '-' + part;
      input.dataset.hardwarePart = part;
      input.setAttribute('aria-label', field.label + ' · ' + title);
      if (part === 'unit') {
        for (const value of Object.keys(units)) input.append(new Option(value, value));
      } else {
        input.type = ['count', 'capacity', 'amount'].includes(part) ? 'number' : 'text';
        if (input.type === 'number') input.step = 'any';
        input.autocomplete = 'off';
        if (options) {
          const list = node('datalist');
          list.id = id + '-' + part + '-options';
          for (const value of options) list.append(new Option(value, value));
          input.setAttribute('list', list.id);
          holder.append(list);
          input.placeholder = '可选或输入自定义';
        }
      }
      input.value = draft.parts[part];
      inputs[part] = input;
      holder.prepend(caption, input);
      holder.dataset.part = part;
      (part === 'note' ? advancedBody : components).append(holder);
      input.addEventListener(part === 'unit' ? 'change' : 'input', () => {
        draft.parts[part] = input.value;
        if (draft.recognized) commit();
        else status.textContent = '完整原文保持不变。分项填写后，点击“用分项替换完整文本”才会替换。';
      });
    };
    if (key === 'memory_mb') {
      add('amount', '容量');
      add('unit', '单位');
    } else {
      add('count', '数量');
      if (key === 'cpu_info') add('model', '型号', models);
      else {
        add('capacity', '单盘容量');
        add('unit', '单位');
        add('medium', '介质 / 接口', media);
      }
      add('note', key === 'cpu_info' ? '补充说明' : '阵列 / 其他说明');
    }
    const presetBar = node('div', 'asset-hardware-presets');
    presetBar.setAttribute('role', 'group');
    presetBar.setAttribute('aria-label', field.label + ' · 常用预设');
    const renderPresets = () => {
      presetBar.replaceChildren(node('span', 'asset-hardware-presets-title', '常用'));
      const list = readPresets(key);
      const current = draft.recognized && usablePreset(key, draft.parts) ? presetLabel(key, draft.parts) : '';
      for (const preset of list) {
        const label = presetLabel(key, preset);
        const chip = node('span', 'asset-hardware-preset');
        if (label === current) chip.dataset.active = 'true';
        const apply = node('button', '', label);
        apply.type = 'button';
        apply.title = '应用常用预设：' + label;
        apply.addEventListener('click', () => {
          for (const part of presetParts[key]) { draft.parts[part] = preset[part] ?? ''; inputs[part].value = draft.parts[part]; }
          if (draft.recognized) commit();
          else status.textContent = '完整原文保持不变。已按预设填写分项，点击“用分项替换完整文本”才会替换。';
          renderPresets();
        });
        const remove = node('button', '', '×');
        remove.type = 'button';
        remove.setAttribute('aria-label', '删除常用预设：' + label);
        remove.title = '删除此常用预设';
        remove.addEventListener('click', () => { savePresets(key, list.filter((item) => presetLabel(key, item) !== label)); renderPresets(); });
        chip.append(apply, remove);
        presetBar.append(chip);
      }
      if (!list.length) presetBar.append(node('span', 'asset-hardware-presets-title', '暂无常用预设'));
      const save = node('button', 'asset-hardware-preset-save', '+ 存为常用');
      save.type = 'button';
      save.disabled = !current || list.some((item) => presetLabel(key, item) === current);
      save.title = current ? '把“' + current + '”存为常用预设' : '填写完整分项后可存为常用预设';
      save.addEventListener('click', () => {
        const preset = Object.fromEntries(presetParts[key].map((part) => [part, String(draft.parts[part] ?? '').trim()]));
        savePresets(key, [preset, ...list.filter((item) => presetLabel(key, item) !== current)].slice(0, 16));
        renderPresets();
      });
      presetBar.append(save);
    };
    const rawLabel = node('label', 'asset-hardware-raw-label', key === 'memory_mb' ? '原始 MB 值' : '完整配置');
    rawLabel.htmlFor = id;
    const raw = node(key === 'memory_mb' ? 'input' : 'textarea', 'asset-hardware-raw');
    raw.id = id;
    raw.name = key;
    if (key === 'memory_mb') raw.type = 'text';
    else raw.rows = 2;
    raw.value = source;
    raw.required = Boolean(field.required);
    raw.autocomplete = 'off';
    const status = node('p', 'asset-hardware-hint');
    status.id = id + '-hint';
    status.setAttribute('role', 'status');
    raw.setAttribute('aria-describedby', status.id);
    const replace = node('button', 'asset-hardware-replace', '用分项替换完整文本');
    replace.type = 'button';
    replace.hidden = draft.recognized;
    replace.addEventListener('click', () => commit(true));

    function commit(explicit = false) {
      const p = draft.parts;
      let value;
      if (key === 'memory_mb') {
        if (p.amount === '') value = '';
        else if (numeric(p.amount) && Number.isFinite(Number(p.amount) * units[p.unit])) value = String(Number(p.amount) * units[p.unit]);
      } else {
        const countValid = !p.count || numeric(p.count);
        if (key === 'cpu_info' && countValid && p.model.trim()) value = (p.count ? p.count + ' × ' : '') + p.model + (p.note ? ' / ' + p.note : '');
        if (key === 'disk_info' && countValid && numeric(p.capacity)) value = (p.count ? p.count + ' × ' : '') + p.capacity + ' ' + p.unit + (p.medium ? ' ' + p.medium : '') + (p.note ? ' / ' + p.note : '');
        if (Object.entries(p).every(([part, text]) => part === 'unit' || !text)) value = '';
      }
      if (value === undefined) {
        status.textContent = '分项草稿已保留；请补全' + (key === 'cpu_info' ? '型号与有效数量' : key === 'disk_info' ? '有效容量与数量' : '有效容量') + '，完整原文暂不改动。';
        return;
      }
      // Unrecognized source is never replaced without the explicit action.
      if (!draft.recognized && !explicit) return;
      draft.recognized = true;
      draft.source = value;
      values[key] = value;
      raw.value = value;
      replace.hidden = true;
      showStatus();
      renderPresets();
    }
    function showStatus() {
      status.textContent = !draft.recognized ? '原文无法可靠拆分，已原样保留；可直接编辑完整文本，或填写分项后明确替换。'
        : key === 'memory_mb' ? '按 1024 换算并同步 memory_mb：' + (draft.source || '未填写') + ' MB。'
          : '分项修改同步完整文本；也可直接输入任意配置。未保存业务数据。';
      summary.textContent = !draft.recognized ? '原文配置（未拆分）' : key === 'memory_mb' ? '原始 MB 值' : '说明与完整配置' + (draft.parts.note ? ' · 已填写' : '');
    }
    raw.addEventListener('input', () => {
      values[key] = raw.value;
      draft.source = raw.value;
      const parsed = parse(key, raw.value);
      draft.parts = parsed.parts;
      draft.recognized = parsed.recognized;
      for (const [part, input] of Object.entries(inputs)) input.value = draft.parts[part];
      replace.hidden = draft.recognized;
      showStatus();
      renderPresets();
    });
    advancedBody.append(rawLabel, raw, replace, status);
    control.append(presetBar, components, advanced);
    renderPresets();
    showStatus();
    return wrapper;
  }

  window.assetHardwareControlsPreview = { create };
})();

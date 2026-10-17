(() => {
  'use strict';

  // ConfigCenter stores prefix/separator/date/digits/reset as name/vendor/version/sort_order/remark.
  const ruleDefaults = { name: 'GD', vendor: '-', version: 'YYYYMMDD', sort_order: 4, remark: '每日' };
  const previewDate = { year: '2026', month: '10', day: '15' };
  const dateExample = (format) => ({
    YYYYMMDD: previewDate.year + previewDate.month + previewDate.day,
    YYYYMM: previewDate.year + previewDate.month,
    YYYY: previewDate.year,
    NONE: '',
  })[format];

  function mount({ host, icon, escape, button, close, projectLabel }) {
    const field = (id, label, control) => `<div class="cmdb-operation-field"><label for="${id}">${label}</label>${control}</div>`;
    const options = (items, selected) => items.map(([value, label]) => `<option value="${escape(value)}"${String(value) === String(selected) ? ' selected' : ''}>${escape(label)}</option>`).join('');
    const select = (id, name, items, selected) => `<select id="${id}" name="${name}">${options(items, selected)}</select>`;
    const definitions = (items) => `<dl class="cmdb-operation-definitions">${items.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('')}</dl>`;
    const ruleDialog = document.createElement('dialog');
    ruleDialog.id = 'cmdb-settings-rule';
    ruleDialog.className = 'cmdb-operation-dialog';
    ruleDialog.setAttribute('aria-labelledby', 'cmdb-rule-title');
    ruleDialog.innerHTML = `
      <header class="dialog-header"><h2 id="cmdb-rule-title">${icon('settings')}工单编号规则</h2>${close('cmdb-settings-rule')}</header>
      <div class="dialog-body">
        <form id="cmdb-rule-form" class="cmdb-operation-fields">
          ${field('cmdb-rule-prefix', '固定前缀', `<input id="cmdb-rule-prefix" name="name" value="${ruleDefaults.name}" autocomplete="off" spellcheck="false">`)}
          ${field('cmdb-rule-separator', '分隔符', select('cmdb-rule-separator', 'vendor', [['-', '短横线 -'], ['_', '下划线 _'], ['', '无分隔符']], ruleDefaults.vendor))}
          ${field('cmdb-rule-date', '日期段', select('cmdb-rule-date', 'version', [['YYYYMMDD', '年月日 YYYYMMDD'], ['YYYYMM', '年月 YYYYMM'], ['YYYY', '年 YYYY'], ['NONE', '无日期段']], ruleDefaults.version))}
          ${field('cmdb-rule-digits', '流水号位数', select('cmdb-rule-digits', 'sort_order', [3, 4, 5, 6, 7, 8].map((value) => [value, value]), ruleDefaults.sort_order))}
          ${field('cmdb-rule-reset', '重置周期', select('cmdb-rule-reset', 'remark', ['每日', '每月', '每年', '不重置'].map((value) => [value, value]), ruleDefaults.remark))}
        </form>
        <div class="cmdb-operation-format"><span>格式示例</span><output id="cmdb-rule-preview" aria-live="polite"></output><small id="cmdb-rule-preview-detail"></small></div>
        <p class="cmdb-operation-note">修改仅影响保存后的新工单，历史编号不变。原型不读取当前流水，也不保存规则。</p>
      </div>
      <footer class="dialog-footer">${button('取消', 'data-settings-close="cmdb-settings-rule"')}${button('保存规则', 'class="primary" disabled title="原型不保存配置"')}</footer>`;

    const previewDialog = document.createElement('dialog');
    previewDialog.id = 'cmdb-settings-preview';
    previewDialog.className = 'cmdb-operation-dialog';
    previewDialog.setAttribute('aria-labelledby', 'cmdb-preview-title');
    previewDialog.innerHTML = `
      <header class="dialog-header"><h2 id="cmdb-preview-title"></h2>${close('cmdb-settings-preview')}</header>
      <div id="cmdb-preview-body" class="dialog-body"></div>
      <footer class="dialog-footer"><span class="cmdb-operation-footer-note">原型不执行或写入业务数据</span>${button('关闭', 'data-settings-close="cmdb-settings-preview"')}${button('确认执行', 'id="cmdb-preview-execute" class="primary" disabled title="原型不执行或写入业务数据"')}</footer>`;
    host.append(ruleDialog, previewDialog);

    const ruleControl = (id) => ruleDialog.querySelector(`#cmdb-rule-${id}`);
    function renderRule() {
      ruleControl('prefix').value = ruleControl('prefix').value.toUpperCase();
      const values = {
        name: ruleControl('prefix').value,
        vendor: ruleControl('separator').value,
        version: ruleControl('date').value,
        sort_order: Number(ruleControl('digits').value),
        remark: ruleControl('reset').value,
      };
      ruleControl('preview').textContent = [values.name || 'GD', dateExample(values.version), '1'.padStart(values.sort_order, '0')].filter(Boolean).join(values.vendor);
      ruleControl('preview-detail').textContent = `示例日期：${previewDate.year}-${previewDate.month}-${previewDate.day} · 流水号以 1 示意 · ${values.remark}`;
    }
    ruleDialog.querySelector('form').addEventListener('input', renderRule);
    ruleDialog.querySelector('form').addEventListener('change', renderRule);
    renderRule();

    function namingPreview() {
      const projectName = typeof projectLabel === 'function' ? projectLabel() : projectLabel;
      const label = escape(projectName || '当前项目');
      return {
        title: '终端自动命名规则',
        icon: 'server',
        action: '确认补全名称',
        html: `<p class="cmdb-operation-intro">仅为当前项目名称留空的终端生成名称，手工填写的名称保持不变。</p>
          <div class="cmdb-operation-format"><span>格式示例 · 非待写入记录</span><output>${label}-PC-0001</output></div>
          ${definitions([
            ['项目名称', `${label}；正式生成时项目名称为空则使用项目编码。`],
            ['设备简称', '优先使用终端设备类型中的简称；未配置时按类型名称推断，无法推断时使用 DEV。'],
            ['流水号', '至少四位，从项目内相同名称前缀的最大序号继续，不重用中间空号。'],
            ['正式预览', '新名称、资产编码、设备类型、使用人；本原型未读取资产，不显示待补全数量。'],
          ])}
          <p class="cmdb-operation-note">正式客户端先预览未命名终端，再确认补全。本原型只展示命名格式，不生成或写入资产名称。</p>`,
      };
    }

    function attachmentPreview(restoreDefault) {
      const pending = '由正式客户端预检';
      return {
        title: restoreDefault ? '恢复默认附件目录' : '附件目录迁移预览',
        icon: 'folder',
        action: restoreDefault ? '确认恢复默认' : '确认迁移',
        html: `<p class="cmdb-operation-intro">${restoreDefault ? '将当前项目的工单附件恢复至默认目录，正式执行前仍需预检。' : '迁移当前项目的工单附件。可填写目标目录以查看表单，不会执行预检或移动文件。'}</p>
          ${restoreDefault ? '' : field('cmdb-attachment-target', '目标目录', '<input id="cmdb-attachment-target" name="target_root" placeholder="填写目标附件目录（仅表单预览）" autocomplete="off" spellcheck="false" aria-describedby="cmdb-attachment-target-note">')}
          ${restoreDefault ? '' : '<p id="cmdb-attachment-target-note" class="cmdb-operation-note">输入内容不代表目录存在、可写或预检通过；最终目标路径由正式客户端预检解析。</p>'}
          ${definitions([
            ['源目录', `<span data-preflight-field="source_root">${pending}</span>`],
            ['目标目录', `<span data-preflight-field="target_root">${restoreDefault ? '当前项目默认附件目录，实际路径' + pending : '按上方输入解析，实际路径' + pending}</span>`],
            ['附件数量', `<span data-preflight-field="file_count">${pending}</span>`],
            ['附件大小', `<span data-preflight-field="size_bytes">${pending}</span>`],
          ])}
          <p class="cmdb-operation-note">原型未读取本机目录或附件记录，不提供可写状态、预检结果或迁移结果。正式迁移失败时保留原目录。</p>`,
      };
    }

    const previews = {
      naming: namingPreview,
      attachment: () => attachmentPreview(false),
      'attachment-default': () => attachmentPreview(true),
      legacy: () => ({
        title: '旧台账迁入预览',
        icon: 'history',
        action: '确认迁入',
        html: `<p class="cmdb-operation-intro">将当前项目的旧终端与基础设施资料迁入 Cmdb，已有有效映射跳过。</p>
          ${definitions([
            ['数据来源', '当前项目的旧终端台账与旧基础设施台账。'],
            ['作用范围', '在当前项目新增对应 Cmdb 资产及业务 IP 接口；从旧终端部门补充组织，不跨项目写入。'],
            ['重复执行', '按当前项目与来源类型、来源记录 ID 判重；已有有效映射跳过，不覆盖已映射资产。'],
            ['保留边界', '不删除现有资产或旧台账，不迁移、重建或清空已有运维履历；不导入业务系统。'],
          ])}
          <p class="cmdb-operation-note">原型未读取数据库，不显示待迁入数量或执行结果。执行后由正式客户端返回新增组织、终端、基础设施及跳过记录数。</p>`,
      }),
    };

    return {
      openRule() {
        renderRule();
        ruleDialog.showModal();
      },
      openPreview(key) {
        const preview = previews[key]();
        previewDialog.querySelector('#cmdb-preview-title').innerHTML = icon(preview.icon) + escape(preview.title);
        previewDialog.querySelector('#cmdb-preview-body').innerHTML = preview.html;
        previewDialog.querySelector('#cmdb-preview-execute').textContent = preview.action;
        previewDialog.showModal();
      },
    };
  }

  window.cmdbSettingsOperationsPreview = { mount };
})();

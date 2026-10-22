(() => {
  'use strict';
  // Original files copied unchanged from build/netcatty-ci-rack/public/distro/.
  // Additional brands/OS: integrations/netcatty/cmdb/vendor-icons/;
  // upstream provenance is recorded in that directory's SOURCES.md.
  // Native distro assets take precedence where both sources have the same name.
  const base = new URL('assets/brand-logos/', document.currentScript.src);
  const vendors = [
    ['h3c.svg', /^(h3c|新华三)$/i],
    ['huawei.svg', /^(huawei|华为)$/i],
    ['ruijie.svg', /^(ruijie|锐捷)$/i],
    ['dellemc.svg', /^(dell(?:[\s/-]*emc)?|戴尔|戴尔易安信|emc)$/i],
    ['lenovo.svg', /^(lenovo|联想)$/i],
    ['hpe.svg', /^(hpe|hp|惠普)$/i],
    ['inspur.svg', /^(inspur|浪潮)$/i],
    ['ibm.svg', /^ibm$/i],
    ['cisco.svg', /^(cisco|思科)$/i],
    ['juniper.svg', /^(juniper|瞻博)$/i],
    ['fortinet.svg', /^(fortinet|飞塔)$/i],
    ['mikrotik.svg', /^mikrotik$/i],
    ['paloalto.svg', /^palo\s*alto(?: networks)?$/i],
    ['zyxel.svg', /^(zyxel|合勤)$/i],
    ['netapp.svg', /^netapp$/i],
    ['purestorage.svg', /^pure\s*storage$/i],
    ['synology.svg', /^(synology|群晖)$/i],
    ['qnap.svg', /^(qnap|威联通)$/i],
    ['vmware.svg', /^vmware(?:\s+esxi)?$/i],
    ['proxmox.svg', /^proxmox(?:\s+ve)?$/i],
    ['nutanix.svg', /^(nutanix|路坦力)$/i],
    ['smartx.svg', /^smartx$/i],
    ['zstack.svg', /^zstack$/i],
    ['sangfor.svg', /^(sangfor|深信服)$/i],
    ['citrix.svg', /^citrix$/i],
    ['openstack.svg', /^openstack$/i],
    ['kvm.png', /^kvm$/i],
    ['virtualbox.svg', /^(?:oracle\s+)?virtualbox$/i],
    ['microsoft.svg', /^(microsoft|微软|hyper-v|microsoft\s+hyper-v)$/i]
  ];
  const systems = [
    ['uos.png', /\buos\b|统信/i],
    ['kylin.png', /kylin|麒麟/i],
    ['windows.svg', /windows/i],
    ['openeuler.svg', /openeuler/i],
    ['ubuntu.svg', /ubuntu/i],
    ['debian.svg', /debian/i],
    ['centos.svg', /centos/i],
    ['rocky.svg', /rocky/i],
    ['fedora.svg', /fedora/i],
    ['arch.svg', /\barch(?:\s*linux)?\b/i],
    ['alpine.svg', /alpine/i],
    ['amazon.svg', /amazon\s*linux/i],
    ['opensuse.svg', /opensuse/i],
    ['redhat.svg', /red\s*hat|\brhel\b/i],
    ['oracle.svg', /oracle\s*linux/i],
    ['kali.svg', /\bkali\b/i],
    ['almalinux.svg', /alma\s*linux/i],
    ['alinux.svg', /alibaba\s*cloud\s*linux|alinux/i],
    ['macos.svg', /mac\s*os|os\s*x/i],
    ['freebsd.svg', /freebsd/i],
    ['linux.svg', /^linux(?:\s+\d[\w.-]*)?$/i]
  ];
  function resolve(value, entries, kind) {
    const label = String(value ?? '').trim();
    if (!label || /未配置|不适用|未知/.test(label)) return null;
    const match = entries.find((entry) => entry[1].test(label));
    if (!match) return null;
    const image = document.createElement('img');
    image.className = 'asset-brand-logo asset-brand-logo--' + kind;
    image.src = new URL(match[0], base).href;
    image.alt = '';
    image.setAttribute('aria-hidden', 'true');
    image.width = kind === 'vendor' ? 28 : 20;
    image.height = 20;
    image.draggable = false;
    return image;
  }
  function vendor(value) { return resolve(value, vendors, 'vendor'); }
  function operatingSystem(value) { return resolve(value, systems, 'os'); }
  function inline(value, kind = 'vendor') {
    const wrapper = document.createElement('span');
    wrapper.className = 'asset-brand-inline';
    const image = kind === 'os' || kind === 'operatingSystem' ? operatingSystem(value) : vendor(value);
    if (image) wrapper.append(image);
    const label = document.createElement('span');
    label.className = 'asset-brand-label';
    label.textContent = String(value ?? '');
    wrapper.append(label);
    return wrapper;
  }
  window.assetPrototypeLogos = Object.freeze({ vendor, operatingSystem, inline });
})();

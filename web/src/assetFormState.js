const CLOUD_DESKTOP_KEYWORDS = ['云桌面', '云盒', '盒子']

export function isCloudDesktopDeviceType(deviceType) {
  const normalized = String(deviceType || '').trim()
  return CLOUD_DESKTOP_KEYWORDS.some((keyword) => normalized.includes(keyword))
}

export function assetIPFields(deviceType) {
  if (isCloudDesktopDeviceType(deviceType)) {
    return [
      { name: 'ip', label: '业务/虚拟机 IP' },
      { name: 'terminal_ip', label: '终端物理 IP' },
    ]
  }
  return [{ name: 'ip', label: '设备 IP' }]
}

export function normalizeAssetPayload(values) {
  if (isCloudDesktopDeviceType(values?.device_type)) return { ...values }
  return { ...values, terminal_ip: '' }
}

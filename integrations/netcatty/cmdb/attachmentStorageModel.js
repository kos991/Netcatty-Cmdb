function finiteNonNegative(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : 0
}

export function formatAttachmentBytes(value) {
  const bytes = finiteNonNegative(value)
  if (bytes < 1024) return `${Math.round(bytes)} B`
  const units = ['KiB', 'MiB', 'GiB', 'TiB']
  let size = bytes / 1024
  let unit = units[0]
  for (let index = 1; size >= 1024 && index < units.length; index += 1) {
    size /= 1024
    unit = units[index]
  }
  const rounded = size >= 10 || Number.isInteger(size) ? Math.round(size) : Math.round(size * 10) / 10
  return `${rounded} ${unit}`
}

function formatFileCount(value) {
  return `${Math.max(0, Math.trunc(finiteNonNegative(value)))} 个文件`
}

export function buildAttachmentMigrationSummary(preview = {}) {
  return {
    source: String(preview.source_root || ''),
    target: String(preview.target_root || ''),
    countLabel: formatFileCount(preview.file_count),
    sizeLabel: formatAttachmentBytes(preview.size_bytes),
  }
}

export function buildAttachmentStorageSummary(status = {}) {
  return {
    path: String(status?.effective_root || ''),
    modeLabel: status?.uses_default === false ? '自定义目录' : '默认目录',
    writableLabel: status?.writable === false ? '不可写' : '可写',
    countLabel: formatFileCount(status?.file_count),
    sizeLabel: formatAttachmentBytes(status?.size_bytes),
  }
}

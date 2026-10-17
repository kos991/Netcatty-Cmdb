const storageKey = (page) => `cmdb.asset-filters.${page}`

export function readAssetFilterSelection(storage, page, options, defaults) {
  try {
    const saved = storage?.getItem(storageKey(page))
    if (saved === null || saved === undefined) return [...defaults]
    const parsed = JSON.parse(saved)
    if (!Array.isArray(parsed)) return [...defaults]
    return options.filter((key) => parsed.includes(key))
  } catch {
    return [...defaults]
  }
}

export function saveAssetFilterSelection(storage, page, visible) {
  try {
    storage?.setItem(storageKey(page), JSON.stringify(visible))
  } catch (error) {
    console.warn('保存 Cmdb 筛选项偏好失败：', error)
  }
}

export function removeAssetFilter(visible, key, filters) {
  return { visible: visible.filter((item) => item !== key), filters: { ...filters, [key]: '' } }
}

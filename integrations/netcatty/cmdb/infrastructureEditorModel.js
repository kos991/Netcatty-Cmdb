const normalizeModelPart = (value) => String(value || '').trim().toLocaleLowerCase()

export function resolveInfrastructureModelID(models = [], vendor, model) {
  const normalizedVendor = normalizeModelPart(vendor)
  const normalizedModel = normalizeModelPart(model)
  if (!normalizedVendor || !normalizedModel) return 0

  const matches = models.filter((item) => normalizeModelPart(item.vendor) === normalizedVendor
    && normalizeModelPart(item.model) === normalizedModel)
  return matches.length === 1 ? Number(matches[0].id) || 0 : 0
}

export function prepareInfrastructureEditorValues(record = {}, models = []) {
  const values = { ...record, interfaces: [...(record.interfaces || [])] }
  if (!values.device_type && !values.category_id && values.source_type === 'legacy_server') values.device_type = 'server'
  if (!Number(values.model_id)) {
    values.model_id = resolveInfrastructureModelID(models, values.vendor, values.model)
  }

  const managementIP = String(values.mgmt_ip || values.manage_ip || '').trim()
  if (managementIP || !values.interfaces.some((item) => item.is_primary)) {
    if (managementIP) values.interfaces = values.interfaces.map(item => ({ ...item, is_primary: 0 }))
    const matchingIndex = values.interfaces.findIndex((item) => String(item.ip || '').trim() === managementIP && managementIP)
    if (matchingIndex >= 0) {
      values.interfaces[matchingIndex] = { ...values.interfaces[matchingIndex], is_primary: 1 }
    } else if (managementIP) {
      values.interfaces.unshift({
        name: '管理口',
        if_name: '管理口',
        ip: managementIP,
        mask: '',
        gateway: '',
        mac: '',
        network_zone: '未分类',
        net_zone: '未分类',
        is_primary: 1,
        vlan_id: 0,
        remark: '',
      })
    } else if (values.interfaces.length) {
      values.interfaces[0] = { ...values.interfaces[0], is_primary: 1 }
    }
  }

  return values
}

export function managementIPFromInterfaces(interfaces = []) {
  return String(interfaces.find((item) => item.is_primary)?.ip || '').trim()
}

export function infrastructureSavePayload(values) {
  const managementIP = managementIPFromInterfaces(values.interfaces)
  return { ...values, mgmt_ip: managementIP, manage_ip: managementIP }
}

export async function saveInfrastructureDraftPhotos(id, draft = {}, saveImage) {
  for (const [side, label] of [['front', '正面'], ['back', '背面']]) {
    const key = `${side}_image`
    if (!Object.hasOwn(draft, key)) continue
    try {
      await saveImage('infrastructure', id, side, draft[key])
    } catch (error) {
      throw new Error(`资产已保存，但${label}照片上传失败：${error.message || '未知错误'}`)
    }
  }
}

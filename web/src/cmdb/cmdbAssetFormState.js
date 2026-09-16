export function buildCmdbAssetEditPayload(values, editingAsset) {
  return {
    name: values.name,
    device_type: values.device_type ?? editingAsset.device_type,
    status: values.status,
    department: values.department ?? '',
    owner: values.owner ?? '',
    owner_id: values.owner_id ?? 0,
    org_id: values.org_id ?? 0,
    group_id: values.group_id ?? 0,
    category_id: values.category_id ?? 0,
    data_center: values.data_center ?? '',
    floor: values.floor ?? '',
    cabinet_name: values.cabinet_name ?? '',
    remark: values.remark ?? '',
    custom_fields: values.custom_fields ?? {},
  }
}

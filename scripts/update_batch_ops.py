import os

path = r'd:\全景项目\常州中级人民法院\Netcatty-Cmdb\build\netcatty-final\components\cmdb\TerminalAssets.jsx'
with open(path, 'r', encoding='utf-8') as f:
    text = f.read()

# 1. Update imports
old_imp = "import { ActionIcon, DataTable, EmptyState, ErrorBanner, Pagination, SelectControl, StatusPill, statusTone, Toolbar } from './ui'"
new_imp = "import { ActionIcon, DataTable, EmptyState, ErrorBanner, ModalForm, Pagination, SelectControl, StatusPill, statusTone, Toolbar } from './ui'"
assert old_imp in text, 'old_imp not found'
text = text.replace(old_imp, new_imp, 1)

# 2. Add state
old_state = "  const [archive, setArchive] = useState(null)"
new_state = """  const [archive, setArchive] = useState(null)
  const [selected, setSelected] = useState([])
  const [batchAction, setBatchAction] = useState(null)
  const [batchValues, setBatchValues] = useState({ group_id: '', device_type: '', os_type: '', os_version: '', status: '' })"""
assert old_state in text, 'old_state not found'
text = text.replace(old_state, new_state, 1)

# 3. Add batch save and openBatch handlers before const columns = [
old_cols = "  const columns = ["
batch_logic = """  const openBatch = (type) => {
    setBatchAction(type)
    setBatchValues({ group_id: '', device_type: '', os_type: '', os_version: '', status: '' })
  }

  const batchFields = useMemo(() => {
    const fields = []
    if (!batchAction || batchAction === 'all' || batchAction === 'group') {
      fields.push({
        key: 'group_id',
        label: '所属分组',
        searchable: true,
        options: choices([
          { value: '__KEEP__', label: '（保持原分组不变）' },
          { value: '0', label: '未分组 / 清空分组' },
          ...d.groups.map((item) => ({ value: String(item.id), label: item.name })),
        ]),
      })
    }
    if (!batchAction || batchAction === 'all' || batchAction === 'category') {
      fields.push({
        key: 'device_type',
        label: '设备分类',
        searchable: true,
        options: choices([
          { value: '', label: '（保持原分类不变）' },
          ...d.categories.map((item) => ({ value: item.name, label: item.name })),
        ]),
      })
    }
    if (!batchAction || batchAction === 'all' || batchAction === 'os') {
      fields.push({
        key: 'os_type',
        label: '操作系统类型',
        searchable: true,
        options: choices([
          { value: '', label: '（保持原操作系统不变）' },
          ...terminalOperatingSystemTypes.filter((t) => t !== '未知').map((item) => ({ value: item, label: item })),
        ]),
      })
      fields.push({
        key: 'os_version',
        label: '系统版本号',
        placeholder: '如：专业版 1050u2、22H2（选填，留空不修改）',
      })
    }
    if (batchAction === 'all') {
      fields.push({
        key: 'status',
        label: '设备状态',
        options: choices([
          { value: '', label: '（保持原状态不变）' },
          ...d.statuses.map((item) => ({ value: item, label: item })),
        ]),
      })
    }
    return fields
  }, [batchAction, d.categories, d.groups, d.statuses])

  const saveBatch = async () => {
    const count = selected.length
    if (count === 0) return
    const changes = {}
    if (batchValues.group_id && batchValues.group_id !== '__KEEP__') {
      changes.group_id = Number(batchValues.group_id)
    }
    if (batchValues.device_type) {
      changes.device_type = batchValues.device_type
    }
    if (batchValues.os_type) {
      changes.os_type = batchValues.os_type
    }
    if (batchValues.os_version) {
      changes.os_version = batchValues.os_version
    }
    if (batchValues.status) {
      changes.status = batchValues.status
    }
    if (Object.keys(changes).length === 0) {
      setBatchAction(null)
      return
    }

    await action.run(async () => {
      const selectedSet = new Set(selected.map(String))
      const targetAssets = (query.data?.list || []).filter((a) => selectedSet.has(String(a.id)))
      await Promise.all(
        targetAssets.map((asset) => {
          const updated = normalizeAsset({ ...asset, ...changes })
          return api.updateAsset(asset.id, updated)
        })
      )
      setBatchAction(null)
      setSelected([])
      query.reload()
      directoryChanged()
      setDetailRevision((x) => x + 1)
    }, `已批量更新 ${count} 台终端信息`)
  }

  const columns = ["""
assert old_cols in text, 'old_cols not found'
text = text.replace(old_cols, batch_logic, 1)

# 4. Add batch toolbar and DataTable props
old_table = "<DataTable columns={visibleColumns} compact={density !== 'wide'} rows={query.error ? [] : query.data?.list || []} loading={query.loading} />"
new_table = """{selected.length > 0 && (
      <div className="my-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-xs shadow-sm">
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground">已选中 <strong className="text-primary">{selected.length}</strong> 台终端设备</span>
          <span className="text-muted-foreground">|</span>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => openBatch('all')}>批量修改属性</Button>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => openBatch('group')}>批量设置分组</Button>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => openBatch('category')}>批量设置分类</Button>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => openBatch('os')}>批量设置操作系统</Button>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setSelected([])}>取消选中</Button>
        </div>
      </div>
    )}

    <DataTable columns={visibleColumns} compact={density !== 'wide'} rows={query.error ? [] : query.data?.list || []} loading={query.loading} selected={selected} onSelectedChange={setSelected} />"""
assert old_table in text, 'old_table not found'
text = text.replace(old_table, new_table, 1)

# 5. Add ModalForm for batch editing before ConfirmDialog
old_confirm = "<ConfirmDialog open={!!archive}"
new_modal = """{batchAction && (
      <ModalForm
        title={batchAction === 'group' ? `批量设置分组（已选 ${selected.length} 台）` : batchAction === 'category' ? `批量设置分类（已选 ${selected.length} 台）` : batchAction === 'os' ? `批量设置操作系统（已选 ${selected.length} 台）` : `批量修改属性（已选 ${selected.length} 台）`}
        open={!!batchAction}
        onOpenChange={(v) => { if (!v) setBatchAction(null) }}
        busy={action.busy}
        onSubmit={saveBatch}
      >
        <div className="space-y-4 py-2">
          <p className="text-xs text-muted-foreground">
            请选择要批量应用的属性值，未填或保持不变的字段不会修改选中终端的既有数据。
          </p>
          <Fields fields={batchFields} value={batchValues} onChange={setBatchValues} />
        </div>
      </ModalForm>
    )}

    <ConfirmDialog open={!!archive}"""
assert old_confirm in text, 'old_confirm not found'
text = text.replace(old_confirm, new_modal, 1)

with open(path, 'w', encoding='utf-8') as f:
    f.write(text)

# Also sync to integrations
int_path = r'd:\全景项目\常州中级人民法院\Netcatty-Cmdb\integrations\netcatty\cmdb\TerminalAssets.jsx'
with open(int_path, 'w', encoding='utf-8') as f:
    f.write(text)

print('TerminalAssets.jsx successfully updated in build and integrations!')

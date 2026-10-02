import React, { useState } from 'react'
import { ArrowDownUp, Download, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dropdown, DropdownContent, DropdownTrigger } from '@/components/ui/dropdown'
import { vaultHeaderIconButtonClass } from '@/components/vault/VaultPageHeader'
import { useAction } from './hooks'
import ImportDialog from './ImportDialog'

export default function AssetTransferMenu({ importer, exporter, onImported, importTitle, importLabel }) {
  const exportAction = useAction()
  const [open, setOpen] = useState(false)
  return <ImportDialog importer={importer} onImported={onImported} title={importTitle} renderTrigger={(startImport, importBusy) =>
    <Dropdown open={open} onOpenChange={setOpen}><DropdownTrigger asChild><Button type="button" variant="ghost" size="icon" className={vaultHeaderIconButtonClass} aria-label="导入/导出" title="导入/导出"><ArrowDownUp size={16} /></Button></DropdownTrigger>
      <DropdownContent align="end" sideOffset={6} className="w-44 p-1">
        <button type="button" disabled={importBusy} onClick={() => { setOpen(false); startImport() }} className="flex h-9 w-full items-center gap-2 rounded px-2 text-left text-xs hover:bg-secondary disabled:opacity-50"><Upload size={14} />{importLabel || importTitle}</button>
        <button type="button" disabled={exportAction.busy} onClick={() => { setOpen(false); void exportAction.run(exporter) }} className="flex h-9 w-full items-center gap-2 rounded px-2 text-left text-xs hover:bg-secondary disabled:opacity-50"><Download size={14} />导出当前筛选</button>
      </DropdownContent></Dropdown>
  } />
}

import React, { useEffect, useRef, useState } from 'react'
import { ImagePlus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { api } from './api'
import { ActionIcon, DetailSheet } from './ui'

const maxImageBytes = 500 * 1024

async function preparePhoto(file) {
  if (!file.type.startsWith('image/')) throw new Error('请选择图片文件')
  const bitmap = await createImageBitmap(file)
  try {
    const canvas = document.createElement('canvas')
    for (const edge of [1600, 1300, 1000]) {
      const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height))
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      const context = canvas.getContext('2d')
      if (!context) throw new Error('无法处理图片')
      context.fillStyle = '#fff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      for (const quality of [0.82, 0.7, 0.55]) {
        const data = canvas.toDataURL('image/jpeg', quality)
        const encodedLength = data.length - data.indexOf(',') - 1
        if (Math.floor(encodedLength * 3 / 4) <= maxImageBytes) return data
      }
    }
    throw new Error('图片压缩后仍超过 500 KiB，请换一张图片')
  } finally {
    bitmap.close()
  }
}

export default function DeviceImages({ kind, id, mainOnly = false, draftMode = false, draftImages = {}, onDraftChange, onBusyChange }) {
  const [savedImages, setSavedImages] = useState({ front_image: '', back_image: '' })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [preview, setPreview] = useState('')
  const inputs = { front: useRef(null), back: useRef(null) }
  const images = draftMode ? draftImages : savedImages

  useEffect(() => {
    if (draftMode) { setLoading(false); setError(''); return undefined }
    let active = true
    setLoading(true)
    api.assetImages(kind, id).then((result) => {
      if (active) { setSavedImages(result); setError('') }
    }).catch((failure) => {
      if (active) setError(failure.message || '读取设备照片失败')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [kind, id, draftMode])

  const save = async (side, data) => {
    setBusy(side)
    onBusyChange?.(true)
    try {
      if (draftMode) onDraftChange((current) => ({ ...current, [`${side}_image`]: data }))
      else {
        await api.saveAssetImage(kind, id, side, data)
        setSavedImages((current) => ({ ...current, [`${side}_image`]: data }))
        toast.success(data ? '照片已保存' : '照片已移除')
      }
      setError('')
    } catch (failure) {
      setError(failure.message || '保存设备照片失败')
    } finally {
      setBusy('')
      onBusyChange?.(false)
    }
  }

  const choose = async (side, file) => {
    onBusyChange?.(true)
    try {
      await save(side, await preparePhoto(file))
    } catch (failure) {
      setError(failure.message || '图片处理失败')
    } finally {
      onBusyChange?.(false)
    }
  }

  if (loading) return <p className="text-xs text-muted-foreground">正在读取设备照片…</p>
  return <div className="space-y-2">
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    <div className="grid grid-cols-1 gap-3">
      {(mainOnly ? [['front', '设备图片']] : [['front', '正面'], ['back', '背面']]).map(([side, label]) => {
        const src = images[`${side}_image`]
        const imageLabel = mainOnly ? label : `${label}照片`
        return <div key={side} className="min-w-0 space-y-1.5">
          <div className="flex h-7 items-center justify-between gap-2"><span className="text-xs font-medium">{label}</span><div className="flex items-center"><ActionIcon label={`${src ? '替换' : '上传'}${imageLabel}`} disabled={!!busy} onClick={() => inputs[side].current?.click()}><ImagePlus size={14} /></ActionIcon>{src && <ActionIcon label={`移除${imageLabel}`} disabled={!!busy} danger onClick={() => save(side, '')}><Trash2 size={14} /></ActionIcon>}</div></div>
          <input ref={inputs[side]} type="file" accept="image/*" className="hidden" aria-label={`选择${imageLabel}`} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void choose(side, file) }} />
          {src ? <button type="button" className="grid aspect-[5/1] w-full place-items-center overflow-hidden rounded-md border border-border/70 bg-muted/20" onClick={() => setPreview(side)} title={`查看${imageLabel}`}><img src={src} alt={imageLabel} className="h-full w-full object-contain" /></button> : <Button type="button" variant="outline" className="aspect-[5/1] h-auto w-full border-dashed text-xs text-muted-foreground" disabled={!!busy} onClick={() => inputs[side].current?.click()}>{busy === side ? '保存中…' : '未上传'}</Button>}
        </div>
      })}
    </div>
    <DetailSheet open={!!preview} onOpenChange={(open) => { if (!open) setPreview('') }} title={mainOnly ? '设备图片' : `设备${preview === 'front' ? '正面' : '背面'}照片`}>{preview && <img src={images[`${preview}_image`]} alt={mainOnly ? '设备图片' : `设备${preview === 'front' ? '正面' : '背面'}照片`} className="max-h-[80vh] w-full object-contain" />}</DetailSheet>
  </div>
}

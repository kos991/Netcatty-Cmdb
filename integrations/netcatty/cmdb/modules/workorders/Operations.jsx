import React, { useEffect, useState } from 'react'
import WorkOrders from './WorkOrders'

export default function Operations({ focusTarget }) {
  const [view, setView] = useState('stats')
  useEffect(() => {
    if (focusTarget?.tableKey === 'asset_logs') setView('stats')
  }, [focusTarget])

  return <div className="flex h-full min-h-0 flex-col"><WorkOrders mode={view} onModeChange={setView} /></div>
}

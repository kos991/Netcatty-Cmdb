import React from 'react'
import WorkOrders from './WorkOrders'

export default function Operations({ focusTarget, onNavigate }) {
  return <div className="flex h-full min-h-0 flex-col"><WorkOrders focusTarget={focusTarget} onNavigate={onNavigate} /></div>
}

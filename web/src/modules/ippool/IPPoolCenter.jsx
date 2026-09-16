import React from 'react'
import IPManager from '../../IPManager'
import './ip-pool-new.css'

// IP 池完整实现：网段管理、占用网格、分配、释放、编辑、删除、补录和导出。
export default function IPPoolCenter({ meta, focusTarget }) {
  return <section className="ip-new-page ip-functional-page"><IPManager meta={meta} focusTarget={focusTarget} /></section>
}

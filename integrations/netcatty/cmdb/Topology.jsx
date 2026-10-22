import React from 'react'
import { Construction } from 'lucide-react'

export default function Topology() {
  return <section aria-label="拓扑图" className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-background text-muted-foreground">
    <Construction size={32} aria-hidden="true" />
    <p className="text-sm">正在动工中</p>
  </section>
}

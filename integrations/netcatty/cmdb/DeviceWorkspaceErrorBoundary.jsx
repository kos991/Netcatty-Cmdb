import React from 'react'
import { TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default class DeviceWorkspaceErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('Cmdb 设备工作区渲染失败', error, info)
  }

  componentDidUpdate(previousProps) {
    if (previousProps.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null })
  }

  retry = () => {
    this.setState({ error: null })
    this.props.onRetry?.()
  }

  render() {
    if (!this.state.error) return this.props.children
    return <div className="grid min-h-0 flex-1 place-items-center p-6" data-section="device-workspace-error">
      <div className="w-full max-w-md border border-destructive/40 bg-destructive/5 p-4"><div className="flex items-start gap-3"><TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" /><div className="min-w-0"><h2 className="text-sm font-semibold">设备工作区加载失败</h2><p className="mt-1 break-words text-xs text-muted-foreground">{this.state.error?.message || '发生未知错误，请重试。'}</p></div></div><div className="mt-4 flex justify-end gap-2"><Button type="button" variant="outline" size="sm" onClick={this.props.onClose}>关闭</Button><Button type="button" size="sm" onClick={this.retry}>重试</Button></div></div>
    </div>
  }
}

import React from 'react'
import ShellPreview from './ShellPreview'
import CmdbWorkspace from './CmdbWorkspace'

export default function App() {
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('preview') === 'shells') return <ShellPreview />
  return <CmdbWorkspace />
}

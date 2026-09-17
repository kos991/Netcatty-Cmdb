import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pinnedSource = resolve(process.env.NETCATTY_TEST_SOURCE || join(repositoryRoot, 'build', 'netcatty'))
const upstream = JSON.parse(readFileSync(join(repositoryRoot, 'integrations', 'netcatty', 'upstream.json'), 'utf8'))

function git(args) {
  return execFileSync('git', args, { cwd: pinnedSource, encoding: 'utf8', stdio: 'pipe' }).trim()
}

test('装配为原生 Cmdb 根标签和左侧八入口工作区', (t) => {
  if (!existsSync(join(pinnedSource, '.git'))) {
    t.skip(`未找到锁定的 Netcatty 测试源: ${pinnedSource}`)
    return
  }
  assert.equal(git(['rev-parse', 'HEAD']), upstream.commit)

  const fixtureRoot = mkdtempSync(join(tmpdir(), 'netcatty-cmdb-prepare-'))
  const fixture = join(fixtureRoot, 'netcatty')
  let added = false
  let topTabs
  let activeChrome
  let workspace
  let workspaceState
  try {
    git(['worktree', 'add', '--detach', fixture, upstream.commit])
    added = true
    execFileSync(process.execPath, [join(repositoryRoot, 'scripts', 'prepare-netcatty.mjs'), '--target', fixture], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      stdio: 'pipe',
    })
    topTabs = readFileSync(join(fixture, 'components', 'TopTabs.tsx'), 'utf8')
    activeChrome = readFileSync(join(fixture, 'application', 'app', 'AppActiveTabChrome.tsx'), 'utf8')
    workspace = readFileSync(join(fixture, 'components', 'cmdb', 'CmdbWorkspace.jsx'), 'utf8')
    workspaceState = readFileSync(join(fixture, 'components', 'cmdb', 'cmdbWorkspaceState.js'), 'utf8')
  } finally {
    if (added) git(['worktree', 'remove', '--force', fixture])
    rmSync(fixtureRoot, { recursive: true, force: true })
  }

  assert.match(topTabs, /tabId="cmdb"[\s\S]{0,160}label="Cmdb"/)
  assert.match(topTabs, /<Database size=\{14\} \/>/)
  assert.match(activeChrome, /if \(activeTabId === 'cmdb'\) return 'Cmdb';/)
  assert.doesNotMatch(workspace, /ModuleTabs|cmdb-module-tabs/)
  assert.match(workspace, /from 'lucide-react'/)
  assert.match(workspace, /<aside[^>]+cmdb-workspace-sidebar/)
  assert.match(workspace, /<nav[^>]+cmdb-workspace-nav/)
  for (const icon of ['Search', 'Monitor', 'Server', 'AppWindow', 'Users', 'Network', 'ChartNoAxesCombined', 'Settings2']) {
    assert.match(workspace, new RegExp(`\\b${icon}\\b`))
  }
  for (const key of ['search', 'assets', 'infrastructure', 'systems', 'people', 'ip', 'operations', 'config']) {
    assert.match(workspaceState, new RegExp(`key: '${key}'`))
  }
})

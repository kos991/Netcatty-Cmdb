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

test('装配为原生 Cmdb 根标签和左侧五入口工作区', (t) => {
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
  let appHandlers
  let appView
  let surface
  let workspace
  let workspaceState
  let deviceAssetCenter
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
    appHandlers = readFileSync(join(fixture, 'application', 'app', 'AppHandlers.ts'), 'utf8')
    appView = readFileSync(join(fixture, 'application', 'app', 'AppView.tsx'), 'utf8')
    surface = readFileSync(join(fixture, 'components', 'cmdb', 'CmdbSurface.tsx'), 'utf8')
    workspace = readFileSync(join(fixture, 'components', 'cmdb', 'CmdbWorkspace.jsx'), 'utf8')
    workspaceState = readFileSync(join(fixture, 'components', 'cmdb', 'cmdbWorkspaceState.js'), 'utf8')
    deviceAssetCenter = readFileSync(join(fixture, 'components', 'cmdb', 'modules', 'assets', 'DeviceAssetCenter.jsx'), 'utf8')
  } finally {
    if (added) git(['worktree', 'remove', '--force', fixture])
    rmSync(fixtureRoot, { recursive: true, force: true })
  }

  assert.match(topTabs, /tabId="cmdb"[\s\S]{0,160}label="Cmdb"/)
  assert.match(topTabs, /<Database size=\{14\} \/>/)
  assert.match(activeChrome, /if \(activeTabId === 'cmdb'\) return 'Cmdb';/)
  assert.match(appHandlers, /visibleCmdb\?\.getClientRects\(\)\.length/)
  assert.match(appHandlers, /e\.key\.toLowerCase\(\) === 'k'/)
  assert.match(appHandlers, /if \(isCmdbSearchHotkey\) return;/)
  assert.match(appView, /import \{ CmdbSurface \} from '\.\.\/\.\.\/components\/cmdb\/CmdbSurface';/)
  assert.doesNotMatch(appView, /import CmdbWorkspace/)
  assert.match(surface, /from 'lucide-react'/)
  assert.match(surface, /from '\.\.\/ui\/ripple'/)
  assert.match(surface, /from '\.\.\/ui\/tooltip'/)
  assert.match(surface, /data-section="cmdb-sidebar"/)
  assert.match(surface, /data-section="cmdb-surface"/)
  assert.match(surface, /useState\('assets'\)/)
  assert.match(surface, /<CmdbWorkspace[\s\S]+activeModule=\{activeModule\}[\s\S]+onModuleChange=\{setActiveModule\}/)
  assert.match(workspace, /activeModule[\s\S]+onModuleChange/)
  assert.match(deviceAssetCenter, /data-device-asset-search-input/)
  assert.doesNotMatch(workspace, /GlobalSearch/)
  assert.doesNotMatch(workspace, /<aside|cmdb-workspace-sidebar|cmdb-workspace-collapse/)
  for (const icon of ['Monitor', 'Users', 'Network', 'ChartNoAxesCombined', 'Settings2']) {
    assert.match(surface, new RegExp(`\\b${icon}\\b`))
  }
  for (const key of ['assets', 'people', 'ip', 'operations', 'config']) {
    assert.match(workspaceState, new RegExp(`key: '${key}'`))
  }
  for (const key of ['search', 'infrastructure', 'systems']) {
    assert.doesNotMatch(workspaceState, new RegExp(`key: '${key}'`))
  }
})

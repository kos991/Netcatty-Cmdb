import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
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
  let terminalAssets
  let infrastructure
  let infrastructureEditor
  let systems
  let ipam
  let cmdbUi
  let configCenter
  let cmdbApi
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
    workspaceState = readFileSync(join(fixture, 'components', 'cmdb', 'state.js'), 'utf8')
    deviceAssetCenter = readFileSync(join(fixture, 'components', 'cmdb', 'DeviceAssets.jsx'), 'utf8')
    terminalAssets = readFileSync(join(fixture, 'components', 'cmdb', 'TerminalAssets.jsx'), 'utf8')
    infrastructure = readFileSync(join(fixture, 'components', 'cmdb', 'Infrastructure.jsx'), 'utf8')
    infrastructureEditor = readFileSync(join(fixture, 'components', 'cmdb', 'InfrastructureEditor.jsx'), 'utf8')
    systems = readFileSync(join(fixture, 'components', 'cmdb', 'Systems.jsx'), 'utf8')
    ipam = readFileSync(join(fixture, 'components', 'cmdb', 'IPAM.jsx'), 'utf8')
    cmdbUi = readFileSync(join(fixture, 'components', 'cmdb', 'ui.jsx'), 'utf8')
    configCenter = readFileSync(join(fixture, 'components', 'cmdb', 'ConfigCenter.jsx'), 'utf8')
    cmdbApi = readFileSync(join(fixture, 'components', 'cmdb', 'api.js'), 'utf8')
    const packageJSON = JSON.parse(readFileSync(join(fixture, 'package.json'), 'utf8'))
    for (const dependency of ['antd', '@ant-design/icons', '@ant-design/v5-patch-for-react-19', 'dayjs']) {
      assert.equal(packageJSON.dependencies[dependency], undefined, `不得装配 ${dependency}`)
    }
    for (const name of readdirSync(join(fixture, 'components', 'cmdb'))) {
      if (!/\.(js|jsx|tsx)$/.test(name)) continue
      const code = readFileSync(join(fixture, 'components', 'cmdb', name), 'utf8')
      assert.doesNotMatch(code, /\bantd\b|@ant-design|ConfigProvider/, name)
    }
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
  assert.match(surface, /from '\.\.\/ui\/tooltip'/)
  assert.match(surface, /data-section="cmdb-sidebar"/)
  assert.match(surface, /data-section="cmdb-surface"/)
  assert.match(surface, /useState\('assets'\)/)
  assert.match(surface, /<CmdbWorkspace[\s\S]+activeModule=\{activeModule\}[\s\S]+onModuleChange=\{setActiveModule\}/)
  assert.match(workspace, /activeModule[\s\S]+onModuleChange/)
  assert.match(deviceAssetCenter, /data-device-asset-search-input/)
  assert.match(deviceAssetCenter, /VaultHeaderSearch/)
  assert.match(deviceAssetCenter, /VaultPageHeader/)
  assert.match(deviceAssetCenter, /from '@\/components\/vault\/VaultPageHeader'/)
  assert.match(deviceAssetCenter, /min-w-\[320px\] max-w-\[720px\] flex-1/)
  assert.match(deviceAssetCenter, /data-device-assets-add/)
  assert.match(deviceAssetCenter, /data-device-assets-refresh/)
  assert.match(deviceAssetCenter, /command=\{command\}/)
  assert.match(terminalAssets, /command\?\.tab !== 'terminals'/)
  assert.match(infrastructure, /command\?\.tab !== 'infrastructure'/)
  assert.match(systems, /command\?\.tab !== 'systems'/)
  assert.doesNotMatch(deviceAssetCenter, /import \{ SearchBox \} from '\.\/ui'/)
  for (const child of ['TerminalAssets', 'Infrastructure', 'Systems']) assert.match(deviceAssetCenter, new RegExp(`\\b${child}\\b`))
  assert.doesNotMatch(workspace, /GlobalSearch/)
  assert.doesNotMatch(workspace, /<aside|cmdb-workspace-sidebar|cmdb-workspace-collapse/)
  assert.match(infrastructure, /<InfrastructureEditor/)
  assert.match(cmdbApi, /replaceInfrastructure:[\s\S]*\/full/)
  for (const section of ['basic', 'credentials', 'ownership', 'network', 'system']) {
    assert.match(infrastructureEditor, new RegExp(`data-asset-section=\\{sectionKey\\}`))
    assert.match(infrastructureEditor, new RegExp(`'${section}'`))
  }
  for (const removedSection of ['地理位置', '电力与规格', '自定义属性', '其他信息']) assert.doesNotMatch(infrastructureEditor, new RegExp(removedSection))
  for (const removedField of ['所属数据中心', '楼层', '机柜名称', '设备高度', '额定功耗', '公网 IP', '服务商', '可用区', '管理账号']) assert.doesNotMatch(infrastructureEditor, new RegExp(removedField))
  assert.match(infrastructureEditor, /归属关系/)
  assert.doesNotMatch(infrastructureEditor, /归属与位置/)
  assert.doesNotMatch(infrastructure, /自定义属性|api\.customFields|show_in_list/)
  assert.doesNotMatch(configCenter, /自定义字段|custom-fields|api\.customFields|saveCustomField|deleteCustomField/)
  for (const removedModelField of ['height_u', 'rated_power_w', 'max_power_w', 'weight_kg', 'depth_mm']) assert.doesNotMatch(configCenter, new RegExp(removedModelField))
  for (const removedDetail of ['数据中心', '楼层', '机柜', '额定功耗', '最大功耗', '电源类型', '省', '市', '区', '地址']) assert.doesNotMatch(infrastructure, new RegExp(`'${removedDetail}'`))
  assert.doesNotMatch(deviceAssetCenter, />搜索<\/Button>/)
  assert.match(infrastructureEditor, /NetworkInterfaces/)
  assert.match(infrastructureEditor, /CredentialPicker/)
  assert.match(ipam, /data-ipam-address-grid/)
  assert.match(ipam, /repeat\(auto-fill,minmax\(52px,1fr\)\)/)
  assert.match(ipam, /h-9 min-w-0/)
  assert.match(ipam, /data-ipam-address-value/)
  assert.match(cmdbUi, /bg-secondary\/30/)
  assert.match(cmdbUi, /hover:bg-secondary\/60/)
  assert.match(cmdbUi, /border-border\/30/)
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

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

test('装配为原生 Cmdb 根标签、四个工作区入口与设置页配置', (t) => {
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
  let appSideEffects
  let surface
  let workspace
  let workspaceState
  let deviceAssetCenter
  let terminalAssets
  let infrastructure
  let infrastructureEditor
  let fields
  let systems
  let ipam
  let cmdbUi
  let people
  let workOrders
  let configCenter
  let settingsPage
  let settingsApplication
  let netcattyConnectionFields
  let deviceWorkspace
  let deviceImages
  let deviceOwnershipBar
  let deviceRelations
  let netcattyLinks
  let switchWorkspace
  let routerOperations
  let serverOperations
  let deviceWorkspaceErrorBoundary
  let cmdbApi
  let syncDomain
  let syncPayload
  let syncMerge
  let convergentRuntime
  let hasCmdbCloudSyncModule
  let hasCmdbSnapshotModule
  let hasCmdbAttachmentCloudBridge
  let preloadApi
  let globalTypes
  let registerBridges
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
    appSideEffects = readFileSync(join(fixture, 'application', 'app', 'AppSideEffects.tsx'), 'utf8')
    surface = readFileSync(join(fixture, 'components', 'cmdb', 'CmdbSurface.tsx'), 'utf8')
    workspace = readFileSync(join(fixture, 'components', 'cmdb', 'CmdbWorkspace.jsx'), 'utf8')
    workspaceState = readFileSync(join(fixture, 'components', 'cmdb', 'state.js'), 'utf8')
    deviceAssetCenter = readFileSync(join(fixture, 'components', 'cmdb', 'DeviceAssets.jsx'), 'utf8')
    terminalAssets = readFileSync(join(fixture, 'components', 'cmdb', 'TerminalAssets.jsx'), 'utf8')
    infrastructure = readFileSync(join(fixture, 'components', 'cmdb', 'Infrastructure.jsx'), 'utf8')
    infrastructureEditor = readFileSync(join(fixture, 'components', 'cmdb', 'InfrastructureEditor.jsx'), 'utf8')
    fields = readFileSync(join(fixture, 'components', 'cmdb', 'Fields.jsx'), 'utf8')
    systems = readFileSync(join(fixture, 'components', 'cmdb', 'Systems.jsx'), 'utf8')
    ipam = readFileSync(join(fixture, 'components', 'cmdb', 'IPAM.jsx'), 'utf8')
    cmdbUi = readFileSync(join(fixture, 'components', 'cmdb', 'ui.jsx'), 'utf8')
    people = readFileSync(join(fixture, 'components', 'cmdb', 'People.jsx'), 'utf8')
    workOrders = readFileSync(join(fixture, 'components', 'cmdb', 'WorkOrders.jsx'), 'utf8')
    configCenter = readFileSync(join(fixture, 'components', 'cmdb', 'ConfigCenter.jsx'), 'utf8')
    settingsPage = readFileSync(join(fixture, 'components', 'SettingsPage.tsx'), 'utf8')
    settingsApplication = readFileSync(join(fixture, 'components', 'SettingsApplicationTab.tsx'), 'utf8')
    netcattyConnectionFields = readFileSync(join(fixture, 'components', 'cmdb', 'NetcattyConnectionFields.jsx'), 'utf8')
    const deviceWorkspacePath = join(fixture, 'components', 'cmdb', 'DeviceWorkspace.jsx')
    const deviceOwnershipBarPath = join(fixture, 'components', 'cmdb', 'DeviceOwnershipBar.jsx')
    const deviceRelationsPath = join(fixture, 'components', 'cmdb', 'DeviceRelations.jsx')
    const netcattyLinksPath = join(fixture, 'components', 'cmdb', 'NetcattyLinks.jsx')
    deviceWorkspace = existsSync(deviceWorkspacePath) ? readFileSync(deviceWorkspacePath, 'utf8') : ''
    deviceImages = readFileSync(join(fixture, 'components', 'cmdb', 'DeviceImages.jsx'), 'utf8')
    deviceOwnershipBar = existsSync(deviceOwnershipBarPath) ? readFileSync(deviceOwnershipBarPath, 'utf8') : ''
    deviceRelations = existsSync(deviceRelationsPath) ? readFileSync(deviceRelationsPath, 'utf8') : ''
    netcattyLinks = existsSync(netcattyLinksPath) ? readFileSync(netcattyLinksPath, 'utf8') : ''
    switchWorkspace = readFileSync(join(fixture, 'components', 'cmdb', 'SwitchWorkspace.jsx'), 'utf8')
    const routerOperationsPath = join(fixture, 'components', 'cmdb', 'RouterOperations.jsx')
    const serverOperationsPath = join(fixture, 'components', 'cmdb', 'ServerOperations.jsx')
    routerOperations = existsSync(routerOperationsPath) ? readFileSync(routerOperationsPath, 'utf8') : ''
    serverOperations = existsSync(serverOperationsPath) ? readFileSync(serverOperationsPath, 'utf8') : ''
    const errorBoundaryPath = join(fixture, 'components', 'cmdb', 'DeviceWorkspaceErrorBoundary.jsx')
    deviceWorkspaceErrorBoundary = existsSync(errorBoundaryPath) ? readFileSync(errorBoundaryPath, 'utf8') : ''
    cmdbApi = readFileSync(join(fixture, 'components', 'cmdb', 'api.js'), 'utf8')
    syncDomain = readFileSync(join(fixture, 'domain', 'sync.ts'), 'utf8')
    syncPayload = readFileSync(join(fixture, 'application', 'syncPayload.ts'), 'utf8')
    syncMerge = readFileSync(join(fixture, 'domain', 'syncMerge.ts'), 'utf8')
    convergentRuntime = readFileSync(join(fixture, 'infrastructure', 'services', 'cloudSync', 'convergentSyncRuntimeMethods.ts'), 'utf8')
    hasCmdbCloudSyncModule = existsSync(join(fixture, 'application', 'CmdbCloudSync.ts'))
    hasCmdbSnapshotModule = existsSync(join(fixture, 'domain', 'CmdbSyncSnapshot.ts'))
    hasCmdbAttachmentCloudBridge = existsSync(join(fixture, 'electron', 'bridges', 'cmdbAttachmentCloud.cjs'))
    preloadApi = readFileSync(join(fixture, 'electron', 'preload', 'api.cjs'), 'utf8')
    globalTypes = readFileSync(join(fixture, 'global.d.ts'), 'utf8')
    registerBridges = readFileSync(join(fixture, 'electron', 'main', 'registerBridges.cjs'), 'utf8')
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
  assert.match(appView, /<CmdbSurface onConnectHost=\{handleHostConnectWithProtocolCheck\} \/>/)
  assert.match(syncDomain, /cmdbSnapshot\?: import\('\.\/CmdbSyncSnapshot'\)/)
  assert.match(syncPayload, /collectCmdbCloudSnapshot/)
  assert.match(syncPayload, /applyCmdbCloudSnapshot/)
  assert.match(syncPayload, /if \(payload\.cmdbSnapshot\) return true/)
  assert.match(syncMerge, /mergeOptionalCmdbSnapshots/)
  assert.match(convergentRuntime, /cycleCmdbBaseByProvider/)
  assert.match(convergentRuntime, /providerCmdbMismatch/)
  assert.equal(hasCmdbCloudSyncModule, true)
  assert.equal(hasCmdbSnapshotModule, true)
  assert.equal(hasCmdbAttachmentCloudBridge, true)
  assert.match(preloadApi, /cmdbSelectAttachmentDirectory/)
  assert.match(preloadApi, /cmdbSyncAttachments/)
  assert.match(preloadApi, /cmdbDownloadAttachment/)
  assert.match(globalTypes, /cmdbSelectAttachmentDirectory/)
  assert.match(globalTypes, /cmdbSyncAttachments/)
  assert.match(globalTypes, /cmdbDownloadAttachment/)
  assert.match(registerBridges, /registerCmdbAttachmentCloud/)
  assert.match(registerBridges, /buildS3Client: cloudSyncBridge\.buildS3Client/)
  assert.doesNotMatch(appView, /import CmdbWorkspace/)
  assert.match(surface, /from 'lucide-react'/)
  assert.match(surface, /from '\.\.\/ui\/tooltip'/)
  assert.match(surface, /from '\.\.\/AppLogo'/)
  assert.match(surface, /from '\.\.\/AppWordmark'/)
  assert.match(surface, /from '\.\.\/ui\/ripple'/)
  assert.match(surface, /useStoredNumber/)
  assert.match(surface, /SIDEBAR_COLLAPSED_WIDTH = 56/)
  assert.match(surface, /SIDEBAR_EXPANDED_WIDTH = 208/)
  assert.match(surface, /<RippleButton/)
  assert.match(surface, /<AppLogo/)
  assert.match(surface, /<AppWordmark/)
  assert.match(surface, /role="separator"/)
  assert.match(surface, /rounded-xl border border-border\/60 bg-background shadow-sm/)
  assert.doesNotMatch(surface, /w-\[70px\]/)
  assert.match(surface, /data-section="cmdb-sidebar"/)
  assert.match(surface, /data-section="cmdb-surface"/)
  assert.match(surface, /useState\('assets'\)/)
  assert.match(surface, /useVaultSnapshotField\('hosts'\)/)
  assert.match(surface, /useVaultSnapshotField\('keys'\)/)
  assert.match(surface, /useVaultSnapshotField\('identities'\)/)
  assert.match(surface, /<CmdbWorkspace[\s\S]+activeModule=\{activeModule\}[\s\S]+onModuleChange=\{setActiveModule\}/)
  assert.match(workspace, /activeModule[\s\S]+onModuleChange/)
  assert.match(deviceAssetCenter, /data-device-asset-search-input/)
  assert.match(deviceAssetCenter, /VaultHeaderSearch/)
  assert.match(deviceAssetCenter, /VaultPageHeader/)
  assert.match(deviceAssetCenter, /from '@\/components\/vault\/VaultPageHeader'/)
  assert.match(deviceAssetCenter, /min-w-\[180px\] max-w-\[520px\] flex-1/)
  assert.match(deviceAssetCenter, /data-device-assets-add/)
  assert.doesNotMatch(deviceAssetCenter, /data-device-assets-refresh/)
  assert.match(deviceAssetCenter, /command=\{command\}/)
  assert.match(people, /VaultHeaderSearch/)
  assert.match(people, /VaultPageHeader/)
  assert.match(people, /data-people-filter/)
  assert.match(people, /aria-label="导入\/导出"/)
  assert.match(people, /<Filter/)
  assert.doesNotMatch(people, /导入人员<\/Button>/)
  assert.doesNotMatch(people, /data-people-refresh/)
  assert.match(terminalAssets, /command\?\.tab !== 'terminals'/)
  assert.match(infrastructure, /command\?\.tab !== 'infrastructure'/)
  assert.match(systems, /command\?\.tab !== 'systems'/)
  assert.doesNotMatch(deviceAssetCenter, /import \{ SearchBox \} from '\.\/ui'/)
  for (const child of ['TerminalAssets', 'Infrastructure', 'Systems']) assert.match(deviceAssetCenter, new RegExp(`\\b${child}\\b`))
  assert.doesNotMatch(workspace, /GlobalSearch/)
  assert.doesNotMatch(workspace, /<aside|cmdb-workspace-sidebar|cmdb-workspace-collapse/)
  assert.match(infrastructure, /<InfrastructureEditor/)
  assert.match(infrastructure, /<DeviceWorkspace/)
  assert.doesNotMatch(infrastructure, /<DetailSheet title="设备资产详情"/)
  assert.match(deviceWorkspace, /DeviceOwnershipBar/)
  assert.match(deviceOwnershipBar, /data-section="device-ownership-card"/)
  assert.match(deviceWorkspace, /DeviceRelations/)
  assert.match(deviceWorkspace, /activeTab === 'network'[\s\S]+view="network"/)
  assert.match(deviceWorkspace, /activeTab === 'relations'[\s\S]+view="relations"/)
  assert.doesNotMatch(deviceWorkspace, /网络与关联/)
  assert.match(netcattyLinks, /凭证中心/)
  assert.doesNotMatch(netcattyLinks, /Netcatty 主机与钥匙串/)
  for (const section of ['device-network-relations', 'device-netcatty-links', 'device-asset-history', 'device-asset-profile']) {
    assert.match(deviceRelations, new RegExp(`(?:data-section|dataSection)="${section}"`))
  }
  assert.match(deviceWorkspace, /SwitchWorkspace/)
  assert.match(switchWorkspace, /data-section="switch-configuration-status"/)
  assert.match(switchWorkspace, /data-switch-port-panel/)
  assert.match(switchWorkspace, /data-section="switch-security-access"/)
  assert.match(switchWorkspace, /onAddLinkForPort/)
  assert.match(deviceWorkspace, /RouterOperations/)
  assert.match(deviceWorkspace, /ServerOperations/)
  assert.match(routerOperations, /data-section="router-operations"/)
  assert.doesNotMatch(routerOperations, /路由表|NAT|VPN|配置备份/)
  assert.match(serverOperations, /data-section="server-operations"/)
  assert.match(serverOperations, /related_applications/)
  assert.match(infrastructure, /DeviceWorkspaceErrorBoundary/)
  assert.match(deviceWorkspaceErrorBoundary, /componentDidCatch/)
  assert.match(deviceWorkspaceErrorBoundary, /data-section="device-workspace-error"/)
  assert.match(cmdbApi, /replaceInfrastructure:[\s\S]*\/full/)
  for (const section of ['basic', 'connection', 'ownership', 'network', 'system']) {
    assert.match(infrastructureEditor, new RegExp(`data-asset-section=\\{sectionKey\\}`))
    assert.match(infrastructureEditor, new RegExp(`'${section}'`))
  }
  for (const removedSection of ['地理位置', '电力与规格', '自定义属性', '其他信息']) assert.doesNotMatch(infrastructureEditor, new RegExp(removedSection))
  for (const removedField of ['所属数据中心', '机柜名称', '设备高度', '额定功耗', '公网 IP', '服务商', '可用区', '管理账号']) assert.doesNotMatch(infrastructureEditor, new RegExp(removedField))
  assert.match(infrastructureEditor, /归属关系/)
  assert.match(infrastructureEditor, /安装位置/)
  assert.match(infrastructureEditor, /cabinet_name/)
  assert.match(infrastructureEditor, /start_u/)
  assert.doesNotMatch(infrastructureEditor, /归属与位置/)
  assert.match(infrastructure, /api\.customFields/)
  assert.match(infrastructureEditor, /customFieldDefinitions/)
  assert.match(infrastructureEditor, /infrastructureFieldProfile/)
  for (const retainedConfig of ['设备类型', '型号库', '网络类型', '工单配置', '导入模板', '项目设置', '资产配置', '项目与数据']) assert.match(configCenter, new RegExp(retainedConfig))
  for (const removedConfig of ['资产字典', '扩展字段', '软件目录', '凭证中心', '编码与标签']) assert.doesNotMatch(configCenter, new RegExp(removedConfig))
  assert.doesNotMatch(configCenter, /custom-fields|api\.customFields|saveCustomField|deleteCustomField/)
  assert.match(configCenter, /data-section="cmdb-data-maintenance"/)
  assert.match(configCenter, /同步历史台账/)
  assert.match(configCenter, /api\.syncInfrastructure/)
  assert.match(configCenter, /api\.downloadAssetTemplate/)
  assert.match(configCenter, /api\.downloadInfrastructureTemplate/)
  assert.match(configCenter, /api\.downloadIPTemplate/)
  assert.match(configCenter, /api\.config\('network-types'\)/)
  assert.match(configCenter, /initialKind=\{selectedKind\}/)
  assert.doesNotMatch(configCenter, /attachments\/\$\{values\.code/)
  assert.match(terminalAssets, /api\.config\('network-types'\)/)
  assert.match(ipam, /api\.config\('network-types'\)/)
  assert.match(ipam, /AssetTransferMenu/)
  assert.doesNotMatch(ipam, /data-ipam-filter|<Filter|IP 筛选/)
  assert.doesNotMatch(ipam, /<RefreshCw/)
  assert.doesNotMatch(infrastructure, /同步旧台账|api\.syncInfrastructure/)
  assert.match(infrastructure, /label: '品牌 \/ 型号'/)
  assert.match(infrastructure, /label: '操作系统'/)
  assert.match(infrastructure, /data-infrastructure-technical-cell/)
  assert.match(infrastructure, /presentation\.secondary/)
  assert.match(settingsApplication, /appInfo\.version \? "1\.1\.83" : " "/)
  assert.match(infrastructure, /VendorBrandValue[\s\S]{0,180}min-w-0/)
  assert.doesNotMatch(infrastructure, /VendorBrandValue[\s\S]{0,180}className="[^"]*flex-1[^"]*"/)
  assert.doesNotMatch(configCenter, /import Credentials|import Labels|kind === 'software'/)
  assert.doesNotMatch(terminalAssets, /软件安装情况|security_software|config\('software'\)/)
  assert.doesNotMatch(infrastructureEditor, /软件安装情况|security_software/)
  assert.match(terminalAssets, /NetcattyConnectionFields/)
  assert.match(infrastructureEditor, /NetcattyConnectionFields/)
  assert.match(infrastructureEditor, /preserveZero/)
  assert.match(fields, /!field\.preserveZero/)
  assert.match(systems, /NetcattyConnectionFields/)
  assert.match(netcattyConnectionFields, /Netcatty 主机/)
  assert.match(netcattyConnectionFields, /Netcatty 密钥库/)
  for (const removedModelField of ['height_u', 'rated_power_w', 'max_power_w', 'weight_kg', 'depth_mm']) assert.doesNotMatch(configCenter, new RegExp(removedModelField))
  for (const removedDetail of ['数据中心', '楼层', '机柜', '额定功耗', '最大功耗', '电源类型', '省', '市', '区', '地址']) assert.doesNotMatch(infrastructure, new RegExp(`'${removedDetail}'`))
  assert.doesNotMatch(deviceAssetCenter, />搜索<\/Button>/)
  assert.match(infrastructureEditor, /NetworkInterfaces/)
  assert.doesNotMatch(infrastructureEditor, /CredentialPicker/)
  assert.match(ipam, /data-ipam-address-grid/)
  assert.match(ipam, /repeat\(auto-fill,minmax\(42px,1fr\)\)/)
  assert.match(ipam, /h-8 min-w-0/)
  assert.match(ipam, /data-ipam-address-value/)
  assert.match(ipam, /广播地址/)
  assert.match(ipam, /预留 IP/)
  assert.match(ipam, /useState\(96\)/)
  assert.match(workOrders, /data-work-orders-filter/)
  assert.match(workOrders, /aria-label="导出工单"/)
  assert.match(workOrders, /mode === 'stats'/)
  assert.match(workOrders, /batchUpdateWorkOrders/)
  assert.match(workOrders, /selectedOrderIds/)
  assert.match(workOrders, /data-work-order-create-dialog/)
  assert.match(workOrders, /data-work-order-stats/)
  assert.match(workOrders, /completedThisMonth/)
  assert.doesNotMatch(workOrders, /刷新当前页面|<RefreshCw/)
  assert.match(deviceImages, /api\.saveAssetImage/)
  assert.match(terminalAssets, /DeviceImages/)
  assert.match(deviceWorkspace, /DeviceImages/)
  assert.match(cmdbUi, /bg-secondary\/30/)
  assert.match(cmdbUi, /hover:bg-secondary\/60/)
  assert.match(cmdbUi, /border-border\/30/)
  assert.match(cmdbUi, /from '@\/components\/ui\/aside-panel'/)
  assert.match(cmdbUi, /<AsidePanel[\s\S]+layout="overlay"[\s\S]+resizable/)
  assert.match(cmdbUi, /dataSection="cmdb-detail-panel"/)
  assert.doesNotMatch(cmdbUi, /w-\[min\(760px/)
  for (const icon of ['Monitor', 'Users', 'Network', 'ChartNoAxesCombined']) {
    assert.match(surface, new RegExp(`\\b${icon}\\b`))
  }
  for (const key of ['assets', 'people', 'ip', 'operations']) {
    assert.match(workspaceState, new RegExp(`key: '${key}'`))
  }
  assert.doesNotMatch(workspaceState, /key: 'config'/)
  assert.match(settingsPage, /value="cmdb"/)
  assert.match(settingsPage, /LazyCmdbConfigCenter/)
  assert.match(appSideEffects, /netcattyBridge\.get\(\)\?\.onSettingsChanged/)
  assert.doesNotMatch(appSideEffects, /window\.netcatty\?\.onSettingsChanged/)
  assert.match(configCenter, /data-section="cmdb-settings-catalog"/)
  assert.match(configCenter, /section="cmdb-settings-network"/)
  assert.match(configCenter, /data-section="cmdb-settings-work-orders"/)
  assert.match(configCenter, /data-section="cmdb-settings-project"/)
  assert.doesNotMatch(configCenter, /配置项目|const GROUPS =/)
  for (const key of ['search', 'infrastructure', 'systems']) {
    assert.doesNotMatch(workspaceState, new RegExp(`key: '${key}'`))
  }
})

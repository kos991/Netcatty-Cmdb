import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { patchSettingsPageWithCmdb } from './netcatty-update-integration.mjs';
import { CMDB_SETTINGS_HOST_PATCHES, patchSettingsSearchCatalogWithCmdb, patchSettingsSearchWithCmdb, patchSettingsSearchControlWithCmdb, patchSettingsUIWithCmdb } from './netcatty-settings-integration.mjs';

const page = `import { AppWindow, Cloud, FileType, HardDrive, Keyboard, Palette, Puzzle, Sparkles, TerminalSquare, X } from "lucide-react";
const LazySettingsApplicationTab = lazy(() => import("./SettingsApplicationTab"));
                        {pluginRuntimeAvailable && (
                    {mountedTabs.has("appearance") && (
        // Nested tabs (AI / Sync) read \`request\` to switch sub-tabs. Keep it until
className="flex-1 h-full flex flex-col min-h-0 bg-muted/10"
`;

test('existing SettingsPage injection remains unique and defers Cmdb focus until native content mounts', () => {
  const output = patchSettingsPageWithCmdb(page);
  assert.equal(output.split('<LazyCmdbConfigCenter />').length - 1, 1);
  assert.equal(output.split('<TabsTrigger value="cmdb"').length - 1, 1);
  assert.match(output, /if \(request.tab === "cmdb"\) return;/);
  assert.doesNotMatch(output, /SettingsSearchControl/);
  assert.throws(() => patchSettingsPageWithCmdb(output), /锚点/);
});

test('host patch helpers preserve CRLF and reject missing or ambiguous anchors', () => {
  const source = 'export const SETTINGS_TAB_IDS = [\r\n];\r\n  labelKey: string;\r\n];\r\n\r\nexport function settingsAnchorDomId(anchorId: string): string {';
  const output = patchSettingsSearchCatalogWithCmdb(source);
  assert.match(output, /CMDB_SETTINGS_SEARCH_ENTRIES/);
  assert.match(output, /tab: "cmdb"/);
  assert.equal(output.replaceAll('\r\n', '').includes('\n'), false);
  for (const [, patch] of CMDB_SETTINGS_HOST_PATCHES) assert.throws(() => patch(''), /missing or ambiguous/);
  assert.throws(() => patchSettingsSearchCatalogWithCmdb(source + source), /ambiguous/);
});

test('native search uses explicit Cmdb labels and keeps keyboard handling in the host', () => {
  const source = `const TAB_LABEL_KEYS: Record<SettingsTabId, string> = {
  const value = t(entry.labelKey);
    tabLabel: tabLabelRaw && tabLabelRaw !== tabLabelKey ? tabLabelRaw : entry.tab,`;
  const output = patchSettingsSearchWithCmdb(source);
  assert.match(output, /if \(entry.label\) return entry.label/);
  assert.match(output, /entry.tab === "cmdb" \? "Cmdb"/);
  assert.match(patchSettingsSearchControlWithCmdb('      if (event.key === "Escape") {\n        event.preventDefault();'), /event.stopPropagation\(\)/);
  assert.match(patchSettingsUIWithCmdb('<div className={cn("text-xs text-muted-foreground", label && "mt-0.5")}>{description}</div>'), /title=\{description\}/);
});

test('native settings retain drafts and use real project and maintenance APIs', () => {
  const load = (name) => readFileSync(new URL(`../integrations/netcatty/cmdb/${name}`, import.meta.url), 'utf8');
  const center = load('ConfigCenter.jsx');
  assert.match(center, /value="cmdb" forceMount/);
  assert.match(center, /value=\{key\} forceMount data-settings-scroll-pane/);
  assert.match(center, /useOptionalSettingsFocus/);
  assert.match(center, /api.currentProject/);
  assert.doesNotMatch(center, /api.projects/);
  const sync = load('SettingsSyncMaintenance.jsx');
  assert.match(sync, /api.syncInfrastructure\(\)/);
  assert.match(sync, /不提供逐项预检或待迁入数量/);
  assert.doesNotMatch(sync, /includeContacts|includeHistory|立即同步|同步状态/);
  const storage = load('SettingsProjectStorage.jsx');
  for (const method of ['preflightAttachmentStorage', 'migrateAttachmentStorage', 'restoreDefaultAttachmentStorage']) assert.match(storage, new RegExp(`api.${method}`));
  assert.match(storage, /migrationResult.migrated_files/);
});

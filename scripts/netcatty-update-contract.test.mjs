import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { patchUpdateConsumers } from './netcatty-update-integration.mjs';
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('renderer never triggers desktop download or install of upstream packages', () => {
  const service = read('../integrations/netcatty/update/updateService.ts');
  const hook = read('../integrations/netcatty/update/useUpdateCheck.ts');
  assert.doesNotMatch(service + hook, /api\.github\.com|fetch\(|compareVersions|getDownloadUrlForPlatform|debug\.updateDemo|localeCompare/);
  assert.match(service, /await bridge\.checkForUpdate\(\)/);
  assert.doesNotMatch(hook, /downloadUpdate|installUpdate\?\.\(/);
});

test('desktop bridge only checks upstream and blocks download/install', () => {
  const bridge = read('../integrations/netcatty/electron/autoUpdateBridge.cjs');
  assert.match(bridge, /available: result\.isUpdateAvailable/);
  assert.match(bridge, /if \(_checkPromise\) return _checkPromise/);
  assert.match(bridge, /autoUpdater\.autoDownload = false/);
  assert.doesNotMatch(bridge, /quitAndInstall\(|downloadUpdate\(/);
});

test('startup effects drop dismissUpdate and application errors cannot become success', () => {
  const sideEffects = patchUpdateConsumers('AppSideEffects.tsx', 'const { updateState, dismissUpdate, installUpdate } = useUpdateCheck();\n    dismissUpdate,\n');
  assert.doesNotMatch(sideEffects, /dismissUpdate/);
  const application = patchUpdateConsumers('SettingsApplicationTab.tsx', '    if (result?.hasUpdate && result.latestRelease) {');
  assert.match(application, /if \(result\?\.error\)/);
});

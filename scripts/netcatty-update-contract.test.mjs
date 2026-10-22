import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { patchUpdateConsumers } from './netcatty-update-integration.mjs';
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('renderer delegates availability and installer choice to the desktop updater', () => {
  const service = read('../integrations/netcatty/update/updateService.ts');
  const hook = read('../integrations/netcatty/update/useUpdateCheck.ts');
  assert.doesNotMatch(service + hook, /api\.github\.com|fetch\(|compareVersions|getDownloadUrlForPlatform|debug\.updateDemo|localeCompare/);
  assert.match(service, /await bridge\.checkForUpdate\(\)/);
  assert.match(hook, /if \(result\.error\) throw new Error\(result\.error\)/);
  assert.match(hook, /if \(!download\.success\) throw new Error/);
});

test('desktop keeps updater availability, shares checks and reports inaccessible metadata', () => {
  const bridge = read('../integrations/netcatty/electron/autoUpdateBridge.cjs');
  assert.match(bridge, /available: result\.isUpdateAvailable/);
  assert.match(bridge, /if \(_checkPromise\) return _checkPromise/);
  assert.match(bridge, /不能据此判断已是最新版/);
  assert.match(bridge, /await _downloadPromise/);
});

test('startup action receives download callback and application errors cannot become success', () => {
  const sideEffects = patchUpdateConsumers('AppSideEffects.tsx', 'const { updateState, dismissUpdate, installUpdate } = useUpdateCheck();\n    dismissUpdate,\n');
  assert.match(sideEffects, /installUpdate, startDownload/);
  assert.match(sideEffects, /\n    startDownload,/);
  assert.doesNotMatch(sideEffects, /dismissUpdate/);
  const application = patchUpdateConsumers('SettingsApplicationTab.tsx', '    if (result?.hasUpdate && result.latestRelease) {');
  assert.match(application, /if \(result\?\.error\)/);
});

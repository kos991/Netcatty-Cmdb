import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  patchSettingsApplicationTab,
  patchSettingsSystemTab,
  patchStartupUpdateAction,
  patchUpdateRepositoryConfig,
} from "./netcatty-update-integration.mjs";

test("Cmdb 设置内容使用 Radix TabContent，切换其他设置时不会常驻覆盖", () => {
  const source = readFileSync(new URL("../integrations/netcatty/cmdb/ConfigCenter.jsx", import.meta.url), "utf8");
  assert.match(source, /<TabsContent value="cmdb"/);
});

test("将 Netcatty 更新源指向 Cmdb 仓库", () => {
  const source = `
const GITHUB_API_URL = 'https://api.github.com/repos/binaricat/Netcatty/releases/latest';
const RELEASES_PAGE_URL = 'https://github.com/binaricat/Netcatty/releases';
publish: [{ provider: 'github', owner: 'binaricat', repo: 'Netcatty' }]
`;

  const result = patchUpdateRepositoryConfig(source);

  assert.match(result, /kos991\/Netcatty-Cmdb/);
  assert.doesNotMatch(result, /binaricat\/Netcatty/);
});

test("装配脚本使用更新源补丁", () => {
  const prepare = readFileSync(new URL("./prepare-netcatty.mjs", import.meta.url), "utf8");
  assert.match(prepare, /patchUpdateRepositoryConfig/);
});

test("应用页显示锁定的 Netcatty 版本而不是 Cmdb 集成包版本", () => {
  const source = `
const REPO_URL = "https://github.com/binaricat/Netcatty";
<span>{appInfo.version ? appInfo.version : " "}</span>
`;

  const result = patchSettingsApplicationTab(source, "1.1.83");

  assert.match(result, /appInfo\.version \? "1\.1\.83" : " "/);
  assert.doesNotMatch(result, /appInfo\.version \? appInfo\.version : " "/);
});

test("更新页面包含版本、发布日期、说明和升级按钮", () => {
  const source = `
<SectionHeader title={t('settings.update.title')} anchorId="system-update" />
旧更新区块
<SectionHeader title={t("settings.autoLaunch.title")} />
`;
  const result = patchSettingsSystemTab(source);
  assert.match(result, /settings\.update\.latestVersion/);
  assert.match(result, /settings\.update\.releaseDate/);
  assert.match(result, /settings\.update\.releaseNotes/);
  assert.match(result, /settings\.update\.upgradeTo/);
});

test("启动通知直接提供升级操作", () => {
  const source = `
    hasRuntimeTunnel, installUpdate, isVaultInitialized, keys, knownHosts, openSettingsWindow, portForwardingRules, proxyProfiles, sessions, setKeyboardInteractiveQueue,
      toast.info(
        t('update.available.message', { version }),
        {
          title: t('update.available.title'),
          duration: 8000, // Show longer for update notifications
          onClick: () => {
            void openSettingsWindow();
            dismissUpdate();
          },
          actionLabel: t('update.viewInSettings'),
        }
      );
`;
  const result = patchStartupUpdateAction(source);
  assert.match(result, /startDownload/);
  assert.match(result, /update\.upgradeTo/);
});

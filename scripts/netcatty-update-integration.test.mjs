import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  patchSettingsApplicationTab,
  patchSettingsSystemTab,
  patchStartupUpdateAction,
} from "./netcatty-update-integration.mjs";

test("Cmdb 设置内容使用 Radix TabContent，切换其他设置时不会常驻覆盖", () => {
  const source = readFileSync(new URL("../integrations/netcatty/cmdb/ConfigCenter.jsx", import.meta.url), "utf8");
  assert.match(source, /<TabsContent value="cmdb"/);
});

test("Cmdb 设置页复用原生面板并保留五个独立配置分区", () => {
  const source = readFileSync(new URL("../integrations/netcatty/cmdb/ConfigCenter.jsx", import.meta.url), "utf8");

  assert.match(source, /from '@\/components\/settings\/settings-ui'/);
  for (const component of ['SettingsSection', 'SettingCard', 'SettingRow']) {
    assert.match(source, new RegExp(`<${component}\\b`));
  }
  for (const tab of ['资产目录', '工单配置', '导入模板', '项目存储', '同步维护']) {
    assert.match(source, new RegExp(`'${tab}'`));
  }
  assert.doesNotMatch(source, /VaultPageHeader/);
  assert.match(source, /api\.currentProject/);
  assert.doesNotMatch(source, /list\?\.\[0\]\?\.name/);
  assert.match(source, /value="cmdb" forceMount/);
  assert.match(source, /data-\[state=inactive\]:hidden/);
});

test("装配器不改写上游更新源，宿主只检查上游官方发布", () => {
  const prepare = readFileSync(new URL("./prepare-netcatty.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(prepare, /patchUpdateRepositoryConfig|Netcatty-Cmdb\/releases/);
});

test("应用页去掉下载/重启徽章，只显示上游新版本号", () => {
  const source = `
                {/* Update badge - reflects auto-download state */}
                {updateState.latestRelease && (updateState.hasUpdate) && (
                  <button
                    onClick={() => startDownload()}
                    className={cn(
                      "a",
                    )}
                  >
                    download
                  </button>
                )}
<span>{appInfo.version ? appInfo.version : " "}</span>
`;
  const result = patchSettingsApplicationTab(source);
  assert.doesNotMatch(result, /startDownload|installUpdate/);
  assert.match(result, /settings\.update\.integratedNotice/);
  assert.match(result, /appInfo\.version \? appInfo\.version : " "/);
});

test("系统页只保留检查更新，没有下载、重启或前往下载入口", () => {
  const source = `
<SectionHeader title={t('settings.update.title')} anchorId="system-update" />
旧更新区块
<SectionHeader title={t("settings.autoLaunch.title")} />
`;
  const result = patchSettingsSystemTab(source);
  assert.match(result, /settings\.update\.checkForUpdates/);
  assert.match(result, /settings\.update\.integratedNotice/);
  assert.doesNotMatch(result, /startDownload|installUpdate|openReleasePage|restartNow|upgradeTo/);
});

test("启动通知只提示并打开设置，不提供下载", () => {
  const source = `
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
  }, [enabled, updateState.hasUpdate, updateState.latestRelease, updateState.autoDownloadStatus, t, openSettingsWindow, dismissUpdate]);
`;
  const result = patchStartupUpdateAction(source);
  assert.match(result, /openSettingsWindow/);
  assert.doesNotMatch(result, /startDownload|dismissUpdate/);
});

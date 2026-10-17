const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const http = require('node:http');
const { AttachmentSyncScheduler } = require('./attachment_sync');

let cmdbServerProcess = null;
let attachmentSyncScheduler = null;

/**
 * 探活检查 CMDB 服务端口
 */
function checkServerHealth(port, timeout = 1000) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/api/meta`, (res) => {
      resolve(res.statusCode >= 200 && res.statusCode < 400);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(timeout, () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * 根据操作系统与 CPU 架构自动选择二进制名称
 */
function resolveBinaryName() {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === 'win32') {
    return 'cmdb-server.exe';
  }
  if (platform === 'linux') {
    return arch === 'arm64' ? 'cmdb-server-linux-arm64' : 'cmdb-server-linux-amd64';
  }
  if (platform === 'darwin') {
    return arch === 'arm64' ? 'cmdb-server-darwin-arm64' : 'cmdb-server-darwin-amd64';
  }
  return 'cmdb-server';
}

/**
 * 确保 CMDB 后端服务在后台稳定运行（全平台支持）
 */
async function ensureCmdbServer(port = 8080) {
  const isHealthy = await checkServerHealth(port, 500);
  if (isHealthy) {
    console.log(`[Netcatty-CMDB] CMDB 服务已在端口 ${port} 正常运行`);
    return;
  }

  if (cmdbServerProcess) return;

  const binName = resolveBinaryName();
  const candidatePaths = [
    path.join(__dirname, 'backend', binName),
    path.join(__dirname, binName),
    path.join(__dirname, '..', '..', 'build', binName),
    path.join(__dirname, '..', '..', binName),
  ];

  const binPath = candidatePaths.find((p) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  }) || candidatePaths[0];

  // 在 Linux / macOS 环境下确保可执行权限
  if (process.platform !== 'win32' && fs.existsSync(binPath)) {
    try {
      fs.chmodSync(binPath, 0o755);
    } catch (e) {
      console.warn(`[Netcatty-CMDB] 赋予可执行权限失败: ${e.message}`);
    }
  }

  try {
    cmdbServerProcess = spawn(binPath, ['-port', String(port), '-no-browser'], {
      detached: true,
      stdio: 'ignore',
    });
    cmdbServerProcess.unref();
    console.log(`[Netcatty-CMDB] 伴随启动 CMDB 后端 (${process.platform}-${process.arch}): ${binPath}`);
  } catch (err) {
    console.warn(`[Netcatty-CMDB] 伴随启动失败: ${err.message}`);
  }
}

/**
 * Netcatty 插件激活入口
 */
function activate(context) {
  console.log('[Netcatty-CMDB] 正在激活 CMDB 独立插件扩展...');
  const port = 8080;
  void ensureCmdbServer(port);

  // 初始化附件云同步调度器（复用 Netcatty 宿主活跃 S3）
  if (context && context.electron) {
    attachmentSyncScheduler = new AttachmentSyncScheduler({
      ipc: context.electron.ipcRenderer || null,
      getS3Config: () => {
        // 从 Netcatty 配置上下文获取宿主 S3 配置
        return context.cloudSync?.getS3Config ? context.cloudSync.getS3Config() : null;
      },
      port,
      syncIntervalMs: 60000,
    });
    attachmentSyncScheduler.start();
  }

  if (context && context.subscriptions) {
    context.subscriptions.push({
      dispose: () => {
        deactivate();
      },
    });
  }
}

/**
 * Netcatty 插件反激活（宿主关闭或插件卸载）
 */
function deactivate() {
  if (attachmentSyncScheduler) {
    attachmentSyncScheduler.stop();
    attachmentSyncScheduler = null;
  }
  if (cmdbServerProcess) {
    try {
      cmdbServerProcess.kill();
      cmdbServerProcess = null;
    } catch (e) {
      console.warn('[Netcatty-CMDB] 终止进程失败:', e.message);
    }
  }
}

module.exports = {
  activate,
  deactivate,
  ensureCmdbServer,
  resolveBinaryName,
};

// Netcatty CMDB 原生集成加载脚本 (方案 1: 内嵌 CMDB 资产主面板)
const path = require('node:path');
const { spawn } = require('node:child_process');

let cmdbServerProcess = null;

/**
 * 确保 CMDB 服务在后台监听
 */
function ensureCmdbServer(port = 8080) {
  if (cmdbServerProcess) return;
  const isWin = process.platform === 'win32';
  const binName = isWin ? 'cmdb-server.exe' : 'cmdb-server';
  const binPath = path.join(__dirname, '..', binName);

  try {
    cmdbServerProcess = spawn(binPath, ['-port', String(port), '-no-browser'], {
      detached: true,
      stdio: 'ignore'
    });
    cmdbServerProcess.unref();
    console.log(`[Netcatty-CMDB] CMDB 服务已在端口 ${port} 启动`);
  } catch (err) {
    console.warn(`[Netcatty-CMDB] 启动后端服务提示: ${err.message}`);
  }
}

/**
 * Netcatty 插件激活生命周期
 */
function activate(context) {
  console.log('[Netcatty-CMDB] 正在激活 CMDB 资产与补丁扩展...');
  const port = 8080;
  ensureCmdbServer(port);

  // 注册命令
  if (context && context.subscriptions) {
    context.subscriptions.push({
      dispose: () => {
        if (cmdbServerProcess) {
          try { cmdbServerProcess.kill(); } catch (e) {}
        }
      }
    });
  }
}

function deactivate() {
  if (cmdbServerProcess) {
    try { cmdbServerProcess.kill(); } catch (e) {}
  }
}

module.exports = {
  activate,
  deactivate
};

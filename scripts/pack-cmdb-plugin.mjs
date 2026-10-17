import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const pythonScript = path.join(rootDir, 'tools', 'pack_cmdb_plugin.py');

console.log('[Pack] 正在打包 CMDB 独立插件为标准 .ncpkg 扩展包...');
const result = spawnSync('python', [pythonScript], {
  cwd: rootDir,
  stdio: 'inherit',
  shell: true,
});

if (result.status !== 0) {
  console.error('[Pack] 打包失败');
  process.exit(result.status ?? 1);
} else {
  console.log('[Pack] 打包完成！输出位置: build/netcatty-cmdb-1.3.1.ncpkg');
}

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
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

test('固定宿主源码装配后，业务入口、设置和同步模块实际可编译', async (t) => {
  if (!existsSync(join(pinnedSource, '.git'))) {
    t.skip(`未找到锁定的 Netcatty 测试源: ${pinnedSource}`)
    return
  }
  assert.equal(git(['rev-parse', 'HEAD']), upstream.commit)
  const { build } = createRequire(join(pinnedSource, 'package.json'))('esbuild')
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'netcatty-cmdb-prepare-'))
  const fixture = join(fixtureRoot, 'netcatty')
  let added = false
  try {
    git(['worktree', 'add', '--detach', fixture, upstream.commit])
    added = true
    execFileSync(process.execPath, [join(repositoryRoot, 'scripts', 'prepare-netcatty.mjs'), '--target', fixture], {
      cwd: repositoryRoot, encoding: 'utf8', stdio: 'pipe',
    })
    await build({
      absWorkingDir: fixture,
      entryPoints: ['components/cmdb/CmdbSurface.tsx', 'components/SettingsPage.tsx', 'application/app/AppSideEffects.tsx'],
      outdir: join(fixtureRoot, 'compiled'),
      bundle: true,
      write: false,
      packages: 'external',
      platform: 'browser',
      loader: { '.png': 'dataurl', '.jpg': 'dataurl', '.jpeg': 'dataurl', '.gif': 'dataurl', '.webp': 'dataurl', '.svg': 'dataurl', '.woff': 'file', '.woff2': 'file', '.ttf': 'file', '.wasm': 'file', '.css': 'empty' },
      logLevel: 'silent',
    })
  } finally {
    if (added) git(['worktree', 'remove', '--force', fixture])
    rmSync(fixtureRoot, { recursive: true, force: true })
  }
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { CMDB_RELEASES_URL, cmdbVersionPresentation } from './cmdbVersionModel.js'

test('真实发布 tag 统一显示为 v 前缀并链接到对应发布页', () => {
  assert.deepEqual(cmdbVersionPresentation('v1.3.1'), { kind: 'release', label: 'v1.3.1', title: 'Cmdb 发布版本 v1.3.1，点击查看发布说明', url: `${CMDB_RELEASES_URL}/tag/v1.3.1` })
  assert.equal(cmdbVersionPresentation('1.3.1').label, 'v1.3.1')
})

test('开发构建与未读取版本不编造版本号', () => {
  const dev = cmdbVersionPresentation('dev')
  assert.equal(dev.kind, 'development')
  assert.equal(dev.label, '开发构建')
  assert.doesNotMatch(dev.label, /\d/)
  assert.equal(dev.url, CMDB_RELEASES_URL)
  assert.equal(cmdbVersionPresentation('').kind, 'unknown')
  assert.equal(cmdbVersionPresentation(undefined).label, '版本未读取')
})

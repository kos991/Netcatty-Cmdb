import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildAttachmentMigrationSummary,
  buildAttachmentStorageSummary,
  formatAttachmentBytes,
} from './attachmentStorageModel.js'

test('builds a migration confirmation from backend status', () => {
  assert.deepEqual(buildAttachmentMigrationSummary({
    source_root: 'C:/old',
    target_root: 'D:/new',
    file_count: 3,
    size_bytes: 2048,
  }), {
    source: 'C:/old',
    target: 'D:/new',
    countLabel: '3 个文件',
    sizeLabel: '2 KiB',
  })
})

test('formats attachment storage state without inventing a path', () => {
  assert.deepEqual(buildAttachmentStorageSummary({
    effective_root: 'D:/cmdb/project-1',
    uses_default: false,
    writable: true,
    file_count: 1,
    size_bytes: 1536,
  }), {
    path: 'D:/cmdb/project-1',
    modeLabel: '自定义目录',
    writableLabel: '可写',
    countLabel: '1 个文件',
    sizeLabel: '1.5 KiB',
  })
  assert.equal(buildAttachmentStorageSummary(null).path, '')
})

test('formats zero and large attachment sizes consistently', () => {
  assert.equal(formatAttachmentBytes(0), '0 B')
  assert.equal(formatAttachmentBytes(5 * 1024 * 1024), '5 MiB')
})

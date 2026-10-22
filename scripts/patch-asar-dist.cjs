// Replace the top-level dist/ subtree inside an existing app.asar while keeping
// every other entry byte-for-byte (node_modules, unpacked flags, offsets).
// Usage: node scripts/patch-asar-dist.cjs <src.asar> <new-dist-dir> <out.asar>
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const [SRC_ASAR, NEW_DIST, OUT_ASAR] = process.argv.slice(2)
if (!SRC_ASAR || !NEW_DIST || !OUT_ASAR) {
  console.error('usage: node scripts/patch-asar-dist.cjs <src.asar> <new-dist-dir> <out.asar>')
  process.exit(2)
}

const BLOCK = 4 * 1024 * 1024

function integrityOf(buffer) {
  const blocks = []
  for (let offset = 0; offset < buffer.length; offset += BLOCK) {
    blocks.push(crypto.createHash('sha256').update(buffer.subarray(offset, Math.min(offset + BLOCK, buffer.length))).digest('hex'))
  }
  if (buffer.length === 0) blocks.push(crypto.createHash('sha256').update(buffer).digest('hex'))
  return { algorithm: 'SHA256', hash: crypto.createHash('sha256').update(buffer).digest('hex'), blockSize: BLOCK, blocks }
}

function buildDistTree(root) {
  const node = { files: {} }
  for (const entry of fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(root, entry.name)
    if (entry.isDirectory()) node.files[entry.name] = buildDistTree(full)
    else if (entry.isFile()) node.files[entry.name] = { __src: full }
  }
  return node
}

const source = fs.readFileSync(SRC_ASAR)
const headerPickleSize = source.readUInt32LE(4)
const stringLength = source.readUInt32LE(12)
const header = JSON.parse(source.subarray(16, 16 + stringLength).toString('utf8'))
const dataStart = 8 + headerPickleSize

if (!header.files || !header.files.dist) throw new Error('asar has no dist subtree')

const originalDist = header.files.dist
const newDistTree = buildDistTree(NEW_DIST)

function carryUnpacked(target, priorNode) {
  for (const key of Object.keys(target.files)) {
    const next = target.files[key]
    const prior = priorNode && priorNode.files ? priorNode.files[key] : undefined
    if (prior && prior.unpacked) next.unpacked = true
    if (next.files && prior) carryUnpacked(next, prior)
  }
}
carryUnpacked(newDistTree, originalDist)
header.files.dist = newDistTree

let cursor = 0
const ordered = []
function assign(files) {
  for (const key of Object.keys(files)) {
    const child = files[key]
    if (child.files) { assign(child.files); continue }
    if (child.__src) {
      const buffer = fs.readFileSync(child.__src)
      child.size = buffer.length
      delete child.__src
      child.integrity = integrityOf(buffer)
      ordered.push({ node: child, buffer, originalOffset: null })
    } else {
      ordered.push({ node: child, buffer: null, originalOffset: Number(child.offset) })
    }
    if (!child.unpacked) { child.offset = String(cursor); cursor += child.size }
  }
}
assign(header.files)

const headerJson = Buffer.from(JSON.stringify(header), 'utf8')
const paddedJson = Buffer.concat([headerJson, Buffer.alloc((4 - (headerJson.length % 4)) % 4)])
const payload = Buffer.alloc(4 + paddedJson.length)
payload.writeUInt32LE(headerJson.length, 0)
paddedJson.copy(payload, 4)
const headerPickle = Buffer.alloc(4 + payload.length)
headerPickle.writeUInt32LE(payload.length, 0)
payload.copy(headerPickle, 4)
const sizePickle = Buffer.alloc(8)
sizePickle.writeUInt32LE(4, 0)
sizePickle.writeUInt32LE(headerPickle.length, 4)

const fd = fs.openSync(OUT_ASAR, 'w')
try {
  fs.writeSync(fd, sizePickle)
  fs.writeSync(fd, headerPickle)
  for (const entry of ordered) {
    if (entry.node.unpacked) continue
    const buffer = entry.buffer || source.subarray(dataStart + entry.originalOffset, dataStart + entry.originalOffset + entry.node.size)
    fs.writeSync(fd, buffer)
  }
} finally {
  fs.closeSync(fd)
}

console.log(JSON.stringify({ out: OUT_ASAR, packedBytes: cursor, files: ordered.length }, null, 2))

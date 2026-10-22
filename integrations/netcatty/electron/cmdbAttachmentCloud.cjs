"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");
const { Readable } = require("node:stream");

const MAGIC = Buffer.from("NCATTTY-CMDB-ATTACH\0", "utf8");
const FORMAT_VERSION = 1;
const AUTH_TAG_BYTES = 16;
const DATA_IV_BYTES = 12;
const CONTENT_KEY_BYTES = 32;

function resolveAttachmentObjectKey(config, subKey) {
  const prefix = String(config?.prefix || "").trim().replace(/^\/+|\/+$/g, "");
  const clean = String(subKey || "").trim().replace(/^\/+/, "");
  if (!clean || clean.includes("\\") || clean.split("/").includes("..")) {
    throw new Error("附件对象键无效");
  }
  return prefix ? `${prefix}/${clean}` : clean;
}

function decodeBytes(value, name, expectedLength) {
  if (typeof value !== "string") throw new Error(`${name} 必须是 Base64 字符串`);
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== expectedLength) throw new Error(`${name} 长度无效`);
  return decoded;
}

function assertAbsoluteFile(filePath, label) {
  if (typeof filePath !== "string" || !path.isAbsolute(filePath)) {
    throw new Error(`${label}必须是绝对路径`);
  }
  return filePath;
}

async function encryptAttachmentFile({ sourcePath, targetPath, contentKey, dataIv }) {
  assertAbsoluteFile(sourcePath, "附件源路径");
  assertAbsoluteFile(targetPath, "附件临时路径");
  if (!Buffer.isBuffer(contentKey) || contentKey.length !== CONTENT_KEY_BYTES) throw new Error("附件内容密钥长度无效");
  if (!Buffer.isBuffer(dataIv) || dataIv.length !== DATA_IV_BYTES) throw new Error("附件数据 IV 长度无效");
  await fsp.mkdir(path.dirname(targetPath), { recursive: true, mode: 0o700 });
  const cipher = crypto.createCipheriv("aes-256-gcm", contentKey, dataIv);
  const output = fs.createWriteStream(targetPath, { mode: 0o600 });
  output.write(MAGIC);
  output.write(Buffer.from([FORMAT_VERSION]));
  try {
    await pipeline(fs.createReadStream(sourcePath), cipher, output);
    await fsp.appendFile(targetPath, cipher.getAuthTag());
  } catch (error) {
    await fsp.rm(targetPath, { force: true });
    throw error;
  }
  return (await fsp.stat(targetPath)).size;
}

async function decryptAttachmentFile({ sourcePath, targetPath, contentKey, dataIv }) {
  assertAbsoluteFile(sourcePath, "密文源路径");
  assertAbsoluteFile(targetPath, "附件临时路径");
  if (!Buffer.isBuffer(contentKey) || contentKey.length !== CONTENT_KEY_BYTES) throw new Error("附件内容密钥长度无效");
  if (!Buffer.isBuffer(dataIv) || dataIv.length !== DATA_IV_BYTES) throw new Error("附件数据 IV 长度无效");
  const stat = await fsp.stat(sourcePath);
  const bodyStart = MAGIC.length + 1;
  if (stat.size <= bodyStart + AUTH_TAG_BYTES) throw new Error("附件密文格式无效");
  const header = Buffer.alloc(bodyStart);
  const handle = await fsp.open(sourcePath, "r");
  try {
    await handle.read(header, 0, header.length, 0);
    const tag = Buffer.alloc(AUTH_TAG_BYTES);
    await handle.read(tag, 0, tag.length, stat.size - AUTH_TAG_BYTES);
    if (!header.subarray(0, MAGIC.length).equals(MAGIC) || header[MAGIC.length] !== FORMAT_VERSION) {
      throw new Error("附件密文格式版本不支持");
    }
    const decipher = crypto.createDecipheriv("aes-256-gcm", contentKey, dataIv);
    decipher.setAuthTag(tag);
    await fsp.mkdir(path.dirname(targetPath), { recursive: true, mode: 0o700 });
    const output = fs.createWriteStream(targetPath, { mode: 0o600 });
    try {
      await pipeline(fs.createReadStream(sourcePath, { start: bodyStart, end: stat.size - AUTH_TAG_BYTES - 1 }), decipher, output);
    } catch (error) {
      await fsp.rm(targetPath, { force: true });
      throw new Error(`附件密文校验失败: ${error.message}`);
    }
  } finally {
    await handle.close();
  }
  return (await fsp.stat(targetPath)).size;
}

function asNodeReadable(body) {
  if (body && typeof body.pipe === "function") return body;
  if (body && typeof Readable.fromWeb === "function" && typeof body.getReader === "function") return Readable.fromWeb(body);
  if (body instanceof Uint8Array || Buffer.isBuffer(body)) return Readable.from([body]);
  throw new Error("对象存储返回的附件流不可用");
}

function createAttachmentCloudHandlers({
  buildS3Client,
  HeadObjectCommand,
  PutObjectCommand,
  GetObjectCommand,
  tempRoot = path.join(os.tmpdir(), "netcatty-cmdb-attachments"),
  resolvePendingAttachment,
  createTempTarget,
  localizeAttachment,
} = {}) {
  if (typeof buildS3Client !== "function" || !HeadObjectCommand || !PutObjectCommand || !GetObjectCommand) {
    throw new TypeError("附件云桥接缺少 S3 依赖");
  }
  const upload = async (payload = {}) => {
    const config = payload.config;
    const key = resolveAttachmentObjectKey(config, payload.subKey);
    const pending = typeof resolvePendingAttachment === "function"
      ? await resolvePendingAttachment(payload)
      : null;
    if (pending?.local_exists === false) throw new Error("待同步附件在本机不存在");
    const sourcePath = assertAbsoluteFile(pending?.local_path || payload.localFilePath, "附件源路径");
    const contentKey = decodeBytes(payload.contentKey, "附件内容密钥", CONTENT_KEY_BYTES);
    const dataIv = decodeBytes(payload.dataIv, "附件数据 IV", DATA_IV_BYTES);
    const encryptedPath = path.join(tempRoot, `${crypto.randomUUID()}.nca`);
    try {
      const encryptedSize = await encryptAttachmentFile({ sourcePath, targetPath: encryptedPath, contentKey, dataIv });
      const client = await buildS3Client(config);
      await client.send(new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        Body: fs.createReadStream(encryptedPath),
        ContentLength: encryptedSize,
        ContentType: "application/octet-stream",
      }));
      return { ok: true, key, encryptedSizeBytes: encryptedSize };
    } finally {
      contentKey.fill(0);
      await fsp.rm(encryptedPath, { force: true });
    }
  };
  const download = async (payload = {}) => {
    const config = payload.config;
    const key = resolveAttachmentObjectKey(config, payload.subKey);
    const contentKey = decodeBytes(payload.contentKey, "附件内容密钥", CONTENT_KEY_BYTES);
    const dataIv = decodeBytes(payload.dataIv, "附件数据 IV", DATA_IV_BYTES);
    await fsp.mkdir(tempRoot, { recursive: true, mode: 0o700 });
    const encryptedPath = path.join(tempRoot, `${crypto.randomUUID()}.nca`);
    const target = typeof createTempTarget === "function" ? await createTempTarget(payload) : null;
    const plainPath = target?.path || path.join(tempRoot, `${crypto.randomUUID()}.plain`);
    try {
      const client = await buildS3Client(config);
      const response = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
      await pipeline(asNodeReadable(response.Body), fs.createWriteStream(encryptedPath, { mode: 0o600 }));
      const sizeBytes = await decryptAttachmentFile({ sourcePath: encryptedPath, targetPath: plainPath, contentKey, dataIv });
      if (target && typeof localizeAttachment === "function") {
        const attachment = await localizeAttachment(payload, target.token);
        return { ok: true, key, sizeBytes, attachment };
      }
      return { ok: true, key, tempFilePath: plainPath, sizeBytes };
    } catch (error) {
      await fsp.rm(plainPath, { force: true });
      throw error;
    } finally {
      contentKey.fill(0);
      await fsp.rm(encryptedPath, { force: true });
    }
  };
  const head = async (payload = {}) => {
    const config = payload.config;
    const key = resolveAttachmentObjectKey(config, payload.subKey);
    const client = await buildS3Client(config);
    try {
      const response = await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
      return { exists: true, key, sizeBytes: response.ContentLength || 0 };
    } catch (error) {
      if (error?.$metadata?.httpStatusCode === 404 || error?.name === "NotFound") return { exists: false, key };
      throw error;
    }
  };
  return { upload, download, head };
}

function requirePositiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error(`${name}无效`);
  return number;
}

function projectHeaders(projectId, json = false) {
  const headers = { "X-Cmdb-Project": String(requirePositiveInteger(projectId, "项目 ID")) };
  if (json) headers["Content-Type"] = "application/json";
  return headers;
}

function registerCmdbAttachmentCloud({ ipcMain, buildS3Client, commands, tempRoot, requestCmdb, getService } = {}) {
  if (!ipcMain || typeof ipcMain.handle !== "function") throw new TypeError("附件云桥接需要 ipcMain.handle");
  if (typeof requestCmdb !== "function" || typeof getService !== "function") {
    throw new TypeError("附件云桥接需要受控 Cmdb API");
  }
  const resolvedCommands = commands || require("@aws-sdk/client-s3");
  const callCmdb = (payload, request) => requestCmdb({
    service: getService(),
    ...request,
    headers: { ...projectHeaders(payload.projectId, request.body !== undefined), ...request.headers },
  });
  const handlers = createAttachmentCloudHandlers({
    buildS3Client,
    ...resolvedCommands,
    tempRoot,
    resolvePendingAttachment: async (payload) => {
      const attachmentId = requirePositiveInteger(payload.attachmentId, "附件 ID");
      const response = await callCmdb(payload, { path: "/api/cmdb/attachments/pending" });
      const attachment = response?.list?.find((item) => Number(item.id) === attachmentId);
      if (!attachment) throw new Error("附件不在当前项目待补传列表中");
      return attachment;
    },
    createTempTarget: (payload) => callCmdb(payload, {
      path: "/api/cmdb/attachments/temp-target",
      method: "POST",
    }),
    localizeAttachment: (payload, tempToken) => callCmdb(payload, {
      path: `/api/cmdb/work-orders/${requirePositiveInteger(payload.workOrderId, "工单 ID")}/attachments/${requirePositiveInteger(payload.attachmentId, "附件 ID")}/localize`,
      method: "PUT",
      body: JSON.stringify({ temp_token: tempToken }),
    }),
  });
  ipcMain.handle("netcatty:cmdb:sync-attachments", async (_event, payload) => handlers.upload(payload));
  ipcMain.handle("netcatty:cmdb:download-attachment", async (_event, payload) => handlers.download(payload));
  return handlers;
}

module.exports = {
  MAGIC,
  resolveAttachmentObjectKey,
  encryptAttachmentFile,
  decryptAttachmentFile,
  createAttachmentCloudHandlers,
  registerCmdbAttachmentCloud,
};

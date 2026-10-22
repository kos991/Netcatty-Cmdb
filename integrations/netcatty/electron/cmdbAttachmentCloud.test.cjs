"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  MAGIC,
  createAttachmentCloudHandlers,
  decryptAttachmentFile,
  encryptAttachmentFile,
  resolveAttachmentObjectKey,
} = require("./cmdbAttachmentCloud.cjs");

class HeadObjectCommand { constructor(input) { this.input = input; } }
class PutObjectCommand { constructor(input) { this.input = input; } }
class GetObjectCommand { constructor(input) { this.input = input; } }

test("resolves attachment object keys without allowing path traversal", () => {
  assert.equal(resolveAttachmentObjectKey({ prefix: "court/" }, "/attachments/a.bin"), "court/attachments/a.bin");
  assert.throws(() => resolveAttachmentObjectKey({}, "../secret"), /对象键无效/);
  assert.throws(() => resolveAttachmentObjectKey({}, "attachments\\secret"), /对象键无效/);
});

test("encrypts and decrypts attachment files with authenticated AES-256-GCM", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cmdb-cloud-test-"));
  const source = path.join(root, "source.txt");
  const encrypted = path.join(root, "encrypted.nca");
  const restored = path.join(root, "restored.txt");
  const contentKey = crypto.randomBytes(32);
  const dataIv = crypto.randomBytes(12);
  await fs.writeFile(source, "法院附件明文");

  await encryptAttachmentFile({ sourcePath: source, targetPath: encrypted, contentKey, dataIv });
  const ciphertext = await fs.readFile(encrypted, "utf8");
  assert.equal(ciphertext.includes("法院附件明文"), false);
  await decryptAttachmentFile({ sourcePath: encrypted, targetPath: restored, contentKey, dataIv });
  assert.equal(await fs.readFile(restored, "utf8"), "法院附件明文");

  await assert.rejects(
    decryptAttachmentFile({ sourcePath: encrypted, targetPath: path.join(root, "wrong.txt"), contentKey: crypto.randomBytes(32), dataIv }),
    /密文校验失败/,
  );
  assert.equal(await fs.stat(path.join(root, "wrong.txt")).catch(() => null), null);
  await fs.rm(root, { recursive: true, force: true });
});

test("uploads only encrypted bytes and downloads to a controlled temporary file", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cmdb-cloud-test-"));
  const source = path.join(root, "source.txt");
  await fs.writeFile(source, "known plaintext");
  const objects = new Map();
  const client = { send: async (command) => {
    if (command instanceof PutObjectCommand) {
      objects.set(command.input.Key, await new Promise((resolve, reject) => {
        const chunks = [];
        command.input.Body.on("data", (chunk) => chunks.push(chunk));
        command.input.Body.on("end", () => resolve(Buffer.concat(chunks)));
        command.input.Body.on("error", reject);
      }));
      return {};
    }
    if (command instanceof GetObjectCommand) return { Body: ReadableBody(objects.get(command.input.Key)) };
    if (command instanceof HeadObjectCommand) return { ContentLength: objects.get(command.input.Key)?.length || 0 };
    throw new Error("unexpected command");
  } };
  const ReadableBody = (bytes) => require("node:stream").Readable.from([bytes]);
  const handlers = createAttachmentCloudHandlers({
    buildS3Client: async () => client,
    HeadObjectCommand,
    PutObjectCommand,
    GetObjectCommand,
    tempRoot: path.join(root, "temporary"),
  });
  const contentKey = crypto.randomBytes(32);
  const dataIv = crypto.randomBytes(12);
  const keyPayload = contentKey.toString("base64");
  const ivPayload = dataIv.toString("base64");
  const uploaded = await handlers.upload({
    config: { bucket: "test", prefix: "cmdb" },
    subKey: "attachments/object.nca",
    localFilePath: source,
    contentKey: keyPayload,
    dataIv: ivPayload,
  });
  assert.equal(uploaded.ok, true);
  assert.equal(objects.has("cmdb/attachments/object.nca"), true);
  assert.equal(objects.get("cmdb/attachments/object.nca").includes("known plaintext"), false);
  const downloaded = await handlers.download({
    config: { bucket: "test", prefix: "cmdb" },
    subKey: "attachments/object.nca",
    contentKey: keyPayload,
    dataIv: ivPayload,
  });
  assert.equal(await fs.readFile(downloaded.tempFilePath, "utf8"), "known plaintext");
  await fs.rm(downloaded.tempFilePath, { force: true });
  await fs.rm(root, { recursive: true, force: true });
});

test("上传写出的 S3 对象带 CMDB 附件魔法头，尺寸为明文加头尾开销", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cmdb-cloud-test-"));
  const source = path.join(root, "payload.bin");
  await fs.writeFile(source, Buffer.alloc(1000, 7));
  const objects = new Map();
  const client = {
    send: async (command) => {
      if (command instanceof PutObjectCommand) {
        const chunks = [];
        await new Promise((resolve, reject) => {
          command.input.Body.on("data", (chunk) => chunks.push(chunk));
          command.input.Body.on("end", resolve);
          command.input.Body.on("error", reject);
        });
        objects.set(command.input.Key, Buffer.concat(chunks));
        return {};
      }
      throw new Error("unexpected command");
    },
  };
  const handlers = createAttachmentCloudHandlers({
    buildS3Client: async () => client,
    HeadObjectCommand,
    PutObjectCommand,
    GetObjectCommand,
    tempRoot: path.join(root, "temp"),
  });
  const result = await handlers.upload({
    config: { bucket: "b", prefix: "court" },
    subKey: "attachments/obj.nca",
    localFilePath: source,
    contentKey: crypto.randomBytes(32).toString("base64"),
    dataIv: crypto.randomBytes(12).toString("base64"),
  });
  const overhead = MAGIC.length + 1 + 16; // 魔法头 + 版本号 + GCM 认证标签
  assert.equal(result.encryptedSizeBytes, 1000 + overhead);
  const blob = objects.get("court/attachments/obj.nca");
  assert.equal(blob.length, 1000 + overhead);
  assert.ok(blob.subarray(0, MAGIC.length).equals(MAGIC));
  assert.equal(blob[MAGIC.length], 1);
  await fs.rm(root, { recursive: true, force: true });
});

test("上传拒绝非法内容密钥与数据 IV", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cmdb-cloud-test-"));
  const source = path.join(root, "s.txt");
  await fs.writeFile(source, "x");
  const handlers = createAttachmentCloudHandlers({
    buildS3Client: async () => ({ send: async () => {} }),
    HeadObjectCommand,
    PutObjectCommand,
    GetObjectCommand,
    tempRoot: path.join(root, "temp"),
  });
  await assert.rejects(
    handlers.upload({
      config: {},
      subKey: "a/b",
      localFilePath: source,
      contentKey: Buffer.alloc(8).toString("base64"),
      dataIv: crypto.randomBytes(12).toString("base64"),
    }),
    /附件内容密钥 长度无效/,
  );
  await assert.rejects(
    handlers.upload({
      config: {},
      subKey: "a/b",
      localFilePath: source,
      contentKey: crypto.randomBytes(32).toString("base64"),
      dataIv: Buffer.alloc(4).toString("base64"),
    }),
    /附件数据 IV 长度无效/,
  );
  await fs.rm(root, { recursive: true, force: true });
});

test("上传拒绝相对源路径", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cmdb-cloud-test-"));
  const handlers = createAttachmentCloudHandlers({
    buildS3Client: async () => ({ send: async () => {} }),
    HeadObjectCommand,
    PutObjectCommand,
    GetObjectCommand,
    tempRoot: path.join(root, "temp"),
  });
  await assert.rejects(
    handlers.upload({
      config: {},
      subKey: "a/b",
      localFilePath: "relative.txt",
      contentKey: crypto.randomBytes(32).toString("base64"),
      dataIv: crypto.randomBytes(12).toString("base64"),
    }),
    /附件源路径必须是绝对路径/,
  );
  await fs.rm(root, { recursive: true, force: true });
});

test("上传拒绝本机缺失的待补传附件", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cmdb-cloud-test-"));
  const handlers = createAttachmentCloudHandlers({
    buildS3Client: async () => ({ send: async () => {} }),
    HeadObjectCommand,
    PutObjectCommand,
    GetObjectCommand,
    tempRoot: path.join(root, "temp"),
    resolvePendingAttachment: async () => ({ local_exists: false, local_path: "" }),
  });
  await assert.rejects(
    handlers.upload({
      config: {},
      subKey: "a/b",
      attachmentId: 1,
      projectId: 1,
      contentKey: crypto.randomBytes(32).toString("base64"),
      dataIv: crypto.randomBytes(12).toString("base64"),
    }),
    /待同步附件在本机不存在/,
  );
  await fs.rm(root, { recursive: true, force: true });
});

test("上传失败时清理临时密文文件，不留明文或密文残留", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cmdb-cloud-test-"));
  const source = path.join(root, "s.txt");
  await fs.writeFile(source, "secret-plaintext");
  const tempRoot = path.join(root, "temp");
  const handlers = createAttachmentCloudHandlers({
    buildS3Client: async () => ({ send: async () => { throw new Error("S3 上传失败"); } }),
    HeadObjectCommand,
    PutObjectCommand,
    GetObjectCommand,
    tempRoot,
  });
  await assert.rejects(
    handlers.upload({
      config: {},
      subKey: "a/b",
      localFilePath: source,
      contentKey: crypto.randomBytes(32).toString("base64"),
      dataIv: crypto.randomBytes(12).toString("base64"),
    }),
    /S3 上传失败/,
  );
  const entries = await fs.readdir(tempRoot).catch(() => []);
  assert.deepEqual(entries, []);
  await fs.rm(root, { recursive: true, force: true });
});

test("head 对 404 返回不存在，其它错误向上抛出", async () => {
  const notFound = createAttachmentCloudHandlers({
    buildS3Client: async () => ({
      send: async () => {
        const err = new Error("NotFound");
        err.name = "NotFound";
        throw err;
      },
    }),
    HeadObjectCommand,
    PutObjectCommand,
    GetObjectCommand,
  });
  assert.deepEqual(
    await notFound.head({ config: { bucket: "b" }, subKey: "attachments/missing.nca" }),
    { exists: false, key: "attachments/missing.nca" },
  );

  const serverError = createAttachmentCloudHandlers({
    buildS3Client: async () => ({
      send: async () => {
        const err = new Error("S3 服务不可用");
        err.$metadata = { httpStatusCode: 500 };
        throw err;
      },
    }),
    HeadObjectCommand,
    PutObjectCommand,
    GetObjectCommand,
  });
  await assert.rejects(
    serverError.head({ config: { bucket: "b" }, subKey: "attachments/x.nca" }),
    /S3 服务不可用/,
  );
});

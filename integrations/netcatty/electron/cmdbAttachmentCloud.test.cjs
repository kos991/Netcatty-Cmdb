"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
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

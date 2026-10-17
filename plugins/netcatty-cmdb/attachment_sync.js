const http = require('node:http');

/**
 * 请求 CMDB 本地服务 API
 */
function requestCmdb(path, method = 'GET', data = null, port = 8080) {
  return new Promise((resolve, reject) => {
    const payload = data ? JSON.stringify(data) : null;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            const parsed = body ? JSON.parse(body) : null;
            resolve({ statusCode: res.statusCode, data: parsed });
          } catch {
            resolve({ statusCode: res.statusCode, raw: body });
          }
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * 附件云同步调度器：
 * - 扫描本地 pending 状态的附件
 * - 借助 Netcatty 主进程的 S3 IPC 流式上传至对象存储
 * - 上传完成后回写 CMDB 状态为 synced
 */
class AttachmentSyncScheduler {
  constructor(options = {}) {
    this.ipc = options.ipc || null;
    this.getS3Config = options.getS3Config || (() => null);
    this.port = options.port || 8080;
    this.syncIntervalMs = options.syncIntervalMs || 60000;
    this.timer = null;
    this.isSyncing = false;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.syncPendingAttachments();
    }, this.syncIntervalMs);
    // 启动后 5 秒立即执行一次
    setTimeout(() => void this.syncPendingAttachments(), 5000);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async syncPendingAttachments() {
    if (this.isSyncing) return;
    const s3Config = this.getS3Config();
    if (!s3Config || !this.ipc) return;

    this.isSyncing = true;
    try {
      // 1. 获取所有工单列表
      const woRes = await requestCmdb('/api/cmdb/work-orders?limit=100', 'GET', null, this.port);
      if (!woRes.data || !Array.isArray(woRes.data.list)) {
        return;
      }

      for (const order of woRes.data.list) {
        // 2. 获取该工单的附件列表
        const attRes = await requestCmdb(`/api/cmdb/work-orders/${order.id}/attachments`, 'GET', null, this.port);
        if (!attRes.data || !Array.isArray(attRes.data.list)) continue;

        for (const att of attRes.data.list) {
          if (att.s3_status === 'synced') continue;

          // 3. 检查本地物理文件是否存在
          const checkRes = await requestCmdb(`/api/cmdb/attachments/hash/${att.content_hash}/status`, 'GET', null, this.port);
          if (!checkRes.data || !checkRes.data.local_exists) continue;

          const localPath = checkRes.data.local_path;
          const subKey = att.s3_key || `attachments/${att.content_hash.slice(0, 2)}/${att.content_hash.slice(2, 4)}/${att.content_hash}.bin`;

          // 4. 调用 Netcatty S3 IPC 流式上传
          try {
            await this.ipc.invoke('netcatty:cloudSync:s3:uploadAttachment', {
              config: s3Config,
              subKey,
              localFilePath: localPath,
              contentType: att.content_type || 'application/octet-stream',
            });

            // 5. 回写状态为 synced
            await requestCmdb(
              `/api/cmdb/work-orders/${order.id}/attachments/${att.id}/s3-status`,
              'PUT',
              { s3_status: 'synced', s3_key: subKey },
              this.port
            );
            console.log(`[Netcatty-CMDB] 附件已成功同步至 S3: ${att.file_name} -> ${subKey}`);
          } catch (syncErr) {
            console.warn(`[Netcatty-CMDB] 附件同步 S3 失败: ${att.file_name}`, syncErr.message);
          }
        }
      }
    } catch (e) {
      console.warn('[Netcatty-CMDB] 附件同步巡检异常:', e.message);
    } finally {
      this.isSyncing = false;
    }
  }
}

module.exports = {
  AttachmentSyncScheduler,
  requestCmdb,
};

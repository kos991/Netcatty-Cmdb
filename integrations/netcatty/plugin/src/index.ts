import { definePlugin, type JsonValue } from "@netcatty/plugin-sdk";

const VIEW_ID = "com.netcatty.cmdb.resources";
const BASE_URL_SETTING = "com.netcatty.cmdb.baseUrl";
const DEFAULT_BASE_URL = "http://127.0.0.1:18080";

function decodeJson(response: { body: { encoding: "base64"; data: string } }): JsonValue {
  const binary = atob(response.body.data);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as JsonValue;
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

export default definePlugin({
  activate(context) {
    context.subscriptions.add(context.views.onDidReceiveMessage(VIEW_ID, async (message) => {
      if (!message || typeof message !== "object" || Array.isArray(message)) return;
      const requestId = typeof message.requestId === "string" ? message.requestId : "";
      const action = typeof message.action === "string" ? message.action : "";
      if (!requestId || !action) return;

      try {
        const baseUrl = await context.settings.get<string>(BASE_URL_SETTING) ?? DEFAULT_BASE_URL;
        const page = Math.max(1, Number(message.page ?? 1));
        const path = action === "assets"
          ? `/api/cmdb/assets?page=${page}&page_size=50&keyword=${encodeURIComponent(String(message.keyword ?? ""))}`
          : action === "ip_pool"
            ? `/api/ip_pool?page=${page}&page_size=100&keyword=${encodeURIComponent(String(message.keyword ?? ""))}`
            : action === "search"
              ? `/api/search?q=${encodeURIComponent(String(message.keyword ?? ""))}&limit=100`
              : "/api/cmdb/dashboard";
        const response = await context.network.request({
          url: joinUrl(baseUrl, path),
          method: "GET",
          timeoutMs: 10_000,
        });
        const payload = decodeJson(response);
        if (response.status < 200 || response.status >= 300) {
          throw new Error(`CMDB 返回 HTTP ${response.status}`);
        }
        context.views.postMessage(VIEW_ID, { requestId, ok: true, payload });
      } catch (error) {
        context.views.postMessage(VIEW_ID, {
          requestId,
          ok: false,
          error: error instanceof Error ? error.message : "CMDB 请求失败",
        });
      }
    }));
  },
});

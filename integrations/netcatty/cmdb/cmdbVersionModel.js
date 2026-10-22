// 设置页 Cmdb 版本入口：只展示内置服务报告的真实发布 tag，开发构建明确标识，不编造版本号。
export const CMDB_RELEASES_URL = 'https://github.com/kos991/Netcatty-Cmdb/releases'

const RELEASE_TAG = /^v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/

export function cmdbVersionPresentation(raw) {
  const text = String(raw ?? '').trim()
  const match = text.match(RELEASE_TAG)
  if (match) {
    const tag = `v${match[1]}`
    return { kind: 'release', label: tag, title: `Cmdb 发布版本 ${tag}，点击查看发布说明`, url: `${CMDB_RELEASES_URL}/tag/${tag}` }
  }
  if (!text) return { kind: 'unknown', label: '版本未读取', title: '未能从内置 Cmdb 服务读取版本', url: CMDB_RELEASES_URL }
  return { kind: 'development', label: '开发构建', title: `当前为未打发布 tag 的开发构建（服务报告：${text}），点击查看全部发布版本`, url: CMDB_RELEASES_URL }
}

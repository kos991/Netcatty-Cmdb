#!/usr/bin/env bash
# Netcatty-CMDB 插件安装脚本（Linux / macOS）
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "============================================================"
echo " Netcatty-CMDB 插件安装程序"
echo "============================================================"
echo

# 检查 Node.js
if ! command -v node &>/dev/null; then
  echo "[错误] 未找到 Node.js，请先安装 Node.js 22 或更高版本。"
  exit 1
fi

NODEMAJ=$(node --version | sed 's/v//' | cut -d. -f1)
if [ "$NODEMAJ" -lt 22 ]; then
  echo "[错误] 需要 Node.js 22+，当前: $(node --version)"
  exit 1
fi

echo "[信息] Node.js $(node --version)"
echo

node install.mjs
CODE=$?
echo
if [ $CODE -eq 0 ]; then
  echo "安装完成！请重启 Netcatty 后在侧边栏找到 CMDB 图标。"
else
  echo "安装失败（退出码 $CODE）"
  echo "如需指定数据目录：node install.mjs --userData /path/to/userData"
fi
exit $CODE

#!/bin/bash
# ==============================================================================
# CMDB Probe for UnionTech OS (统信 UOS / Debian 系)
# 针对 UOS 桌面端/服务器端：采集硬件配置、已安装程序、软件仓库与安全补丁
# ==============================================================================

set -o pipefail 2>/dev/null || true

export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8

# 1. 基础系统身份
OS_NAME="UOS"
OS_VERSION=""
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS_NAME="${NAME:-UOS}"
    OS_VERSION="${VERSION:-${VERSION_ID:-}}"
fi
KERNEL=$(uname -r)
ARCH=$(uname -m)
HOSTNAME=$(hostname 2>/dev/null || uname -n)

# 2. 硬件资源
CPU_CORES=$(nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo 2>/dev/null || echo 0)
CPU_MODEL=$(grep "model name" /proc/cpuinfo 2>/dev/null | head -n1 | cut -d':' -f2 | sed 's/^[ \t]*//' || echo "")
MEM_TOTAL_MB=$(free -m 2>/dev/null | awk '/^Mem:/{print $2}' || echo 0)

# 3. IP与MAC识别
MAIN_IP=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}' || hostname -I 2>/dev/null | awk '{print $1}' || echo "")
ALL_IPS=$(hostname -I 2>/dev/null | tr '\n' ' ' | sed 's/ $//' || echo "")

# 4. 已安装软件包分析
INSTALLED_TOTAL=0
TOP_APPS=""
if command -v dpkg-query >/dev/null 2>&1; then
    INSTALLED_TOTAL=$(dpkg-query -W -f='${Status}\n' 2>/dev/null | grep -c "ok installed" || dpkg -l 2>/dev/null | grep -c "^ii" || echo 0)
    # 提取常用重要应用与服务软件
    TOP_APPS=$(dpkg-query -W -f='{"name":"${Package}","version":"${Version}","status":"${Status}"}\n' 2>/dev/null \
        | grep "ok installed" \
        | grep -E -i "nginx|apache|mysql|mariadb|postgresql|redis|docker|containerd|kernel|openssh|sudo|systemd|uos|deepin|wps|foxit|antivirus|edr|agent" \
        | head -n 100 \
        | sed 's/}$/},/' | tr '\n' ' ' | sed 's/,$//')
fi

# 5. 安全补丁与软件源可升级检测
UPGRADABLE_TOTAL=0
SECURITY_PATCH_TOTAL=0
UPGRADABLE_LIST=""

if command -v apt-get >/dev/null 2>&1; then
    # 模拟升级，不修改系统
    UPG_OUTPUT=$(apt-get -s upgrade 2>/dev/null || true)
    UPGRADABLE_TOTAL=$(echo "$UPG_OUTPUT" | grep -E "^Inst " | wc -l || echo 0)
    SECURITY_PATCH_TOTAL=$(echo "$UPG_OUTPUT" | grep -E "^Inst " | grep -E -i "security|security.uniontech|debian-security" | wc -l || echo 0)
    
    # 提取前 30 个可升级软件名与候选版本
    UPGRADABLE_LIST=$(echo "$UPG_OUTPUT" | grep -E "^Inst " | head -n 30 | awk '{printf "{\"package\":\"%s\",\"cur_ver\":\"%s\",\"new_ver\":\"%s\"},", $2, $3, $4}' | sed 's/,$//')
fi

# 6. 生成 JSON 输出
cat <<EOF
{
  "os_type": "UOS",
  "os_name": "$OS_NAME",
  "os_version": "$OS_VERSION",
  "kernel": "$KERNEL",
  "arch": "$ARCH",
  "hostname": "$HOSTNAME",
  "main_ip": "$MAIN_IP",
  "all_ips": "$ALL_IPS",
  "cpu_cores": $CPU_CORES,
  "cpu_model": "$CPU_MODEL",
  "memory_mb": $MEM_TOTAL_MB,
  "installed_package_count": $INSTALLED_TOTAL,
  "upgradable_count": $UPGRADABLE_TOTAL,
  "security_patch_count": $SECURITY_PATCH_TOTAL,
  "top_installed_apps": [$TOP_APPS],
  "upgradable_patches": [$UPGRADABLE_LIST],
  "probe_time": "$(date '+%Y-%m-%d %H:%M:%S')"
}
EOF

#!/bin/bash
# ==============================================================================
# CMDB Probe for KylinOS (银河麒麟 / RPM 系)
# 针对 银河麒麟服务器/桌面操作系统：采集配置、已安装程序与安全补丁
# ==============================================================================

set -o pipefail 2>/dev/null || true

export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8

# 1. 基础系统身份
OS_NAME="Kylin"
OS_VERSION=""
if [ -f /etc/kylin-release ]; then
    OS_NAME="Kylin"
    OS_VERSION=$(cat /etc/kylin-release | tr -d '\r\n')
elif [ -f /etc/os-release ]; then
    . /etc/os-release
    OS_NAME="${NAME:-Kylin}"
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

# 4. 已安装 RPM 软件包分析
INSTALLED_TOTAL=0
TOP_APPS=""
if command -v rpm >/dev/null 2>&1; then
    INSTALLED_TOTAL=$(rpm -qa 2>/dev/null | wc -l || echo 0)
    TOP_APPS=$(rpm -qa --qf '{"name":"%{NAME}","version":"%{VERSION}-%{RELEASE}","vendor":"%{VENDOR}"}\n' 2>/dev/null \
        | grep -E -i "nginx|apache|mysql|mariadb|postgresql|redis|docker|containerd|kernel|openssh|sudo|systemd|kylin|ukui|wps|foxit|antivirus|edr|agent" \
        | head -n 100 \
        | sed 's/}$/},/' | tr '\n' ' ' | sed 's/,$//')
fi

# 5. 安全补丁与软件源可升级检测
UPGRADABLE_TOTAL=0
SECURITY_PATCH_TOTAL=0
UPGRADABLE_LIST=""

CHECK_CMD=""
if command -v dnf >/dev/null 2>&1; then
    CHECK_CMD="dnf"
elif command -v yum >/dev/null 2>&1; then
    CHECK_CMD="yum"
fi

if [ -n "$CHECK_CMD" ]; then
    # yum/dnf check-update 返回码 100 代表有包需要更新，0 代表全最新
    UPG_RAW=$($CHECK_CMD check-update -q 2>/dev/null || true)
    UPGRADABLE_TOTAL=$(echo "$UPG_RAW" | grep -v "^$" | grep -v "^Loaded plugins" | wc -l || echo 0)
    
    # 尝试检测安全相关通知
    SEC_RAW=$($CHECK_CMD updateinfo list sec 2>/dev/null || true)
    if [ -n "$SEC_RAW" ]; then
        SECURITY_PATCH_TOTAL=$(echo "$SEC_RAW" | grep -v "^$" | grep -E -i "Important|Moderate|Critical|Low" | wc -l || echo 0)
    fi

    # 提取前 30 个可升级软件列表
    UPGRADABLE_LIST=$(echo "$UPG_RAW" | grep -v "^$" | grep -v "^Loaded plugins" | head -n 30 | awk '{printf "{\"package\":\"%s\",\"new_ver\":\"%s\",\"repo\":\"%s\"},", $1, $2, $3}' | sed 's/,$//')
fi

# 6. 生成 JSON 输出
cat <<EOF
{
  "os_type": "Kylin",
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

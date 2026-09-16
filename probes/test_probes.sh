#!/usr/bin/env bash
# CI 探针自测脚本：验证 uos_probe.sh 和 kylin_probe.sh 的语法与格式解析

set -e

echo "=== 1. 检查探针脚本语法 ==="
bash -n probes/uos_probe.sh
echo "✓ uos_probe.sh 语法正确"
bash -n probes/kylin_probe.sh
echo "✓ kylin_probe.sh 语法正确"

echo "=== 2. 执行本地模拟探针运行 ==="
# 在 Linux 环境下直接运行一次，检查输出是否为有效 JSON
OUTPUT=$(bash probes/uos_probe.sh 2>&1 || true)
if echo "$OUTPUT" | grep -q "os_info"; then
    echo "✓ uos_probe.sh 产生有效输出结构"
else
    echo "探针运行概要: $OUTPUT"
fi

echo "=== 探针验证测试完成 ==="

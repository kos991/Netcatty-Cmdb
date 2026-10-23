#!/bin/bash
# 从 GitHub Actions 最新成功构建下载 app.asar

REPO="binaricat/Netcatty"
BRANCH="main"
ARTIFACT="app.asar"

# 查询最新构建
echo "查询最新构建..."
BUILD=$(curl -s "https://api.github.com/repos/$REPO/actions/workflows/ci.yml/runs?head_branch=$BRANCH&status=completed&conclusion=success" | jq -r '.workflow_runs[0].id')

if [ -z "$BUILD" ] || [ "$BUILD" = "null" ]; then
  echo "未找到成功的构建，CI 可能在运行中"
  exit 1
fi

echo "最新构建 ID: $BUILD"

# 列出该构建的产物
echo "查询产物..."
ARTIFACT_ID=$(curl -s "https://api.github.com/repos/$REPO/actions/runs/$BUILD/artifacts" | jq -r '.artifacts[] | select(.name | contains("app")) | .id' | head -1)

if [ -z "$ARTIFACT_ID" ] || [ "$ARTIFACT_ID" = "null" ]; then
  echo "未找到产物，CI 可能尚未完成"
  exit 1
fi

echo "产物 ID: $ARTIFACT_ID"
echo "下载链接: https://api.github.com/repos/$REPO/actions/artifacts/$ARTIFACT_ID/zip"
echo "手动下载需要 GitHub token，建议等待 Release 发布"

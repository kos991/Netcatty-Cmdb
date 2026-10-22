# Netcatty-Cmdb 离线补丁安装脚本（Windows PowerShell 5.1 及以上）
# 只覆盖 app.asar 与 cmdb 目录；宿主 Netcatty 的上游提交必须与补丁一致，否则拒绝安装。
param(
  [string]$InstallDir = "$env:LOCALAPPDATA\Programs\Netcatty",
  [switch]$Yes
)
$ErrorActionPreference = 'Stop'
$patchRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$manifest = Get-Content -Raw -Encoding UTF8 (Join-Path $patchRoot 'patch-manifest.json') | ConvertFrom-Json

function Fail([string]$message) { Write-Host "安装失败：$message" -ForegroundColor Red; exit 1 }

if (-not (Test-Path (Join-Path $InstallDir 'Netcatty.exe'))) {
  Fail "未找到 Netcatty 安装目录：$InstallDir。请用 -InstallDir 指定实际安装路径。"
}
$installedInfoPath = Join-Path $InstallDir 'resources\cmdb\build-info.json'
if (-not (Test-Path $installedInfoPath)) {
  Fail '当前安装不是 Netcatty-Cmdb 集成版（缺少 resources\cmdb\build-info.json）。请先安装完整安装包。'
}
$installed = Get-Content -Raw -Encoding UTF8 $installedInfoPath | ConvertFrom-Json
if ($installed.upstreamCommit -ne $manifest.upstreamCommit) {
  Fail ("宿主 Netcatty 版本不匹配：本机为 {0}（{1}），补丁需要 {2}（{3}）。请安装对应版本的完整安装包。" -f `
    $installed.upstreamRelease, $installed.upstreamCommit.Substring(0, 8), $manifest.upstreamRelease, $manifest.upstreamCommit.Substring(0, 8))
}
foreach ($file in $manifest.files) {
  $payload = Join-Path $patchRoot ("payload\" + $file.path)
  if (-not (Test-Path $payload)) { Fail "补丁文件缺失：$($file.path)" }
  if ((Get-FileHash -Algorithm SHA256 $payload).Hash.ToLower() -ne $file.sha256) { Fail "补丁文件校验失败：$($file.path)" }
}
$running = Get-Process -Name Netcatty -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($InstallDir, [StringComparison]::OrdinalIgnoreCase) }
if ($running) { Fail '请先完全退出 Netcatty（含托盘），再运行补丁。' }

Write-Host ("Cmdb {0} -> {1}，宿主 Netcatty {2}" -f $installed.cmdbVersion, $manifest.cmdbVersion, $manifest.upstreamRelease)
Write-Host "安装目录：$InstallDir"
if (-not $Yes) {
  $answer = Read-Host '确认覆盖？原文件会先备份 (y/N)'
  if ($answer -notin @('y', 'Y')) { Write-Host '已取消。'; exit 0 }
}

$backup = Join-Path $InstallDir ("cmdb-patch-backup\" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$replaced = @()
try {
  foreach ($file in $manifest.files) {
    $target = Join-Path $InstallDir $file.path
    if (Test-Path $target) {
      $saved = Join-Path $backup $file.path
      New-Item -ItemType Directory -Force (Split-Path -Parent $saved) | Out-Null
      Copy-Item -LiteralPath $target -Destination $saved -Force
    }
    New-Item -ItemType Directory -Force (Split-Path -Parent $target) | Out-Null
    Copy-Item -LiteralPath (Join-Path $patchRoot ("payload\" + $file.path)) -Destination $target -Force
    $replaced += $file
    if ((Get-FileHash -Algorithm SHA256 $target).Hash.ToLower() -ne $file.sha256) { throw "写入后校验失败：$($file.path)" }
  }
} catch {
  Write-Host "覆盖出错，正在从备份恢复：$($_.Exception.Message)" -ForegroundColor Yellow
  foreach ($file in $replaced) {
    $saved = Join-Path $backup $file.path
    if (Test-Path $saved) { Copy-Item -LiteralPath $saved -Destination (Join-Path $InstallDir $file.path) -Force }
  }
  Fail '已恢复原文件，补丁未安装。'
}
Write-Host "补丁已安装，备份位于：$backup" -ForegroundColor Green

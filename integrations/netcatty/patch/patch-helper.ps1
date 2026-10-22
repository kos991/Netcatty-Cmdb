# Netcatty-Cmdb 补丁安装器内部辅助脚本，由图形安装器在临时目录中调用，用户不需要直接运行。
# 用法：patch-helper.ps1 -Action <find|check|apply> [-InstallDir <dir>] -PatchRoot <dir> -ResultFile <file>
# 结果写入 ResultFile（UTF-16LE，单行，供 NSIS FileReadUTF16LE 读取中文）：
#   find 写目录；check/apply 成功写 OK:<信息>，失败写 ERROR:<原因>，退出码非 0。
param(
  [ValidateSet('find', 'check', 'apply')][string]$Action,
  [string]$InstallDir = '',
  [string]$PatchRoot,
  [string]$ResultFile
)
$ErrorActionPreference = 'Stop'

function Write-Result([string]$text) { [IO.File]::WriteAllText($ResultFile, $text, [Text.Encoding]::Unicode) }
function Fail([string]$message) { Write-Result "ERROR:$message"; exit 1 }
trap { Fail ("内部错误：{0}" -f $_.Exception.Message) }
function Read-Json([string]$path) { Get-Content -Raw -Encoding UTF8 -LiteralPath $path | ConvertFrom-Json }
function Test-Integrated([string]$dir) {
  $dir -and (Test-Path -LiteralPath (Join-Path $dir 'Netcatty.exe')) -and (Test-Path -LiteralPath (Join-Path $dir 'resources\cmdb\build-info.json'))
}
$manifest = Read-Json (Join-Path $PatchRoot 'patch-manifest.json')

if ($Action -eq 'find') {
  # 默认路径优先：当前用户安装 → 所有用户安装 → 注册表卸载项记录的安装目录。
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\Netcatty'),
    (Join-Path $env:ProgramFiles 'Netcatty')
  )
  foreach ($root in @('HKCU:', 'HKLM:')) {
    foreach ($key in @('Software\Microsoft\Windows\CurrentVersion\Uninstall', 'Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')) {
      Get-ChildItem -LiteralPath "$root\$key" -ErrorAction SilentlyContinue | ForEach-Object {
        $item = Get-ItemProperty -LiteralPath $_.PSPath -ErrorAction SilentlyContinue
        if ($item.DisplayName -eq 'Netcatty' -and $item.InstallLocation) { $candidates += $item.InstallLocation.Trim('"') }
      }
    }
  }
  $found = $candidates | Where-Object { Test-Integrated $_ } | Select-Object -First 1
  Write-Result ($(if ($found) { $found } else { $candidates[0] }))
  exit 0
}

if (-not (Test-Path -LiteralPath (Join-Path $InstallDir 'Netcatty.exe'))) { Fail "所选目录中没有 Netcatty.exe：$InstallDir" }
$infoPath = Join-Path $InstallDir 'resources\cmdb\build-info.json'
if (-not (Test-Path -LiteralPath $infoPath)) { Fail '所选目录不是 Netcatty-Cmdb 集成版（缺少 resources\cmdb\build-info.json），请先安装完整安装包。' }
$installed = Read-Json $infoPath
if ($installed.upstreamCommit -ne $manifest.upstreamCommit) {
  Fail ("宿主 Netcatty 版本不匹配：本机为 {0}，补丁需要 {1}。请安装对应版本的完整安装包。" -f $installed.upstreamRelease, $manifest.upstreamRelease)
}
foreach ($file in $manifest.files) {
  $payload = Join-Path $PatchRoot ("payload\" + $file.path)
  if (-not (Test-Path -LiteralPath $payload)) { Fail "补丁文件缺失：$($file.path)" }
  if ((Get-FileHash -Algorithm SHA256 -LiteralPath $payload).Hash.ToLower() -ne $file.sha256) { Fail "补丁文件校验失败：$($file.path)，请重新下载补丁。" }
}
$running = Get-Process -Name Netcatty -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($InstallDir, [StringComparison]::OrdinalIgnoreCase) }
if ($running) { Fail 'Netcatty 正在运行，请完全退出（含托盘图标）后点“重试”。' }
if ($Action -eq 'check') { Write-Result ("OK:{0}" -f $installed.cmdbVersion); exit 0 }

# apply：先备份，再覆盖并逐个校验；任何一步失败都从备份恢复。
# 只动安装目录下的 app.asar 与 resources\cmdb，不触碰 %APPDATA%\netcatty 中的用户数据和数据库。
$backup = Join-Path $InstallDir ("cmdb-patch-backup\" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$replaced = @()
try {
  foreach ($file in $manifest.files) {
    $target = Join-Path $InstallDir $file.path
    if (Test-Path -LiteralPath $target) {
      $saved = Join-Path $backup $file.path
      New-Item -ItemType Directory -Force (Split-Path -Parent $saved) | Out-Null
      Copy-Item -LiteralPath $target -Destination $saved -Force
    }
    New-Item -ItemType Directory -Force (Split-Path -Parent $target) | Out-Null
    Copy-Item -LiteralPath (Join-Path $PatchRoot ("payload\" + $file.path)) -Destination $target -Force
    $replaced += $file
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $target).Hash.ToLower() -ne $file.sha256) { throw "写入后校验失败：$($file.path)" }
  }
} catch {
  foreach ($file in $replaced) {
    $saved = Join-Path $backup $file.path
    if (Test-Path -LiteralPath $saved) { Copy-Item -LiteralPath $saved -Destination (Join-Path $InstallDir $file.path) -Force }
  }
  Fail ("覆盖失败，已恢复原文件：{0}" -f $_.Exception.Message)
}
Write-Result "OK:$backup"

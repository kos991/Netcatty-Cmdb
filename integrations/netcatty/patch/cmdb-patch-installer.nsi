; Netcatty-Cmdb 离线补丁图形安装器（NSIS Unicode + MUI2）。
; 只替换安装目录中的 resources\app.asar 与 resources\cmdb\*，不触碰 %APPDATA%\netcatty 用户数据。
; 构建：makensis /DPATCH_VERSION=<版本> /DUPSTREAM_RELEASE=<上游版本> /DSTAGING=<补丁暂存目录> /DOUTFILE=<输出 exe> cmdb-patch-installer.nsi
Unicode true
ManifestDPIAware true
SetCompressor /SOLID lzma
RequestExecutionLevel user

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"

Name "Netcatty-Cmdb 补丁 ${PATCH_VERSION}"
Caption "Netcatty-Cmdb 补丁 ${PATCH_VERSION}"
OutFile "${OUTFILE}"
BrandingText "Netcatty-Cmdb ${PATCH_VERSION}（适用于 Netcatty ${UPSTREAM_RELEASE}）"
ShowInstDetails show
InstallDir "$LOCALAPPDATA\Programs\Netcatty"
VIProductVersion "1.0.0.0"
VIAddVersionKey /LANG=2052 "ProductName" "Netcatty-Cmdb 补丁"
VIAddVersionKey /LANG=2052 "FileDescription" "Netcatty-Cmdb 离线补丁安装器"
VIAddVersionKey /LANG=2052 "ProductVersion" "${PATCH_VERSION}"
VIAddVersionKey /LANG=2052 "FileVersion" "${PATCH_VERSION}"
VIAddVersionKey /LANG=2052 "LegalCopyright" "Netcatty-Cmdb"

Var PatchRoot
Var ResultFile
Var Result
Var BackupDir

!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "安装 Netcatty-Cmdb 补丁 ${PATCH_VERSION}"
!define MUI_WELCOMEPAGE_TEXT "本向导会把已安装的 Netcatty-Cmdb 集成版升级到 Cmdb ${PATCH_VERSION}。$\r$\n$\r$\n• 只替换安装目录中的 Cmdb 程序文件，不修改 Netcatty 的连接、密钥、设置和 Cmdb 数据库。$\r$\n• 要求本机 Netcatty 为 ${UPSTREAM_RELEASE}，版本不同会提示改装完整安装包。$\r$\n• 覆盖前自动备份，失败会自动恢复。$\r$\n$\r$\n请先完全退出 Netcatty（含托盘图标），然后点“下一步”。"
!insertmacro MUI_PAGE_WELCOME

!define MUI_DIRECTORYPAGE_TEXT_TOP "已自动找到 Netcatty 安装目录。如果装在其他位置，请点“浏览”选择包含 Netcatty.exe 的文件夹。"
!define MUI_DIRECTORYPAGE_TEXT_DESTINATION "Netcatty 安装目录"
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE DirectoryLeave
!insertmacro MUI_PAGE_DIRECTORY

!insertmacro MUI_PAGE_INSTFILES

!define MUI_FINISHPAGE_TITLE "补丁已安装"
!define MUI_FINISHPAGE_TEXT "Cmdb 已升级到 ${PATCH_VERSION}。$\r$\n$\r$\n原文件备份在：$\r$\n$BackupDir"
!define MUI_FINISHPAGE_RUN "$INSTDIR\Netcatty.exe"
!define MUI_FINISHPAGE_RUN_TEXT "启动 Netcatty"
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_LANGUAGE "SimpChinese"

; 调用辅助脚本；结果从 UTF-16LE 文件读入 $Result，退出码压栈（0 成功）。
!macro RunHelper ACTION
  Delete "$ResultFile"
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PatchRoot\patch-helper.ps1" -Action ${ACTION} -InstallDir "$INSTDIR" -PatchRoot "$PatchRoot" -ResultFile "$ResultFile"'
  Pop $0
  StrCpy $Result ""
  ClearErrors
  FileOpen $1 "$ResultFile" r
  ${IfNot} ${Errors}
    FileReadUTF16LE $1 $Result 4096
    FileClose $1
  ${EndIf}
  Push $0
!macroend

; 去掉 "ERROR:" 或 "OK:" 前缀。
!macro StripPrefix
  StrCpy $2 $Result 6
  ${If} $2 == "ERROR:"
    StrCpy $Result $Result "" 6
  ${Else}
    StrCpy $2 $Result 3
    ${If} $2 == "OK:"
      StrCpy $Result $Result "" 3
    ${EndIf}
  ${EndIf}
!macroend

Function .onInit
  InitPluginsDir
  StrCpy $PatchRoot "$PLUGINSDIR\patch"
  StrCpy $ResultFile "$PLUGINSDIR\result.txt"
  SetOutPath "$PatchRoot"
  File /r "${STAGING}\*"
  ; 以管理员身份重启时通过 /TARGET= 传入用户选择的目录；否则按默认路径优先自动查找。
  ${GetParameters} $0
  ClearErrors
  ${GetOptions} $0 "/TARGET=" $1
  ${If} ${Errors}
    !insertmacro RunHelper find
    Pop $0
    ${If} $Result != ""
      StrCpy $INSTDIR $Result
    ${EndIf}
  ${Else}
    StrCpy $INSTDIR $1
  ${EndIf}
FunctionEnd

Function DirectoryLeave
  !insertmacro RunHelper check
  Pop $0
  ${If} $0 != 0
    !insertmacro StripPrefix
    MessageBox MB_ICONEXCLAMATION|MB_OK "$Result"
    Abort
  ${EndIf}
  ; 目录不可写（例如 Program Files）时，以管理员身份重新启动本安装器并带上所选目录。
  ClearErrors
  FileOpen $3 "$INSTDIR\resources\cmdb\.cmdb-patch-write-test" w
  ${If} ${Errors}
    MessageBox MB_ICONINFORMATION|MB_OKCANCEL "安装目录需要管理员权限才能写入。点“确定”后会弹出 Windows 权限确认。" IDOK elevate
    Abort
    elevate:
    ClearErrors
    ExecShell "runas" "$EXEPATH" '/TARGET="$INSTDIR"'
    ${If} ${Errors}
      MessageBox MB_ICONSTOP|MB_OK "未获得管理员权限，补丁未安装。"
      Abort
    ${EndIf}
    Quit
  ${EndIf}
  FileClose $3
  Delete "$INSTDIR\resources\cmdb\.cmdb-patch-write-test"
FunctionEnd

Section "Cmdb 补丁" SecPatch
  DetailPrint "安装目录：$INSTDIR"
  DetailPrint "正在备份并替换 Cmdb 文件…"
  !insertmacro RunHelper apply
  Pop $0
  !insertmacro StripPrefix
  ${If} $0 != 0
    DetailPrint "失败：$Result"
    MessageBox MB_ICONSTOP|MB_OK "$Result"
    Abort "补丁未安装"
  ${EndIf}
  StrCpy $BackupDir $Result
  DetailPrint "完成，原文件备份在：$BackupDir"
SectionEnd

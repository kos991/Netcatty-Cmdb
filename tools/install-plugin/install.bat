@echo off
chcp 65001 >nul 2>&1
setlocal

echo ============================================================
echo  Netcatty-CMDB 插件安装程序
echo ============================================================
echo.

:: 检查 Node.js 是否可用
where node >nul 2>&1
if errorlevel 1 (
    echo [错误] 未找到 Node.js，请先安装 Node.js 22 或更高版本。
    echo        下载地址: https://nodejs.org/
    pause
    exit /b 1
)

:: 检查 Node.js 版本（需要 22+ 以使用内置 sqlite）
for /f "tokens=1 delims=v" %%i in ('node --version') do set NODERAW=%%i
for /f "tokens=1 delims=." %%i in ('node --version ^| findstr /r "[0-9]"') do set NODEMAJ=%%i
set NODEMAJ=%NODEMAJ:v=%
if %NODEMAJ% LSS 22 (
    echo [错误] 需要 Node.js 22 或更高版本，当前版本:
    node --version
    pause
    exit /b 1
)

echo [信息] Node.js 版本:
node --version
echo.

:: 切换到本脚本所在目录
cd /d "%~dp0"

:: 检查 Netcatty 是否正在运行
tasklist /FI "IMAGENAME eq Netcatty.exe" 2>nul | find /I "Netcatty.exe" >nul
if not errorlevel 1 (
    echo [警告] 检测到 Netcatty 正在运行。
    echo        安装完成后需要重启 Netcatty 才能加载插件。
    echo.
    set /p CONFIRM="是否继续安装？(Y/N): "
    if /i not "!CONFIRM!"=="Y" (
        echo 安装已取消。
        pause
        exit /b 0
    )
    echo.
)

echo [信息] 正在安装插件，请稍候...
echo.

node install.mjs
set EXITCODE=%errorlevel%

echo.
if %EXITCODE% equ 0 (
    echo ============================================================
    echo  安装完成！请重启 Netcatty 后在侧边栏找到 CMDB 图标。
    echo ============================================================
) else (
    echo ============================================================
    echo  安装失败（退出码 %EXITCODE%），请检查上方错误信息。
    echo  如需指定 Netcatty 数据目录，请在命令行运行：
    echo    node install.mjs --userData "C:\path\to\Netcatty\userData"
    echo ============================================================
)

echo.
pause
exit /b %EXITCODE%

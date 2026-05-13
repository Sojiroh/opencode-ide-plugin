@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem Build opencode for multiple platforms and place binaries plus webgui-dist in both JetBrains and VSCode plugin resources.

pushd "%~dp0\..\.."
set "ROOT_DIR=%CD%"
popd

set "OPENCODE_DIR=%ROOT_DIR%\packages\opencode"
set "WEBGUI_DIR=%OPENCODE_DIR%\webgui"
set "WEBGUI_DIST=%OPENCODE_DIR%\webgui-dist"
set "DIST_DIR=%OPENCODE_DIR%\dist"
set "JETBRAINS_BIN_DIR=%ROOT_DIR%\hosts\jetbrains-plugin\src\main\resources\bin"
set "VSCODE_BIN_DIR=%ROOT_DIR%\hosts\vscode-plugin\resources\bin"

if not exist "%OPENCODE_DIR%" (
  echo Error: opencode package directory not found at %OPENCODE_DIR% 1>&2
  exit /b 1
)

where bun >nul 2>nul
if errorlevel 1 (
  echo Error: bun command not found in PATH 1>&2
  exit /b 1
)

call :prepare_output_dir "%JETBRAINS_BIN_DIR%"
call :prepare_output_dir "%VSCODE_BIN_DIR%"

if not defined OPENCODE_VERSION (
  for /f "delims=" %%V in ('node -p "require('%OPENCODE_DIR:\=/%/package.json').version"') do set "OPENCODE_VERSION=%%V"
)

echo => Building webgui-dist
pushd "%WEBGUI_DIR%"
bun run build
if errorlevel 1 (
  popd
  exit /b 1
)
popd

if not exist "%WEBGUI_DIST%" (
  echo Error: expected webgui-dist directory not found at %WEBGUI_DIST% 1>&2
  exit /b 1
)

echo => Building opencode distribution (version %OPENCODE_VERSION%)
pushd "%OPENCODE_DIR%"
bun script/build.ts
if errorlevel 1 (
  popd
  exit /b 1
)
popd

if not exist "%DIST_DIR%" (
  echo Error: expected dist directory not found at %DIST_DIR% 1>&2
  exit /b 1
)

set "FOUND_DIST=false"
for /d %%D in ("%DIST_DIR%\opencode-*") do (
  call :process_dist "%%~fD"
)

if /I "%FOUND_DIST%"=="false" (
  echo Error: no opencode distribution folders found in %DIST_DIR% 1>&2
  exit /b 1
)

echo.
echo All done. Binaries placed under:
echo   JetBrains: %JETBRAINS_BIN_DIR%
echo   VSCode: %VSCODE_BIN_DIR%
echo opencode dists remain in %DIST_DIR%
exit /b 0

:process_dist
set "DIST_PATH=%~1"
if not exist "%DIST_PATH%" exit /b

set "DIRNAME=%~nx1"
set "SUFFIX=%DIRNAME:opencode-=%"
if /I "%SUFFIX%"=="%DIRNAME%" (
  echo Warning: skipping unrecognised dist folder %DIRNAME% 1>&2
  exit /b
)

set "OS="
set "ARCH="
for /f "tokens=1* delims=-" %%a in ("%SUFFIX%") do (
  set "OS=%%a"
  set "ARCH=%%b"
)
if not defined ARCH (
  echo Warning: skipping %DIRNAME% due to missing architecture component 1>&2
  exit /b
)

if /I "%ARCH%"=="x64-baseline" (
  echo Skipping baseline target %DIRNAME%
  exit /b
)

set "OS_DIR=%OS%"
if /I "%OS_DIR%"=="darwin" set "OS_DIR=macos"

set "ARCH_DIR=%ARCH%"
if /I "%ARCH_DIR%"=="x64" set "ARCH_DIR=amd64"

set "BINARY_NAME=opencode"
set "BINARY_SRC=%DIST_PATH%\bin\opencode"
if /I "%OS%"=="windows" (
  set "BINARY_NAME=opencode.exe"
  set "BINARY_SRC=%DIST_PATH%\bin\opencode.exe"
)

if not exist "%BINARY_SRC%" (
  echo Warning: binary not found at %BINARY_SRC% 1>&2
  exit /b
)

set "JETBRAINS_TARGET=%JETBRAINS_BIN_DIR%\%OS_DIR%\%ARCH_DIR%"
set "VSCODE_TARGET=%VSCODE_BIN_DIR%\%OS_DIR%\%ARCH_DIR%"

if not exist "%JETBRAINS_TARGET%" mkdir "%JETBRAINS_TARGET%"
if not exist "%VSCODE_TARGET%" mkdir "%VSCODE_TARGET%"

copy /Y "%BINARY_SRC%" "%JETBRAINS_TARGET%\%BINARY_NAME%" >nul
copy /Y "%BINARY_SRC%" "%VSCODE_TARGET%\%BINARY_NAME%" >nul
xcopy "%WEBGUI_DIST%" "%JETBRAINS_TARGET%\webgui-dist\" /E /I /Y >nul
if errorlevel 1 exit /b 1
xcopy "%WEBGUI_DIST%" "%VSCODE_TARGET%\webgui-dist\" /E /I /Y >nul
if errorlevel 1 exit /b 1

echo => Prepared binaries and webgui-dist for %OS%/%ARCH%
set "FOUND_DIST=true"
exit /b

:prepare_output_dir
set "TARGET=%~1"
if "%TARGET%"=="" (
  echo Error: output directory path is empty 1>&2
  exit /b 1
)
if exist "%TARGET%" rd /s /q "%TARGET%"
mkdir "%TARGET%"
exit /b 0

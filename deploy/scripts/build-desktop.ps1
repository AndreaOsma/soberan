#Requires -Version 5.1
<#
.SYNOPSIS
  Build Soberan Windows desktop bundle (frontend + PyInstaller + optional Inno Setup installer).

.PARAMETER SkipInstaller
  Only build PyInstaller folder under backend/dist/Soberan.

.PARAMETER Version
  Version string for the installer output file name.
#>
param(
    [switch]$SkipInstaller,
    [string]$Version = "0.1.0"
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Backend = Join-Path $Root "backend"
$Static = Join-Path $Backend "desktop\static"
$Dist = Join-Path $Backend "dist\Soberan"
$InstallerOut = Join-Path $Root "packaging\out"

Write-Host "==> Soberan desktop build v$Version"

# 1. Frontend (Vite app at repo root)
Push-Location $Root
if (-not (Test-Path "node_modules")) {
    npm ci
}
npm run build
Pop-Location

# 2. Copy static assets
if (Test-Path $Static) {
    Get-ChildItem $Static -Exclude ".gitkeep" | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
} else {
    New-Item -ItemType Directory -Path $Static -Force | Out-Null
}
Copy-Item -Path (Join-Path $Root "dist\*") -Destination $Static -Recurse -Force
Write-Host "    Static copied to $Static"

$VersionFile = Join-Path $Backend "desktop\VERSION"
Set-Content -Path $VersionFile -Value $Version -Encoding utf8 -NoNewline
Write-Host "    Version file: $Version"

# 3. Python venv + PyInstaller
Push-Location $Backend
if (-not (Test-Path ".venv-desktop")) {
    python -m venv .venv-desktop
}
& .\.venv-desktop\Scripts\pip.exe install -q -r requirements-desktop.txt
& .\.venv-desktop\Scripts\pyinstaller.exe --noconfirm soberan-desktop.spec
Pop-Location

if (-not (Test-Path (Join-Path $Dist "Soberan.exe"))) {
    throw "PyInstaller output not found at $Dist\Soberan.exe"
}
Write-Host "    Bundle: $Dist"

if ($SkipInstaller) {
    Write-Host "==> Done (installer skipped)."
    exit 0
}

# 4. Inno Setup (optional)
$Iscc = @(
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    "${env:ProgramFiles}\Inno Setup 6\ISCC.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $Iscc) {
    if ($env:CI -eq "true") {
        throw "Inno Setup 6 required in CI. Install with: choco install innosetup -y"
    }
    Write-Warning "Inno Setup 6 not found. Install from https://jrsoftware.org/isinfo.php"
    Write-Host "    Portable bundle ready at: $Dist"
    exit 0
}

New-Item -ItemType Directory -Path $InstallerOut -Force | Out-Null
& $Iscc "/DAppVersion=$Version" (Join-Path $Root "packaging\soberan.iss")
Write-Host "==> Installer: $InstallerOut\SoberanSetup-$Version.exe"

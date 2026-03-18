# Gambi CLI Installer for Windows
# Usage: irm https://raw.githubusercontent.com/arthurbm/gambi/main/scripts/install.ps1 | iex

$ErrorActionPreference = "Stop"

$Repo = "arthurbm/gambi"
$BinaryName = "gambi.exe"
$InstallDir = Join-Path $env:LOCALAPPDATA "gambi"

function Get-LatestVersion {
    $response = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/latest"
    $version = $response.tag_name -replace '^v', ''
    if (-not $version) {
        throw "Failed to get latest version."
    }
    return $version
}

function Install-Gambi {
    Write-Host ""
    Write-Host "  Gambi CLI Installer" -ForegroundColor Cyan
    Write-Host ""

    $version = Get-LatestVersion
    Write-Host "[INFO] Latest version: $version" -ForegroundColor Green

    $artifact = "gambi-windows-x64.exe"
    $downloadUrl = "https://github.com/$Repo/releases/download/v$version/$artifact"
    Write-Host "[INFO] Downloading from: $downloadUrl" -ForegroundColor Green

    # Create install directory
    if (-not (Test-Path $InstallDir)) {
        New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    }

    $destPath = Join-Path $InstallDir $BinaryName

    # Download binary
    try {
        Invoke-WebRequest -Uri $downloadUrl -OutFile $destPath -UseBasicParsing
    } catch {
        throw "Failed to download binary. The release might not exist yet."
    }

    Write-Host "[INFO] Installed to: $destPath" -ForegroundColor Green

    # Add to PATH if not already there
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($userPath -notlike "*$InstallDir*") {
        [Environment]::SetEnvironmentVariable("Path", "$userPath;$InstallDir", "User")
        Write-Host "[INFO] Added $InstallDir to user PATH." -ForegroundColor Green
        Write-Host "[INFO] Restart your terminal for PATH changes to take effect." -ForegroundColor Yellow
    }

    # Verify
    Write-Host "[INFO] Installation complete! Run 'gambi --version' to verify." -ForegroundColor Green
}

Install-Gambi

# Gambiarra CLI Uninstaller for Windows
# Usage: irm https://raw.githubusercontent.com/arthurbm/gambiarra/main/scripts/uninstall.ps1 | iex

$ErrorActionPreference = "Stop"

$BinaryName = "gambiarra.exe"
$InstallDir = Join-Path $env:LOCALAPPDATA "gambiarra"

function Uninstall-Gambiarra {
    Write-Host ""
    Write-Host "  Gambiarra CLI Uninstaller" -ForegroundColor Cyan
    Write-Host ""

    $binaryPath = Join-Path $InstallDir $BinaryName

    if (-not (Test-Path $binaryPath)) {
        # Check if it's somewhere else in PATH
        $found = Get-Command "gambiarra" -ErrorAction SilentlyContinue
        if ($found) {
            $binaryPath = $found.Source
        } else {
            Write-Host "[ERROR] gambiarra not found. Nothing to uninstall." -ForegroundColor Red
            return
        }
    }

    Write-Host "[INFO] Found gambiarra at: $binaryPath" -ForegroundColor Green

    # Remove binary
    Remove-Item $binaryPath -Force
    Write-Host "[INFO] Removed $binaryPath" -ForegroundColor Green

    # Remove install directory if empty
    if ((Test-Path $InstallDir) -and -not (Get-ChildItem $InstallDir)) {
        Remove-Item $InstallDir -Force
        Write-Host "[INFO] Removed empty directory: $InstallDir" -ForegroundColor Green
    }

    # Remove from PATH
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($userPath -like "*$InstallDir*") {
        $newPath = ($userPath -split ";" | Where-Object { $_ -ne $InstallDir }) -join ";"
        [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
        Write-Host "[INFO] Removed $InstallDir from user PATH." -ForegroundColor Green
    }

    Write-Host "[INFO] gambiarra has been uninstalled successfully." -ForegroundColor Green
}

Uninstall-Gambiarra

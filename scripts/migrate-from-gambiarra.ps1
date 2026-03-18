$ErrorActionPreference = "Stop"

$Repo = "arthurbm/gambi"
$OldBinary = "gambiarra"
$OldInstallDir = Join-Path $env:LOCALAPPDATA "gambiarra"
$NewInstallDir = Join-Path $env:LOCALAPPDATA "gambi"
$OldConfigDir = Join-Path $HOME ".gambiarra"
$NewConfigDir = Join-Path $HOME ".gambi"

function Try-RemoveLegacyPackages {
    if (Get-Command npm -ErrorAction SilentlyContinue) {
        try { npm uninstall -g gambiarra | Out-Null } catch {}
    }

    if (Get-Command bun -ErrorAction SilentlyContinue) {
        try { bun remove -g gambiarra | Out-Null } catch {}
    }
}

function Try-RemoveLegacyBinary {
    $legacyPath = Join-Path $OldInstallDir "$OldBinary.exe"

    if (Test-Path $legacyPath) {
        Remove-Item $legacyPath -Force -ErrorAction SilentlyContinue
        Write-Host "[INFO] Removed legacy binary: $legacyPath" -ForegroundColor Green
        return
    }

    $found = Get-Command $OldBinary -ErrorAction SilentlyContinue
    if ($found) {
        Remove-Item $found.Source -Force -ErrorAction SilentlyContinue
        Write-Host "[INFO] Removed legacy binary: $($found.Source)" -ForegroundColor Green
    }
}

function Try-MigrateConfig {
    $oldConfig = Join-Path $OldConfigDir "config.json"
    $newConfig = Join-Path $NewConfigDir "config.json"

    if ((Test-Path $oldConfig) -and -not (Test-Path $newConfig)) {
        New-Item -ItemType Directory -Path $NewConfigDir -Force | Out-Null
        Copy-Item $oldConfig $newConfig -Force
        Write-Host "[INFO] Copied config to $newConfig" -ForegroundColor Green
    }
}

function Install-NewCli {
    Write-Host "[INFO] Installing gambi" -ForegroundColor Green
    irm "https://raw.githubusercontent.com/$Repo/main/scripts/install.ps1" | iex
}

Write-Host "[INFO] Migrating from gambiarra to gambi" -ForegroundColor Green
Try-RemoveLegacyPackages
Try-RemoveLegacyBinary
Try-MigrateConfig
Install-NewCli
Write-Host "[INFO] Migration complete. Run 'gambi --help' to verify." -ForegroundColor Green

# Create vendor/frontend-fonts-bundle.zip for single-file upload.
$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "../..")
$BundleRoot = Join-Path $Root "vendor/frontend-fonts"
$Archive = Join-Path $Root "vendor/frontend-fonts-bundle.zip"

& (Join-Path $PSScriptRoot "pack.ps1")

if (-not (Test-Path $BundleRoot)) {
    Write-Error "Bundle directory not found: $BundleRoot"
}

if (Test-Path $Archive) {
    Remove-Item -Force $Archive
}

Compress-Archive -Path (Join-Path $BundleRoot "*") -DestinationPath $Archive -Force
Write-Host "Created $Archive"

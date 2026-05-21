# Extract vendor/frontend-fonts-bundle.zip then install into frontend/.
$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "../..")
$Archive = Join-Path $Root "vendor/frontend-fonts-bundle.zip"
$BundleRoot = Join-Path $Root "vendor/frontend-fonts"

if (-not (Test-Path $Archive)) {
    Write-Error "Missing $Archive"
}

if (Test-Path $BundleRoot) {
    Remove-Item -Recurse -Force $BundleRoot
}

Expand-Archive -Path $Archive -DestinationPath $BundleRoot -Force
& (Join-Path $PSScriptRoot "install.ps1")

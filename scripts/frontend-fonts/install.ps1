# Restore vendor/frontend-fonts into frontend/ before offline Docker build.
$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "../..")
$BundleRoot = Join-Path $Root "vendor/frontend-fonts"
$SourceFonts = Join-Path $BundleRoot "public/fonts"
$SourceCss = Join-Path $BundleRoot "src/app/google-sans-local.css"
$DestFonts = Join-Path $Root "frontend/public/fonts"
$DestCss = Join-Path $Root "frontend/src/app/google-sans-local.css"

if (-not (Test-Path $SourceFonts)) {
    Write-Error "Missing bundle: $SourceFonts. Upload vendor/frontend-fonts first."
}

$pdfFont = Join-Path $SourceFonts "SourceHanSansSC-VF.ttf"
if (-not (Test-Path $pdfFont)) {
    Write-Error "Missing PDF font in bundle: $pdfFont"
}

if (-not (Test-Path $SourceCss)) {
    Write-Error "Missing CSS in bundle: $SourceCss"
}

New-Item -ItemType Directory -Force -Path $DestFonts | Out-Null

Write-Host "Installing fonts from $BundleRoot ..."
Copy-Item -Path (Join-Path $SourceFonts "*") -Destination $DestFonts -Recurse -Force
Copy-Item -Path $SourceCss -Destination $DestCss -Force

Write-Host "Done. Fonts installed under frontend/public/fonts and google-sans-local.css updated."

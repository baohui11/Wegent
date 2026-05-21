# Pack frontend fonts into vendor/frontend-fonts for offline upload.
$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "../..")
$SourceFonts = Join-Path $Root "frontend/public/fonts"
$SourceCss = Join-Path $Root "frontend/src/app/google-sans-local.css"
$BundleRoot = Join-Path $Root "vendor/frontend-fonts"
$DestFonts = Join-Path $BundleRoot "public/fonts"
$DestCssDir = Join-Path $BundleRoot "src/app"
$DestCss = Join-Path $DestCssDir "google-sans-local.css"

if (-not (Test-Path $SourceFonts)) {
    Write-Error "Missing $SourceFonts. Run: cd frontend && npm run download-fonts"
}

$pdfFont = Join-Path $SourceFonts "SourceHanSansSC-VF.ttf"
if (-not (Test-Path $pdfFont)) {
    Write-Error "Missing PDF font: $pdfFont"
}

$googleSansDir = Join-Path $SourceFonts "google-sans"
if (-not (Test-Path $googleSansDir)) {
    Write-Error "Missing UI fonts directory: $googleSansDir"
}

if (-not (Test-Path $SourceCss)) {
    Write-Error "Missing $SourceCss. Run: cd frontend && npm run download-fonts"
}

New-Item -ItemType Directory -Force -Path $DestFonts | Out-Null
New-Item -ItemType Directory -Force -Path $DestCssDir | Out-Null

Write-Host "Copying fonts to $BundleRoot ..."
Remove-Item -Recurse -Force (Join-Path $DestFonts "*") -ErrorAction SilentlyContinue
Copy-Item -Path (Join-Path $SourceFonts "*") -Destination $DestFonts -Recurse -Force
Copy-Item -Path $SourceCss -Destination $DestCss -Force

Write-Host "Done. Upload vendor/frontend-fonts/ (or run archive.ps1) to the intranet."

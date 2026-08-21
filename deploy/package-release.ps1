param(
  [string]$OutputDir = "."
)

$ErrorActionPreference = "Stop"

$stamp = Get-Date -Format yyyyMMddHHmmss
$archiveName = "wallpaper-manager-deploy-$stamp.tar.gz"
$archivePath = Join-Path $OutputDir $archiveName

tar `
  --exclude='./node_modules' `
  --exclude='./apps/*/node_modules' `
  --exclude='./apps/*/dist' `
  --exclude='./packages/*/dist' `
  --exclude='./storage' `
  --exclude='./.runs' `
  --exclude='./.tmp-*' `
  --exclude='./apps/api/.env' `
  --exclude='./.env' `
  --exclude='./old-covers.js' `
  --exclude='./admin-login-smoke.png' `
  --exclude='./wallpaper-manager-deploy-*.tar.gz' `
  -czf $archivePath .

Get-Item $archivePath | Select-Object FullName, Length

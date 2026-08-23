param(
  [string]$OutputDir = "."
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $OutputDir)) {
  New-Item -ItemType Directory -Path $OutputDir | Out-Null
}

# Build workspaces before archiving so the manual deployment archive is
# self-contained: bootstrap-server.sh intentionally does not rebuild on the
# production host, it only installs API runtime dependencies.
npm run build

$stamp = Get-Date -Format yyyyMMddHHmmss
$archiveName = "wallpaper-manager-deploy-$stamp.tar.gz"
$archivePath = Join-Path $OutputDir $archiveName

tar `
  --exclude='./.git' `
  --exclude='./.github' `
  --exclude='./node_modules' `
  --exclude='./apps/*/node_modules' `
  --exclude='./packages/*/node_modules' `
  --exclude='./storage' `
  --exclude='./.runs' `
  --exclude='./.tmp-*' `
  --exclude='./apps/api/.env' `
  --exclude='./.env' `
  --exclude='./old-covers.js' `
  --exclude='./*-smoke.png' `
  --exclude='./bt-*.png' `
  --exclude='./github-*.png' `
  --exclude='./wallpaper-manager-deploy-*.tar.gz' `
  -czf $archivePath .

Get-Item $archivePath | Select-Object FullName, Length

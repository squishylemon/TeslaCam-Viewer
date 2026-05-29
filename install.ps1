# Download the newest release zip (including prereleases) and run setup.
param(
  [string]$Repo = 'squishylemon/TeslaCam-Viewer',
  [string]$WorkDir = 'teslacam-release',
  [string]$Zip = 'teslacam.zip'
)

$ErrorActionPreference = 'Stop'
$headers = @{ 'User-Agent' = 'teslacam-installer' }

$api = "https://api.github.com/repos/$Repo/releases?per_page=30"
$releases = Invoke-RestMethod -Headers $headers -Uri $api

$asset = $null
foreach ($rel in $releases) {
  foreach ($a in $rel.assets) {
    if ($a.name -like 'teslacam-viewer-*.zip') {
      $asset = $a
      break
    }
  }
  if ($asset) { break }
}

if (-not $asset) {
  throw "No teslacam-viewer-*.zip asset found for $Repo. Check https://github.com/$Repo/releases"
}

Write-Host "Downloading release zip..."
Invoke-WebRequest -Headers $headers -Uri $asset.browser_download_url -OutFile $Zip

if (Test-Path $WorkDir) { Remove-Item -Recurse -Force $WorkDir }
Expand-Archive -Path $Zip -DestinationPath $WorkDir -Force

$setup = Join-Path $WorkDir 'setup.ps1'
if (-not (Test-Path $setup)) {
  throw 'Zip is missing setup.ps1.'
}

Set-Location $WorkDir
& $setup @args

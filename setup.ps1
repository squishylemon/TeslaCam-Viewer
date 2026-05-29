# Auto-detect LAN IP (ipconfig), write config.env, start Docker stack.
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
Set-Location $root

$config = Join-Path $root 'config.env'
$example = Join-Path $root 'config.env.example'

function Test-LanIp([string]$Ip) {
  if ([string]::IsNullOrWhiteSpace($Ip)) { return $false }
  if ($Ip -notmatch '^\d{1,3}(\.\d{1,3}){3}$') { return $false }
  if ($Ip -match '^127\.') { return $false }
  if ($Ip -match '^169\.254\.') { return $false }
  if ($Ip -match '^192\.168\.65\.') { return $false }
  if ($Ip -match '^172\.(17|18)\.') { return $false }
  return $true
}

function Get-LanIpRank([string]$Ip) {
  if ($Ip -match '^192\.168\.(?!65\.)') { return 100 }
  if ($Ip -match '^10\.') { return 80 }
  if ($Ip -match '^172\.(1[6-9]|2\d|3[01])\.') { return 60 }
  return 10
}

function Get-LanIpFromIpconfig {
  $candidates = @()

  try {
    $addrs = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
      Where-Object { $_.PrefixOrigin -ne 'WellKnown' -and $_.IPAddress }
    foreach ($a in $addrs) {
      if (Test-LanIp $a.IPAddress) { $candidates += $a.IPAddress }
    }
  } catch {
    $blocks = (ipconfig) -join "`n" -split '(?=\r?\n\S)'
    foreach ($block in $blocks) {
      if ($block -notmatch '(?i)(Wi-?Fi|Wireless|Ethernet|LAN)') { continue }
      if ($block -match '(?i)disconnected|media disconnected') { continue }
      foreach ($m in [regex]::Matches($block, '(?i)IPv4[^:\r\n]*:\s*([\d.]+)')) {
        if (Test-LanIp $m.Groups[1].Value) { $candidates += $m.Groups[1].Value }
      }
    }
    if ($candidates.Count -eq 0) {
      foreach ($m in [regex]::Matches((ipconfig) -join "`n", '(?i)IPv4[^:\r\n]*:\s*([\d.]+)')) {
        if (Test-LanIp $m.Groups[1].Value) { $candidates += $m.Groups[1].Value }
      }
    }
  }

  $best = $candidates | Select-Object -Unique | Sort-Object { Get-LanIpRank $_ } -Descending | Select-Object -First 1
  return $best
}

function New-SessionSecret {
  return -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 48 | ForEach-Object { [char]$_ })
}

function Update-ConfigEnv([string]$LanIp) {
  if (-not (Test-Path $example)) {
    throw 'config.env.example is missing.'
  }
  if (-not (Test-Path $config)) {
    Copy-Item $example $config
  }

  $lines = Get-Content $config -Encoding UTF8
  $hasLan = $false
  $hasSecret = $false
  $hasHttps = $false
  $out = foreach ($line in $lines) {
    if ($line -match '^\s*LAN_IP\s*=') {
      $hasLan = $true
      "LAN_IP=$LanIp"
    } elseif ($line -match '^\s*SESSION_SECRET\s*=') {
      $hasSecret = $true
      $val = ($line -split '=', 2)[1].Trim()
      if ([string]::IsNullOrWhiteSpace($val) -or $val -eq 'change-me-use-a-long-random-string') {
        "SESSION_SECRET=$(New-SessionSecret)"
      } else {
        $line
      }
    } else {
      if ($line -match '^\s*USE_HTTPS\s*=') { $hasHttps = $true }
      $line
    }
  }
  if (-not $hasLan) { $out += "LAN_IP=$LanIp" }
  if (-not $hasSecret) { $out += "SESSION_SECRET=$(New-SessionSecret)" }
  if (-not $hasHttps) { $out += 'USE_HTTPS=false' }
  Set-Content -Path $config -Value $out -Encoding UTF8
}

function Start-HostMdns {
  $pidFile = Join-Path $root '.host-mdns.pid'
  if (Test-Path $pidFile) {
    $oldPid = Get-Content $pidFile -ErrorAction SilentlyContinue
    if ($oldPid -match '^\d+$') {
      Stop-Process -Id ([int]$oldPid) -Force -ErrorAction SilentlyContinue
    }
  }
  $bonjourPath = Join-Path $root 'node_modules\bonjour-service'
  if (-not (Test-Path $bonjourPath)) {
    Write-Host 'Installing dependencies for host mDNS...'
    npm install --omit=dev 2>&1 | Out-Null
  }
  $proc = Start-Process -FilePath 'node' -ArgumentList 'scripts/host-mdns.mjs' -WorkingDirectory $root -PassThru -WindowStyle Hidden
  $proc.Id | Set-Content $pidFile -Encoding ASCII
  Write-Host ('Host mDNS started (PID {0}) - teslacam.local on your LAN' -f $proc.Id)
}

$lanIp = Get-LanIpFromIpconfig
if (-not $lanIp) {
  Write-Error 'Could not detect a LAN IPv4 address from ipconfig. Set LAN_IP manually in config.env.'
}

Write-Host "Using LAN_IP=$lanIp"
Update-ConfigEnv -LanIp $lanIp

Write-Host 'Starting containers (docker compose up -d --build)...'
docker compose up -d --build

Start-HostMdns

$port = '4321'
$portMatch = Select-String -Path $config -Pattern '^\s*WEB_PORT\s*=\s*(\d+)' | Select-Object -First 1
if ($portMatch) {
  $port = $portMatch.Matches[0].Groups[1].Value
}
$https = [bool](Select-String -Path $config -Pattern '^\s*USE_HTTPS\s*=\s*true' -Quiet)
$proto = if ($https) { 'https' } else { 'http' }

Write-Host ''
Write-Host '=== Open the site (like Home Assistant) ===' -ForegroundColor Green
Write-Host ('  {0}://teslacam.local:{1}' -f $proto, $port) -ForegroundColor Cyan
Write-Host ('  {0}://{1}:{2}' -f $proto, $lanIp, $port)
if ($https) {
  Write-Host '  Accept the certificate warning on first visit.'
}
Write-Host ''
Write-Host 'Passkeys: set USE_HTTPS=true in config.env, then run:'
Write-Host '  docker compose up -d --force-recreate web'

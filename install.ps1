# Install dk, the DKOD plugin manager, on Windows, then the DKOD plugin. In PowerShell:
#   irm https://raw.githubusercontent.com/dkod-ai/dkod-plugin/main/install.ps1 | iex
#
# dk is one small program (dk.exe, written in Rust): it needs no Git Bash. This script downloads it from the
# dk release on github.com/dkod-ai/dkod-plugin, checks it against the release's SHA256SUMS, puts it in
# %USERPROFILE%\.local\bin, adds that folder to your user PATH, and runs `dk install`. The same settings
# work as on macOS and Linux:
#   $env:DKOD_AGENT = "claude,cursor,codex,copilot" or "all"   $env:DKOD_CHANNEL = "stable" or "nightly"
# It needs no administrator rights. Everything runs in one script block, so a failure never closes your window.
& {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

  function Say-Fail([string]$text) { Write-Host "x $text" -ForegroundColor Red }
  function Say-Ok([string]$text) { Write-Host "+ $text" -ForegroundColor Green }

  $repo = if ($env:DKOD_PLUGIN_REPO) { $env:DKOD_PLUGIN_REPO } else { 'dkod-ai/dkod-plugin' }
  $binDir = if ($env:DKOD_BIN_DIR) { $env:DKOD_BIN_DIR } else { Join-Path $HOME '.local\bin' }
  $asset = 'dk-x86_64-pc-windows-msvc.exe'

  New-Item -ItemType Directory -Force -Path $binDir | Out-Null
  $dk = Join-Path $binDir 'dk.exe'
  $tmp = Join-Path $binDir ".dk.$([guid]::NewGuid().ToString('N')).exe"
  try {
    if ($env:DKOD_DK_SOURCE) {
      # A local dk.exe instead of the download (the CI test uses it).
      Copy-Item -LiteralPath $env:DKOD_DK_SOURCE -Destination $tmp
    } else {
      # The version comes from dk-version on the channel's branch. Before the first stable release with a
      # dk-version, stable takes main's.
      $ref = if ($env:DKOD_CHANNEL -eq 'nightly') { 'main' } else { 'stable' }
      try {
        $version = (Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/$repo/$ref/dk-version").Content
      } catch {
        $version = (Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/$repo/main/dk-version").Content
      }
      if ($version -is [byte[]]) { $version = [Text.Encoding]::UTF8.GetString($version) }
      $version = "$version".Trim()
      if ($version -notmatch '^\d+\.\d+\.\d+$') { Say-Fail "Could not read the dk version from github.com/$repo. Try again later."; return }
      $base = "https://github.com/$repo/releases/download/dk-v$version"
      Invoke-WebRequest -UseBasicParsing -Uri "$base/$asset" -OutFile $tmp
      $sums = (Invoke-WebRequest -UseBasicParsing -Uri "$base/SHA256SUMS").Content
      if ($sums -is [byte[]]) { $sums = [Text.Encoding]::UTF8.GetString($sums) }
      $want = ($sums -split "`n" | ForEach-Object { $f = $_.Trim() -split '\s+'; if ($f.Count -ge 2 -and $f[1].TrimStart('*') -eq $asset) { $f[0] } } | Select-Object -First 1)
      $got = (Get-FileHash -Algorithm SHA256 -LiteralPath $tmp).Hash
      if (-not $want -or $want.ToLower() -ne $got.ToLower()) { Say-Fail 'The download of dk did not match its checksum. Nothing was changed.'; return }
    }
    # A running dk.exe cannot be overwritten, but it can be renamed; dk deletes the old one next time.
    if (Test-Path -LiteralPath $dk) { Move-Item -LiteralPath $dk -Destination (Join-Path $binDir "dk.exe.old.$([guid]::NewGuid().ToString('N'))") -Force }
    Move-Item -LiteralPath $tmp -Destination $dk -Force
  } catch {
    Say-Fail "Could not download dk from github.com/$repo. Check your connection and try again. ($($_.Exception.Message))"
    return
  } finally {
    if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force }
  }

  # The dk from before 1.6.0 ran in Git Bash through dk.cmd: dk.exe takes its place.
  foreach ($old in @('dk', 'dk.cmd')) {
    $p = Join-Path $binDir $old
    if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue }
  }

  # The user PATH, for every new terminal, and this session's, so dk works at once.
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  $parts = @($userPath -split ';' | Where-Object { $_ })
  if ($parts -notcontains $binDir) {
    [Environment]::SetEnvironmentVariable('Path', (@($binDir) + $parts) -join ';', 'User')
    Say-Ok "Added $binDir to your PATH."
  }
  if (@($env:Path -split ';') -notcontains $binDir) { $env:Path = "$binDir;$env:Path" }

  & $dk install
}

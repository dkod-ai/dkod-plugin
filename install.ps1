# Install dk, the DKOD plugin manager, on Windows, then the DKOD plugin. In PowerShell:
#   irm https://raw.githubusercontent.com/dkod-ai/dkod-plugin/main/install.ps1 | iex
#
# dk is a POSIX shell script. On Windows it runs in Git Bash, from Git for Windows (Claude Code on Windows
# needs it too). This script finds Git Bash, puts dk and a dk.cmd launcher in %USERPROFILE%\.local\bin, adds
# that folder to your user PATH, and runs `dk install`. The same settings work as on macOS and Linux:
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

  # Git Bash: never WSL's bash.exe in System32, which runs a Linux and sees another home folder.
  function Find-GitBash {
    if ($env:DKOD_BASH -and (Test-Path $env:DKOD_BASH)) { return $env:DKOD_BASH }
    $roots = @()
    $git = Get-Command git.exe -ErrorAction SilentlyContinue
    if ($git) {
      $dir = Split-Path $git.Source
      for ($i = 0; $i -lt 4 -and $dir; $i++) { $roots += $dir; $dir = Split-Path $dir }
    }
    $roots += @("$env:ProgramFiles\Git", "${env:ProgramFiles(x86)}\Git", "$env:LOCALAPPDATA\Programs\Git")
    foreach ($root in $roots) {
      $bash = Join-Path $root 'bin\bash.exe'
      if ($root -and (Test-Path $bash)) { return (Resolve-Path $bash).Path }
    }
    return $null
  }

  $bash = Find-GitBash
  if (-not $bash) {
    Say-Fail 'dk needs Git Bash, from Git for Windows. Install it, open a new PowerShell and run this line again:'
    Write-Host '  winget install --id Git.Git -e'
    return
  }

  # dk comes from the branch of the chosen channel. Before the first release with dk in it, stable has
  # no dk, so main's is used. DKOD_DK_SOURCE names a local file instead (the CI test uses it).
  New-Item -ItemType Directory -Force -Path $binDir | Out-Null
  $dk = Join-Path $binDir 'dk'
  $tmp = Join-Path $binDir ".dk.$([guid]::NewGuid().ToString('N'))"
  try {
    if ($env:DKOD_DK_SOURCE) {
      Copy-Item -LiteralPath $env:DKOD_DK_SOURCE -Destination $tmp
    } else {
      $ref = if ($env:DKOD_CHANNEL -eq 'nightly') { 'main' } else { 'stable' }
      try {
        Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/$repo/$ref/dk" -OutFile $tmp
      } catch {
        Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/$repo/main/dk" -OutFile $tmp
      }
    }
    $head = Get-Content -LiteralPath $tmp -TotalCount 1
    if ($head -ne '#!/bin/sh' -or -not (Select-String -LiteralPath $tmp -Pattern '^DK_VERSION=' -Quiet)) {
      Say-Fail 'The download is not dk. Nothing was changed.'
      return
    }
    Move-Item -LiteralPath $tmp -Destination $dk -Force
  } catch {
    Say-Fail "Could not download dk from github.com/$repo. Check your connection and try again. ($($_.Exception.Message))"
    return
  } finally {
    if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force }
  }

  # dk.cmd lets cmd and PowerShell run `dk ...`: it hands dk to Git Bash.
  Set-Content -LiteralPath (Join-Path $binDir 'dk.cmd') -Encoding ASCII -Value @(
    '@echo off',
    "`"$bash`" `"%~dp0dk`" %*"
  )

  # The user PATH, for every new terminal, and this session's, so dk works at once.
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  $parts = @($userPath -split ';' | Where-Object { $_ })
  if ($parts -notcontains $binDir) {
    [Environment]::SetEnvironmentVariable('Path', (@($binDir) + $parts) -join ';', 'User')
    Say-Ok "Added $binDir to your PATH."
  }
  if (@($env:Path -split ';') -notcontains $binDir) { $env:Path = "$binDir;$env:Path" }

  # dk reads its answers from the console when Git Bash has no /dev/tty.
  & $bash $dk install
}

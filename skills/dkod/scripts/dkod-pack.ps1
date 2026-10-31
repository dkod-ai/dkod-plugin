# DKO-1020: pack an app folder into the ustar archive DKOD's worker reads, and upload it.
# For builders who do not use git. Windows PowerShell 5.1 or pwsh 7, nothing to install.
# dkod-pack.mjs, .py and .sh do the same thing byte for byte (same files, same headers, same
# sha256); keep the four in step. ASCII only: 5.1 reads a file without a BOM as ANSI.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File dkod-pack.ps1 pack [<folder>]
#   powershell -NoProfile -ExecutionPolicy Bypass -File dkod-pack.ps1 put <file> --ticket <ticket>
#
# DKO-1382: the agent holds only the one-use upload_ticket from dkoder.source.target. `put` trades
# it at POST /api/v1/dkoder/source/put-args for put_args (single-quoted words, the URL first, then
# 'Name: value' headers), so the signed URL never reaches the agent's screen. No URL, --args or stdin.
#
# The upload URL is a signed credential: never printed.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2

$MaxFiles = 20000
$MaxFileBytes = 4 * 1024 * 1024
$MaxTotalBytes = 64 * 1024 * 1024
$SkipDirs = @('.git', 'node_modules', 'dist', 'build', '.next', 'out', '.turbo', '.cache', 'coverage', 'venv', '.venv', '__pycache__', 'test-results', 'playwright-report', 'graphify-out')
$OnWindows = ($PSVersionTable.PSVersion.Major -lt 6) -or $IsWindows
$Utf8 = New-Object System.Text.UTF8Encoding($false)
$Usage = 'usage: dkod-pack pack [<folder>] | put <file> --ticket <upload_ticket>'
$NoPut = 'refused: use --ticket <upload_ticket> from dkoder.source.target; an upload URL, --args and stdin are not accepted'
$BadTicket = 'refused: the upload ticket is not valid; call dkoder.source.target again'
$Expired = 'upload failed: the upload ticket expired or was already used. Call dkoder.source.target again for a new one, then run put with the new --ticket.'
$BadArgs = 'refused: put_args must be single-quoted words, the URL first'

class Refusal : System.Exception {
  Refusal([string]$message) : base($message) {}
}

function Fail([string]$message) { throw [Refusal]::new($message) }

function JsonString([string]$s) {
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.Append('"')
  foreach ($c in $s.ToCharArray()) {
    $n = [int]$c
    if ($c -eq '"') { [void]$sb.Append('\"') }
    elseif ($c -eq '\') { [void]$sb.Append('\\') }
    elseif ($n -lt 32) { [void]$sb.Append(('\u{0:x4}' -f $n)) }
    else { [void]$sb.Append($c) }
  }
  [void]$sb.Append('"')
  return $sb.ToString()
}

# Whether a file system entry is a symlink or junction (a OneDrive placeholder is neither).
function IsLink($item) {
  if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -eq 0) { return $false }
  $linkType = (Get-Item -LiteralPath $item.FullName -Force).LinkType
  return ($linkType -eq 'SymbolicLink') -or ($linkType -eq 'Junction')
}

# Run git with its output read as UTF-8 bytes, whatever the console code page is.
function RunGit([string]$cwd, [string[]]$gitArgs) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = 'git'
  $psi.Arguments = ($gitArgs -join ' ')
  $psi.WorkingDirectory = $cwd
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.StandardOutputEncoding = $Utf8
  $p = [System.Diagnostics.Process]::Start($psi)
  $errTask = $p.StandardError.ReadToEndAsync()
  $out = $p.StandardOutput.ReadToEnd()
  $p.WaitForExit()
  [void]$errTask.Result
  return @{ Code = $p.ExitCode; Out = $out }
}

# False for the macOS stub git: the first git on PATH is /usr/bin/git and xcode-select names no
# developer folder with a git in it. With no Apple developer tools, running the stub opens Apple's
# install window. No xcode-select on PATH: not a Mac, and git is real.
function RealGit([string]$path) {
  if ($OnWindows -or ([System.IO.Path]::GetDirectoryName($path) -ne '/usr/bin')) { return $true }
  $select = Get-Command xcode-select -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $select) { return $true }
  try {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $select.Source
    $psi.Arguments = '-p'
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $p = [System.Diagnostics.Process]::Start($psi)
    $errTask = $p.StandardError.ReadToEndAsync()
    $dev = $p.StandardOutput.ReadToEnd().Trim()
    $p.WaitForExit()
    [void]$errTask.Result
  } catch { return $true }
  if ($p.ExitCode -ne 0 -or $dev -eq '') { return $false }
  return Test-Path -LiteralPath (Join-Path $dev 'usr/bin/git')
}

function InGitTree([string]$root) {
  $git = Get-Command git -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $git) { return $false }
  if (-not (RealGit $git.Source)) { return $false }
  try { $r = RunGit $root @('rev-parse', '--is-inside-work-tree') } catch { return $false }
  return ($r.Code -eq 0) -and ($r.Out.Trim() -eq 'true')
}

# DKO-1095: folder name, branch, short commit, commit time and uncommitted count, for the preflight
# line. $null outside git or before the first commit. Never a remote.
function GitFacts([string]$root) {
  if (-not (InGitTree $root)) { return $null }
  try {
    $head = RunGit $root @('rev-parse', '--short', 'HEAD')
    $at = RunGit $root @('log', '-1', '--format=%ct')
    $status = RunGit $root @('status', '--porcelain', '--', '.')
    $br = RunGit $root @('rev-parse', '--abbrev-ref', 'HEAD')
  } catch { return $null }
  if ($head.Code -ne 0 -or $at.Code -ne 0 -or $status.Code -ne 0) { return $null }
  $h = $head.Out.Trim()
  $t = $at.Out.Trim()
  if (($h -notmatch '^[0-9a-f]{7,40}$') -or ($t -notmatch '^[0-9]+$')) { return $null }
  $branch = if ($br.Code -eq 0) { $br.Out.Trim() } else { 'HEAD' }
  $dirty = @($status.Out.Split("`n") | Where-Object { $_.Trim() -ne '' }).Count
  return '{"folder":' + (JsonString (Split-Path -Leaf $root)) + ',"branch":' + (JsonString $branch) + ',"head":"' + $h + '","head_at":' + $t + ',"dirty":' + $dirty + '}'
}

# DKO-1407: outside git, the root .gitignore: plain names, `dir/`, `/anchored`, `a/b`, `*` and `?`.
# No negation, no `**`, no nested .gitignore. A name matches any segment; a `dir/` pattern only a
# folder (a non-final segment); an anchored one a leading run of segments.
function GlobRegex([string]$s) {
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.Append('^')
  foreach ($c in $s.ToCharArray()) {
    if ($c -eq '*') { [void]$sb.Append('[^/]*') }
    elseif ($c -eq '?') { [void]$sb.Append('[^/]') }
    else { [void]$sb.Append([regex]::Escape([string]$c)) }
  }
  [void]$sb.Append('$')
  return New-Object System.Text.RegularExpressions.Regex($sb.ToString(), [System.Text.RegularExpressions.RegexOptions]::Singleline)
}

function IgnoreRules([string]$root) {
  $rules = New-Object System.Collections.Generic.List[object]
  $file = Join-Path $root '.gitignore'
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { return ,$rules }
  try { $text = $Utf8.GetString([System.IO.File]::ReadAllBytes($file)) } catch { return ,$rules }
  foreach ($raw in $text.Split("`n")) {
    $line = $raw.Trim(" `t`r")
    if ($line -eq '' -or $line.StartsWith('#') -or $line.StartsWith('!')) { continue }
    $dirOnly = $line.EndsWith('/')
    $anchored = $line.TrimEnd('/').Contains('/')
    $parts = New-Object System.Collections.Generic.List[object]
    foreach ($s in $line.Split('/')) { if ($s -ne '') { $parts.Add((GlobRegex $s)) } }
    if ($parts.Count -gt 0) { $rules.Add(@{ DirOnly = $dirOnly; Anchored = $anchored; Parts = $parts }) }
  }
  return ,$rules
}

function IsIgnored([string]$path, $rules) {
  $segs = $path.Split('/')
  foreach ($r in $rules) {
    if (-not $r.Anchored) {
      for ($i = 0; $i -lt $segs.Length; $i++) {
        if ((-not $r.DirOnly -or $i -lt $segs.Length - 1) -and $r.Parts[0].IsMatch($segs[$i])) { return $true }
      }
      continue
    }
    $k = $r.Parts.Count
    if ($r.DirOnly) { if ($k -ge $segs.Length) { continue } } elseif ($k -gt $segs.Length) { continue }
    $all = $true
    for ($i = 0; $i -lt $k; $i++) { if (-not $r.Parts[$i].IsMatch($segs[$i])) { $all = $false; break } }
    if ($all) { return $true }
  }
  return $false
}

# Candidate paths, relative to root with forward slashes, before the common filters.
function Candidates([string]$root) {
  $list = New-Object System.Collections.Generic.List[string]
  if (InGitTree $root) {
    $r = RunGit $root @('ls-files', '-co', '--exclude-standard', '-z')
    if ($r.Code -ne 0) { Fail 'git ls-files failed' }
    foreach ($p in $r.Out.Split([char]0)) {
      if ($p -ne '' -and -not $p.EndsWith('/')) { $list.Add($p) }
    }
    return ,$list
  }
  $stack = New-Object System.Collections.Generic.Stack[object]
  $stack.Push(@((Get-Item -LiteralPath $root -Force), ''))
  while ($stack.Count -gt 0) {
    $top = $stack.Pop()
    foreach ($e in (Get-ChildItem -LiteralPath $top[0].FullName -Force)) {
      $rel = if ($top[1] -eq '') { $e.Name } else { $top[1] + '/' + $e.Name }
      if (IsLink $e) { continue }
      if ($e.PSIsContainer) {
        if ($SkipDirs -notcontains $e.Name) { $stack.Push(@($e, $rel)) }
      } else { $list.Add($rel) }
    }
  }
  $rules = IgnoreRules $root
  if ($rules.Count -eq 0) { return ,$list }
  $kept = New-Object System.Collections.Generic.List[string]
  foreach ($p in $list) { if (-not (IsIgnored $p $rules)) { $kept.Add($p) } }
  return ,$kept
}

function CheckPath([string]$path) {
  $bad = $path.StartsWith('/') -or $path.Contains('\') -or ($path -match '[\x00-\x1f\x7f]')
  foreach ($s in $path.Split('/')) { if ($s -eq '' -or $s -eq '.' -or $s -eq '..') { $bad = $true } }
  if ($bad) { Fail "path not allowed: $path" }
}

function Ascii([byte[]]$h, [int]$at, [string]$s) {
  $b = [System.Text.Encoding]::ASCII.GetBytes($s)
  [Array]::Copy($b, 0, $h, $at, $b.Length)
}

function Header([byte[]]$name, [byte[]]$prefix, [string]$mode, [long]$size) {
  $h = New-Object byte[] 512
  [Array]::Copy($name, 0, $h, 0, $name.Length)
  Ascii $h 100 "$mode`0"
  Ascii $h 108 "0000000`0"
  Ascii $h 116 "0000000`0"
  Ascii $h 124 ([Convert]::ToString($size, 8).PadLeft(11, '0') + "`0")
  Ascii $h 136 "00000000000`0"
  Ascii $h 148 '        '
  Ascii $h 156 '0'
  Ascii $h 257 "ustar`0"
  Ascii $h 263 '00'
  [Array]::Copy($prefix, 0, $h, 345, $prefix.Length)
  $sum = 0
  foreach ($b in $h) { $sum += $b }
  Ascii $h 148 ([Convert]::ToString($sum, 8).PadLeft(6, '0') + "`0 ")
  return ,$h
}

function Slice([byte[]]$b, [int]$from, [int]$count) {
  $o = New-Object byte[] $count
  [Array]::Copy($b, $from, $o, 0, $count)
  return ,$o
}

# ustar's name/prefix split at the leftmost / that leaves a name of at most 100 bytes.
function SplitPath([string]$path, [byte[]]$raw) {
  if ($raw.Length -gt 255) { Fail "path too long (over 255 bytes): $path" }
  if ($raw.Length -le 100) { return @{ Name = $raw; Prefix = (New-Object byte[] 0) } }
  for ($i = 0; $i -lt $raw.Length; $i++) {
    if ($raw[$i] -ne 0x2f -or ($raw.Length - $i - 1) -gt 100) { continue }
    if ($i -gt 155) { break }
    return @{ Name = (Slice $raw ($i + 1) ($raw.Length - $i - 1)); Prefix = (Slice $raw 0 $i) }
  }
  Fail "path cannot be stored in ustar (prefix 155 / name 100 bytes): $path"
}

function Pack([string]$folder) {
  $root = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine((Get-Location -PSProvider FileSystem).ProviderPath, $folder))
  if (-not [System.IO.Directory]::Exists($root)) { Fail "not a folder: $root" }

  $entries = New-Object System.Collections.Generic.List[object]
  foreach ($path in (Candidates $root)) {
    $segments = $path.Split('/')
    $skip = $false
    foreach ($s in $segments) { if ($s.ToLowerInvariant() -eq '.git') { $skip = $true } }
    if ($skip -or $segments[$segments.Length - 1].StartsWith('.env', [StringComparison]::Ordinal)) { continue }
    $full = [System.IO.Path]::Combine($root, ($segments -join [System.IO.Path]::DirectorySeparatorChar))
    $fi = New-Object System.IO.FileInfo($full)
    if (-not $fi.Exists) { continue }
    if (IsLink $fi) { continue }
    CheckPath $path
    $exec = $false
    if (-not $OnWindows) {
      # GetUnixFileMode is .NET 7+ (pwsh 7.3+); older pwsh has the ls-style UnixMode string.
      try { $exec = ([int][System.IO.File]::GetUnixFileMode($full) -band 73) -ne 0 }
      catch { $exec = (Get-Item -LiteralPath $full -Force).UnixMode -match '^...[xst]|^......[xst]|^.........[xst]' }
    }
    $raw = $Utf8.GetBytes($path)
    # Sort by UTF-8 bytes like the other scripts: ordinal order of the lowercase hex is byte order.
    $key = ([BitConverter]::ToString($raw)).Replace('-', '').ToLowerInvariant()
    $entries.Add(@{ Key = $key; Path = $path; Raw = $raw; Full = $full; Exec = $exec })
  }
  if ($entries.Count -eq 0) { Fail "no files to pack in $root" }
  if ($entries.Count -gt $MaxFiles) { Fail "too many files: $($entries.Count) (the cap is $MaxFiles)" }
  $entries.Sort([Comparison[object]] { param($a, $b) [string]::CompareOrdinal($a.Key, $b.Key) })
  $entryArr = $entries.ToArray()

  $dir = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), 'dkod-src-' + [Guid]::NewGuid().ToString('N').Substring(0, 12))
  [void][System.IO.Directory]::CreateDirectory($dir)
  $out = [System.IO.Path]::Combine($dir, 'src.tar')
  $fs = [System.IO.File]::Open($out, [System.IO.FileMode]::CreateNew)
  try {
    $total = 0
    foreach ($e in $entryArr) {
      $split = SplitPath $e.Path $e.Raw
      $len = (New-Object System.IO.FileInfo($e.Full)).Length
      if ($len -gt $MaxFileBytes) { Fail "file too large: $($e.Path) (the cap is 4 MiB per file)" }
      $data = [System.IO.File]::ReadAllBytes($e.Full)
      if ($data.Length -gt $MaxFileBytes) { Fail "file too large: $($e.Path) (the cap is 4 MiB per file)" }
      $total += $data.Length
      if ($total -gt $MaxTotalBytes) { Fail 'folder too large (the cap is 64 MiB of files in total)' }
      $mode = if ($e.Exec) { '0000755' } else { '0000644' }
      $h = Header $split.Name $split.Prefix $mode $data.Length
      $fs.Write($h, 0, 512)
      $fs.Write($data, 0, $data.Length)
      $pad = (512 - ($data.Length % 512)) % 512
      if ($pad -gt 0) { $fs.Write((New-Object byte[] $pad), 0, $pad) }
    }
    $fs.Write((New-Object byte[] 1024), 0, 1024)
    $fs.Flush()
    $bytes = $fs.Length
    [void]$fs.Seek(0, [System.IO.SeekOrigin]::Begin)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $hex = ([BitConverter]::ToString($sha.ComputeHash($fs))).Replace('-', '').ToLowerInvariant()
    $fs.Dispose()
  } catch {
    $fs.Dispose()
    Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue
    throw
  }
  $git = GitFacts $root
  $tail = if ($null -eq $git) { '' } else { ',"git":' + $git }
  return '{"file":' + (JsonString $out) + ',"sha256":"' + $hex + '","bytes":' + $bytes + ',"files":' + $entryArr.Length + $tail + '}'
}

# The words of a put_args string: each one in single quotes, split by spaces. Never echoes the input.
function SplitPutArgs([string]$text) {
  $s = $text.Trim()
  $words = @()
  $i = 0
  while ($i -lt $s.Length) {
    if ($s[$i] -ne [char]39) { Fail $BadArgs }
    $end = $s.IndexOf([char]39, $i + 1)
    if ($end -lt 0) { Fail $BadArgs }
    $words += $s.Substring($i + 1, $end - $i - 1)
    $i = $end + 1
    while ($i -lt $s.Length -and [char]::IsWhiteSpace($s[$i])) { $i += 1 }
  }
  if ($words.Count -eq 0) { Fail $BadArgs }
  return , $words
}

# DKO-1382: trades the ticket ('<host>~<org>~<slot>~<secret>') for put_args. Never prints the ticket, the URL or the body.
function TradeTicket([string]$ticket) {
  $parts = $ticket.Split([char]126)
  $hostPart = $parts[0]
  if ($ticket -notmatch '^[A-Za-z0-9._:~\[\]-]+$') { Fail $BadTicket }
  if ($parts.Count -ne 4 -or $hostPart -notmatch '^[A-Za-z0-9.:\[\]-]+$') { Fail $BadTicket }
  $scheme = if ($hostPart -match '^(127\.0\.0\.1|localhost)(:\d+)?$') { 'http' } else { 'https' }
  if ($PSVersionTable.PSVersion.Major -lt 6) {
    Add-Type -AssemblyName System.Net.Http
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  }
  $handler = New-Object System.Net.Http.HttpClientHandler
  $handler.AllowAutoRedirect = $false
  $client = New-Object System.Net.Http.HttpClient($handler)
  $client.Timeout = [TimeSpan]::FromSeconds(60)
  try {
    $json = '{"ticket":"' + $ticket + '"}'
    $content = New-Object System.Net.Http.StringContent($json, $Utf8, 'application/json')
    try { $res = $client.PostAsync($scheme + '://' + $hostPart + '/api/v1/dkoder/source/put-args', $content).GetAwaiter().GetResult() } catch { Fail 'upload failed: could not connect' }
    $status = [int]$res.StatusCode
    $text = ''
    try { $text = $res.Content.ReadAsStringAsync().GetAwaiter().GetResult() } catch { }
    $res.Dispose()
  } finally {
    $client.Dispose()
  }
  if ($status -eq 404 -or $status -eq 410) { Fail $Expired }
  if ($status -ne 200) { Fail "upload failed: HTTP $status" }
  return , (SplitPutArgs $text)
}

function Put([string]$file, [string]$url, [string[]]$headerArgs) {
  $u = $null
  if (-not [Uri]::TryCreate($url, [UriKind]::Absolute, [ref]$u)) { Fail 'refused: the upload URL is not a valid URL' }
  if ($u.UserInfo -ne '') { Fail 'refused: the upload URL carries a user name' }
  $ok = ($u.Scheme -eq 'https') -or (($u.Scheme -eq 'http') -and (($u.Host -eq '127.0.0.1') -or ($u.Host -eq 'localhost')))
  if (-not $ok) { Fail 'refused: only https upload URLs are allowed' }
  $headers = @()
  foreach ($arg in $headerArgs) {
    $at = $arg.IndexOf(':')
    $name = if ($at -gt 0) { $arg.Substring(0, $at).Trim() } else { '' }
    if ($name -eq '') { Fail 'bad header argument (expected "Name: value")' }
    if ($name -ieq 'content-length') { continue }
    $headers += , @($name, $arg.Substring($at + 1).Trim())
  }
  $full = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine((Get-Location -PSProvider FileSystem).ProviderPath, $file))
  if (-not [System.IO.File]::Exists($full)) { Fail "cannot read $file" }

  if ($PSVersionTable.PSVersion.Major -lt 6) {
    Add-Type -AssemblyName System.Net.Http
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  }
  $handler = New-Object System.Net.Http.HttpClientHandler
  $handler.AllowAutoRedirect = $false
  $client = New-Object System.Net.Http.HttpClient($handler)
  $client.Timeout = [TimeSpan]::FromMinutes(10)
  $stream = [System.IO.File]::OpenRead($full)
  try {
    $req = New-Object System.Net.Http.HttpRequestMessage([System.Net.Http.HttpMethod]::Put, $u)
    $content = New-Object System.Net.Http.StreamContent($stream)
    $content.Headers.ContentLength = $stream.Length
    $req.Content = $content
    foreach ($h in $headers) {
      if (-not $req.Headers.TryAddWithoutValidation($h[0], $h[1])) {
        if (-not $content.Headers.TryAddWithoutValidation($h[0], $h[1])) { Fail "bad header: $($h[0])" }
      }
    }
    try { $res = $client.SendAsync($req).GetAwaiter().GetResult() } catch { Fail 'upload failed: could not connect' }
    $status = [int]$res.StatusCode
    $res.Dispose()
  } finally {
    $stream.Dispose()
    $client.Dispose()
  }
  # A 403 from S3 means the presigned link no longer works: it expired, or it was used.
  if ($status -eq 403) { Fail $Expired }
  if ($status -lt 200 -or $status -gt 299) { Fail "upload failed: HTTP $status" }
  [System.IO.File]::Delete($full)
  $dir = [System.IO.Path]::GetDirectoryName($full)
  if ([System.IO.Path]::GetFileName($dir).StartsWith('dkod-src-')) {
    try { [System.IO.Directory]::Delete($dir) } catch { }
  }
  return '{"ok":true,"status":' + $status + '}'
}

try {
  if ($args.Count -ge 1 -and $args[0] -eq 'pack' -and $args.Count -le 2) {
    $folder = if ($args.Count -eq 2) { [string]$args[1] } else { '.' }
    $line = Pack $folder
  } elseif ($args.Count -ge 2 -and $args[0] -eq 'put') {
    if (-not (($args.Count -eq 4) -and ([string]$args[2] -eq '--ticket'))) { Fail $NoPut }
    $words = [string[]](TradeTicket ([string]$args[3]))
    $rest = @()
    if ($words.Count -gt 1) { $rest = [string[]]($words[1..($words.Count - 1)]) }
    $line = Put ([string]$args[1]) $words[0] $rest
  } else {
    Fail $Usage
  }
} catch {
  $ex = $_.Exception
  while ($ex -is [System.Management.Automation.RuntimeException] -and $null -ne $ex.InnerException) { $ex = $ex.InnerException }
  if ($ex -is [Refusal]) { [Console]::Error.WriteLine($ex.Message) }
  else { [Console]::Error.WriteLine('error: ' + $ex.GetType().Name) }
  exit 1
}
[Console]::Out.WriteLine($line)
exit 0

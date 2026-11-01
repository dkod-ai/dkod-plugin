#!/bin/sh
# Install dk, the DKOD plugin manager, then the DKOD plugin:
#   curl -fsSL https://raw.githubusercontent.com/dkod-ai/dkod-plugin/main/install.sh | sh
#
# dk is one small program (written in Rust). This script downloads the build for your device from the
# dk release on github.com/dkod-ai/dkod-plugin, checks it against the release's SHA256SUMS, puts it in
# ~/.local/bin/dk and runs `dk install`. With arguments it runs dk with them instead: the same file is
# published as `dk`, so a dk from before 1.6.0 that upgrades itself lands here and gets the new dk.
# It needs no sudo. The same settings work as for dk: DKOD_AGENT, DKOD_CHANNEL, DKOD_GRAPHIFY,
# DKOD_NONINTERACTIVE. DKOD_DEBUG=1 prints each step and how long it took.
set -eu
umask 022

# The dk this file was published with. The download takes the version in dk-version on the channel's branch.
DK_VERSION=1.8.1
REPO="${DKOD_PLUGIN_REPO:-dkod-ai/dkod-plugin}"
BIN_DIR="${DKOD_BIN_DIR:-${HOME:?HOME is not set}/.local/bin}"

fail() { printf '✗ %s\n' "$*" >&2; exit 1; }
debug() { [ -z "${DKOD_DEBUG:-}" ] || printf '[dk-install] %s\n' "$*" >&2; }

[ "$(id -u)" -ne 0 ] || fail "Do not run this with sudo. dk and the plugin install for your own user, and root would own their folders."
for c in curl uname mktemp; do command -v "$c" >/dev/null 2>&1 || fail "Please install $c and run this command again."; done

# The build for this device.
exe=
case $(uname -s) in
  Darwin) os=apple-darwin ;;
  Linux) os=unknown-linux-musl ;;
  MINGW* | MSYS* | CYGWIN*) os=pc-windows-msvc; exe=.exe ;;
  *) fail "dk has no build for $(uname -s). It runs on macOS, Linux and Windows." ;;
esac
case $(uname -m) in
  x86_64 | amd64) arch=x86_64 ;;
  arm64 | aarch64) arch=aarch64 ;;
  *) fail "dk has no build for $(uname -m) processors. It runs on x86_64 and arm64." ;;
esac
# A Terminal under Rosetta says x86_64 on an Apple silicon Mac: the arm64 build is the native one.
[ "$os" != apple-darwin ] || [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" != 1 ] || arch=aarch64
# Windows on Arm runs the x86_64 build.
[ "$os" != pc-windows-msvc ] || arch=x86_64
asset="dk-$arch-$os$exe"
debug "build: $asset"

# The channel: DKOD_CHANNEL, else the one dk already follows.
channel=${DKOD_CHANNEL:-}
[ -n "$channel" ] || channel=$(cat "${XDG_CONFIG_HOME:-$HOME/.config}/dkod/channel" 2>/dev/null || echo stable)
ref=stable; [ "$channel" = nightly ] && ref=main

get() {
  if [ -n "${DKOD_DEBUG:-}" ]; then
    curl -fsSL --proto '=https' --proto-redir '=https' --tlsv1.2 --connect-timeout 15 --max-time 120 --retry 2 \
      -w '%{stderr}[dk-install] %{time_total}s %{url_effective}\n' "$1" 2>/dev/null
  else
    curl -fsSL --proto '=https' --proto-redir '=https' --tlsv1.2 --connect-timeout 15 --max-time 120 --retry 2 "$1" 2>/dev/null
  fi
}

# A size for people: 840 KB, 1.2 MB.
human() {
  if [ "$1" -lt 1048576 ]; then printf '%d KB' $((($1 + 1023) / 1024)); else t=$(($1 * 10 / 1048576)); printf '%d.%d MB' $((t / 10)) $((t % 10)); fi
}

# One progress line, the same as dk draws: label, a bar of 24, the percent and the sizes.
draw() { # label done total(or empty) tick
  on=; dim=; off=
  if [ -z "${NO_COLOR:-}" ]; then on=$(printf '\033[36m'); dim=$(printf '\033[90m'); off=$(printf '\033[0m'); fi
  bar=; i=0
  if [ -n "$3" ]; then
    d=$2; [ "$d" -le "$3" ] || d=$3
    f=$((d * 24 / $3))
    while [ $i -lt 24 ]; do if [ $i -lt $f ]; then bar="${bar}${on}━${off}"; else bar="${bar}${dim}━${off}"; fi; i=$((i + 1)); done
    size=$(printf '%3d%%  %s / %s' $((d * 100 / $3)) "$(human "$d")" "$(human "$3")")
  else
    pos=$(($4 % 30))
    while [ $i -lt 24 ]; do if [ $i -le $pos ] && [ $((i + 6)) -gt $pos ]; then bar="${bar}${on}━${off}"; else bar="${bar}${dim}━${off}"; fi; i=$((i + 1)); done
    size=$(human "$2")
  fi
  printf '\r\033[2K  %-12s %s  %s' "$1" "$bar" "$size" >&2
}

# The Content-Length of the last response in a curl header dump (a redirect writes one block per hop).
content_length() {
  tr -d '\r' 2>/dev/null <"$1" | awk 'toupper(substr($1, 1, 5)) == "HTTP/" { n = "" } tolower($1) == "content-length:" && $2 > 0 { n = $2 } END { print n }'
}

# Downloads $1 into the file $2. On a terminal it draws a progress bar named $3; the size comes from the
# response's own headers, so there is no extra request. The bar is cleared when the download ends.
download() {
  if [ -n "${DKOD_DEBUG:-}" ] || [ ! -t 2 ] || [ "${TERM:-dumb}" = dumb ]; then get "$1" >"$2"; return; fi
  hdr="$2.headers"
  curl -fsSL --proto '=https' --proto-redir '=https' --tlsv1.2 --connect-timeout 15 --max-time 120 --retry 2 \
    --dump-header "$hdr" -o "$2" "$1" 2>/dev/null &
  pid=$!
  total=; tick=0
  while kill -0 "$pid" 2>/dev/null; do
    [ -n "$total" ] || total=$(content_length "$hdr")
    draw "$3" "$(wc -c 2>/dev/null <"$2" | tr -d ' ')" "$total" $tick
    tick=$((tick + 1))
    sleep 0.08 2>/dev/null || sleep 1
  done
  if wait "$pid"; then
    rc=0; got=$(wc -c 2>/dev/null <"$2" | tr -d ' ')
    [ -n "$total" ] || total=$(content_length "$hdr")
    draw "$3" "$got" "${total:-$got}" $tick
  else
    rc=$?
  fi
  printf '\r\033[2K' >&2
  rm -f "$hdr"
  return $rc
}

# Before the first stable release with a dk-version, stable takes main's.
version=$(get "https://raw.githubusercontent.com/$REPO/$ref/dk-version" || get "https://raw.githubusercontent.com/$REPO/main/dk-version") \
  || fail "Could not reach github.com/$REPO. Check your connection and try again."
version=$(printf '%s' "$version" | tr -d ' \r\n')
case $version in [0-9]*.[0-9]*.[0-9]*) ;; *) fail "Could not read the dk version from github.com/$REPO. Try again later." ;; esac
base="https://github.com/$REPO/releases/download/dk-v$version"
debug "dk $version ($channel)"

mkdir -p "$BIN_DIR"
tmp=$(mktemp "$BIN_DIR/.dk.XXXXXX")
trap 'rm -f "$tmp" "$tmp.headers"; [ -z "${pid:-}" ] || kill "$pid" 2>/dev/null; true' 0
trap 'exit 130' INT TERM
download "$base/$asset" "$tmp" "dk $version" || fail "Could not download dk $version for your device. Check your connection and try again."
sums=$(get "$base/SHA256SUMS") || fail "Could not download the checksums of dk $version. Check your connection and try again."
want=$(printf '%s\n' "$sums" | awk -v a="$asset" '$2 == a || $2 == "*" a { print $1; exit }')
if command -v sha256sum >/dev/null 2>&1; then got=$(sha256sum "$tmp"); else got=$(shasum -a 256 "$tmp"); fi
got=${got%% *}
[ -n "$want" ] && [ "$want" = "$got" ] || fail "The download of dk did not match its checksum. Nothing was changed."
chmod 755 "$tmp"
mv -f "$tmp" "$BIN_DIR/dk$exe"
trap - 0
debug "dk $version is in $BIN_DIR/dk$exe"

[ $# -gt 0 ] || set -- install
exec "$BIN_DIR/dk$exe" "$@"

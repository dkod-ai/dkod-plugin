#!/bin/sh
# Install dk, the DKOD plugin manager, then the DKOD plugin in Claude Code, Cursor, Codex or GitHub Copilot CLI.
# Download this script to inspect it, or run:
#   curl -fsSL https://raw.githubusercontent.com/dkod-ai/dkod-plugin/main/install.sh | sh
#
# It puts dk in ~/.local/bin (DKOD_BIN_DIR to change it) and runs `dk install`, which asks which agents
# and which channel. Afterwards: dk upgrade, dk channel, dk doctor, dk uninstall (dk help lists them).
# The same settings work here as in dk:
#   DKOD_AGENT=claude,cursor,codex,copilot or all   DKOD_CHANNEL=stable|nightly   DKOD_NONINTERACTIVE=1
# It never uses sudo.
set -eu
umask 022

REPO="${DKOD_PLUGIN_REPO:-dkod-ai/dkod-plugin}"
BIN_DIR="${DKOD_BIN_DIR:-${HOME:?HOME is not set}/.local/bin}"
DK_BIN="$BIN_DIR/dk"

fail() { printf '✗ %s\n' "$*" >&2; exit 1; }
[ "$(id -u)" -ne 0 ] || fail "Do not run this with sudo. dk and the plugin install for your own user, and root would own their folders."
for c in curl tar mktemp sed awk; do command -v "$c" >/dev/null 2>&1 || fail "Please install $c and run this command again."; done

# dk comes from the branch of the chosen channel. Before the first release with dk in it, stable has
# no dk, so main's is used.
ref=stable; [ "${DKOD_CHANNEL:-}" = nightly ] && ref=main
mkdir -p "$BIN_DIR"
tmp=$(mktemp "$BIN_DIR/.dk.XXXXXX")
trap 'rm -f "$tmp"' 0
get() { curl -fsSL --proto '=https' --proto-redir '=https' --tlsv1.2 --connect-timeout 15 --max-time 120 --retry 2 "$1" >"$tmp" 2>/dev/null; }
get "https://raw.githubusercontent.com/$REPO/$ref/dk" || get "https://raw.githubusercontent.com/$REPO/main/dk" \
  || fail "Could not download dk from github.com/$REPO. Check your connection and try again."
[ "$(head -n 1 "$tmp")" = "#!/bin/sh" ] && grep -q '^DK_VERSION=' "$tmp" || fail "The download is not dk. Nothing was changed."
chmod 755 "$tmp"
mv "$tmp" "$DK_BIN"
trap - 0
exec sh "$DK_BIN" install

#!/bin/sh
# Install or upgrade the DKOD plugin for Claude Code and Cursor.
# Download this script to inspect it, or run:
#   curl -fsSL https://raw.githubusercontent.com/dkod-ai/dkod-plugin/main/install.sh | sh
#
# It finds the plugin where it is installed and upgrades it. Then it asks which agent to install it for
# and which channel to follow:
#   stable   the latest GitHub release (the default, and the one to use)
#   nightly  the newest commit on main
# Answers come from the terminal (/dev/tty), so the questions work under `curl | sh`. With no terminal,
# set them instead:
#   DKOD_AGENT=claude|cursor|both   DKOD_CHANNEL=stable|nightly
# DKOD_NONINTERACTIVE=1 never asks, even with a terminal (for a script or a device rollout).
# It never uses sudo, and it never touches a copy your company installed on this device.
set -eu
umask 022

REPO="${DKOD_PLUGIN_REPO:-dkod-ai/dkod-plugin}"
MARKET=dkod-ai
PLUGIN_ID="dkod@$MARKET"
CURSOR_DIR="${HOME:?HOME is not set}/.cursor/plugins/local/dkod"
CHANNEL_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/dkod/plugin-channel"

# Generated from DKOD-V-4096.png with ascii-image-converter v1.13.1, the same wordmark as
# https://dkod.ai/try/install.sh. stdin may be curl's pipe; stdout is the terminal that matters.
use_color=false
if [ -t 1 ] && [ "${TERM:-}" != dumb ]; then
  case "${TERM:-}" in xterm*|screen*|tmux*|rxvt*|linux|ansi|cygwin) use_color=true ;; esac
  case "${COLORTERM:-}" in truecolor|24bit) use_color=true ;; esac
  [ -z "${NO_COLOR+x}" ] || use_color=false
fi
paint() { if [ "$use_color" = true ]; then printf '\033[%sm%s\033[0m' "$1" "$2"; else printf '%s' "$2"; fi; }
show_wordmark() {
  [ -t 1 ] && [ "${TERM:-}" != dumb ] || return 0
  printf '\n'
  if [ "$use_color" = true ]; then printf '\033[36m'; fi
  cat <<'DKOD_WORDMARK'
⣮⡻⣿⣿⣷⣦⡀⢸⣿⡇⠀⣠⣾⣿⠟⣡⣶⣿⢸⣷⣦⡀⠀⣮⡻⣿⣿⣷⣦⡀
⣿⣿⠀⠀⠉⠿⠷⠸⠿⠇⠾⠿⠟⠁⠸⠿⠏⠀⠀⠉⠿⠿⠄⣿⣿⠀⠀⠉⠿⠷
⣿⣿⠀⠀⣀⣾⡿⢸⣿⡇⢿⣿⣦⡀⢸⣿⣆⠀⠀⣀⣾⣿⠃⣿⣿⠀⠀⣀⣾⡿
⢟⣵⣿⣿⡿⠟⠁⢸⣿⡇⠀⠙⢿⣿⣦⡙⠿⣿⢸⡿⠟⠁⠀⢟⣵⣿⣿⡿⠟⠁
DKOD_WORDMARK
  if [ "$use_color" = true ]; then printf '\033[0m'; fi
  printf '\n'
}

say() { printf '%s\n' "$*"; }
step() { printf '%s %s\n' "$(paint 36 '›')" "$*"; }
ok() { printf '%s %s\n' "$(paint 32 '✓')" "$*"; }
note() { printf '%s %s\n' "$(paint 33 '!')" "$*"; }
fail() { printf '%s %s\n' "$(paint 31 '✗')" "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fail "Please install $1 and run this command again."; }

[ "$(id -u)" -ne 0 ] || fail "Do not run this with sudo. The plugin installs for your own user, and root would own its folder."
for c in curl tar mktemp sed awk; do need "$c"; done

fetch() {
  curl -fsSL --proto '=https' --proto-redir '=https' --tlsv1.2 --connect-timeout 15 --max-time 120 --retry 2 "$@"
}

# The answer to a question, from the terminal. $1 is the default, used when there is no terminal.
TTY=
if [ -z "${DKOD_NONINTERACTIVE:-}" ] && [ -r /dev/tty ] && (exec </dev/tty) 2>/dev/null; then TTY=/dev/tty; fi
ask() {
  if [ -z "$TTY" ]; then printf '%s' "$1"; return; fi
  read -r answer <"$TTY" || answer=
  printf '%s' "${answer:-$1}"
}

# 0 when version $1 is older than version $2 (MAJOR.MINOR.PATCH).
older() {
  awk -v a="$1" -v b="$2" 'BEGIN { split(a, x, "."); split(b, y, ".");
    for (i = 1; i <= 3; i++) { if (x[i] + 0 < y[i] + 0) exit 0; if (x[i] + 0 > y[i] + 0) exit 1 } exit 1 }'
}
json_version() { sed -nE 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' "$1" | head -n 1; }

# --- What is installed now ---------------------------------------------------------------------

claude_cli=false; command -v claude >/dev/null 2>&1 && claude_cli=true
cursor_app=false
if command -v cursor >/dev/null 2>&1 || command -v cursor-agent >/dev/null 2>&1 || [ -d "$HOME/.cursor" ] || [ -d /Applications/Cursor.app ]; then cursor_app=true; fi

claude_version=; claude_ref=; claude_managed=false
if [ "$claude_cli" = true ]; then
  plugins=$(claude plugin list --json 2>/dev/null || :)
  claude_version=$(printf '%s\n' "$plugins" | awk -v id="\"$PLUGIN_ID\"" '
    $0 ~ "\"id\"" { hit = index($0, id) > 0 } hit && /"version"/ { sub(/.*"version"[^"]*"/, ""); sub(/".*/, ""); print; exit }')
  case $plugins in *'"dkod@dkod-managed"'*) claude_managed=true ;; esac
  claude_ref=$(claude plugin marketplace list --json 2>/dev/null | awk -v name="\"$MARKET\"" '
    /"name"/ { hit = index($0, name) > 0 } hit && /"ref"/ { sub(/.*"ref"[^"]*"/, ""); sub(/".*/, ""); print; exit } /}/ { hit = 0 }')
fi
claude_channel=stable; [ "$claude_ref" = main ] && claude_channel=nightly

cursor_version=; cursor_channel=stable
[ -f "$CURSOR_DIR/.cursor-plugin/plugin.json" ] && cursor_version=$(json_version "$CURSOR_DIR/.cursor-plugin/plugin.json")
[ -f "$CHANNEL_FILE" ] && [ "$(cat "$CHANNEL_FILE")" = nightly ] && cursor_channel=nightly
cursor_team=false
for d in "$HOME"/.cursor/plugins/cache/*/dkod; do [ -d "$d" ] && cursor_team=true; done

# --- Install steps ------------------------------------------------------------------------------

stable_tag=
resolve_stable() {
  [ -z "$stable_tag" ] || return 0
  # The redirect of releases/latest names the tag, with no API call and no rate limit.
  url=$(curl -fsSLI --proto '=https' --tlsv1.2 --connect-timeout 15 -o /dev/null -w '%{url_effective}' "https://github.com/$REPO/releases/latest") \
    || fail "Could not reach github.com. Check your connection and try again."
  stable_tag=${url##*/tag/}
  case $stable_tag in v[0-9]*.[0-9]*.[0-9]*) ;; *) fail "No stable release of $REPO was found. Try again later, or choose nightly." ;; esac
}

restart_claude=false; restart_cursor=false; signin_claude=false; signin_cursor=false

install_claude() {
  channel=$1
  if [ "$claude_cli" != true ]; then
    note "Claude Code is not installed. Install it from https://claude.com/claude-code, then run this again."
    return 0
  fi
  if [ "$claude_managed" = true ]; then
    ok "Claude Code: your company installed DKOD on this device. It updates by itself, so nothing to do."
    return 0
  fi
  ref=stable; [ "$channel" = nightly ] && ref=main
  before=$claude_version
  if [ -n "$claude_ref$before" ] || claude plugin marketplace list --json 2>/dev/null | grep -q "\"$MARKET\""; then
    if [ "$claude_ref" != "$ref" ]; then
      step "Claude Code: switching the $MARKET marketplace to $channel..."
      claude plugin marketplace remove "$MARKET" >/dev/null 2>&1 || :
      claude plugin marketplace add "$REPO@$ref" >/dev/null || fail "Could not add the marketplace $REPO@$ref."
    else
      step "Claude Code: refreshing the $MARKET marketplace..."
      claude plugin marketplace update "$MARKET" >/dev/null || fail "Could not refresh the marketplace $MARKET."
    fi
  else
    step "Claude Code: adding the $MARKET marketplace ($channel)..."
    claude plugin marketplace add "$REPO@$ref" >/dev/null || fail "Could not add the marketplace $REPO@$ref."
  fi
  if claude plugin list --json 2>/dev/null | grep -q "\"$PLUGIN_ID\""; then
    claude plugin update "$PLUGIN_ID" >/dev/null || fail "Could not update $PLUGIN_ID."
  else
    step "Claude Code: installing $PLUGIN_ID..."
    claude plugin install "$PLUGIN_ID" >/dev/null || fail "Could not install $PLUGIN_ID. If your organization blocks plugins, ask your admin."
  fi
  after=$(claude plugin list --json 2>/dev/null | awk -v id="\"$PLUGIN_ID\"" '
    $0 ~ "\"id\"" { hit = index($0, id) > 0 } hit && /"version"/ { sub(/.*"version"[^"]*"/, ""); sub(/".*/, ""); print; exit }')
  if [ -z "$before" ]; then
    ok "Claude Code: installed dkod ${after:-} ($channel)."
    restart_claude=true; signin_claude=true
  elif [ "$before" != "$after" ]; then
    ok "Claude Code: upgraded dkod $before -> $after ($channel)."
    restart_claude=true
  else
    ok "Claude Code: dkod $after is the latest $channel version."
  fi
}

install_cursor() {
  channel=$1
  if [ "$cursor_team" = true ]; then
    note "Cursor: your team marketplace already installs DKOD. Cursor updates that copy, so this script leaves it alone."
    return 0
  fi
  if [ "$channel" = stable ]; then
    resolve_stable
    archive="https://github.com/$REPO/archive/refs/tags/$stable_tag.tar.gz"
  else
    archive="https://github.com/$REPO/archive/refs/heads/main.tar.gz"
  fi
  before=$cursor_version
  step "Cursor: downloading the $channel plugin..."
  parent=$(dirname "$CURSOR_DIR")
  mkdir -p "$parent" "$(dirname "$CHANNEL_FILE")"
  # The new copy is unpacked next to the old one, then the two are swapped, so Cursor never loads half a plugin.
  work=$(mktemp -d "$parent/.dkod-install.XXXXXX")
  trap 'rm -rf "$work"' 0
  fetch "$archive" | tar -xz --strip-components 1 -C "$work" 2>/dev/null || fail "Could not download $archive."
  [ -f "$work/.cursor-plugin/plugin.json" ] || fail "The download is not the DKOD plugin. Nothing was changed."
  after=$(json_version "$work/.cursor-plugin/plugin.json")
  if [ "$before" = "$after" ] && [ "$cursor_channel" = "$channel" ]; then
    rm -rf "$work"; trap - 0
    ok "Cursor: dkod $after is the latest $channel version."
    return 0
  fi
  if [ -n "$before" ] && [ "$channel" = stable ] && older "$after" "$before"; then
    note "Cursor: your copy ($before) is newer than stable ($after). Going back to stable."
  fi
  if [ -e "$CURSOR_DIR" ]; then
    mv "$CURSOR_DIR" "$work.old"
  fi
  mv "$work" "$CURSOR_DIR"
  rm -rf "$work.old"; trap - 0
  printf '%s\n' "$channel" >"$CHANNEL_FILE"
  if [ -z "$before" ]; then
    ok "Cursor: installed dkod $after ($channel) in $CURSOR_DIR."
    signin_cursor=true
  else
    ok "Cursor: upgraded dkod $before -> $after ($channel)."
  fi
  restart_cursor=true
}

# --- The wizard ---------------------------------------------------------------------------------

show_wordmark
say "The DKOD plugin for Claude Code and Cursor."
say ""
if [ -n "$claude_version" ]; then say "  Claude Code  dkod $claude_version ($claude_channel)"; elif [ "$claude_managed" = true ]; then say "  Claude Code  installed by your company"; else say "  Claude Code  not installed"; fi
if [ -n "$cursor_version" ]; then say "  Cursor       dkod $cursor_version ($cursor_channel)"; elif [ "$cursor_team" = true ]; then say "  Cursor       installed by your team marketplace"; else say "  Cursor       not installed"; fi
say ""

agent=${DKOD_AGENT:-}
channel=${DKOD_CHANNEL:-}
case $channel in ''|stable|nightly) ;; *) fail "DKOD_CHANNEL must be stable or nightly." ;; esac
case $agent in ''|claude|cursor|both) ;; *) fail "DKOD_AGENT must be claude, cursor or both." ;; esac

# Upgrade what is installed, on the channel it follows (stable when it never chose one).
upgraded=
if [ -z "$agent" ]; then
  if [ -n "$claude_version" ]; then install_claude "${channel:-$claude_channel}"; upgraded="$upgraded claude"; fi
  if [ -n "$cursor_version" ]; then install_cursor "${channel:-$cursor_channel}"; upgraded="$upgraded cursor"; fi
fi

# Then offer what is not installed yet.
if [ -z "$agent" ]; then
  missing=
  [ -z "$claude_version" ] && [ "$claude_managed" != true ] && missing="$missing claude"
  [ -z "$cursor_version" ] && [ "$cursor_team" != true ] && missing="$missing cursor"
  if [ -n "$missing" ] && [ -z "$upgraded" ]; then
    [ -n "$TTY" ] || fail "No terminal to ask in. Run it again with DKOD_AGENT=claude, cursor or both."
    default=1
    [ "$claude_cli" != true ] && [ "$cursor_app" = true ] && default=2
    say "Which agent do you want the DKOD plugin in?"
    say "  1) Claude Code"
    say "  2) Cursor"
    say "  3) Both"
    printf 'Choose [%s]: ' "$default"
    case $(ask "$default") in 1|claude) agent=claude ;; 2|cursor) agent=cursor ;; 3|both) agent=both ;; *) fail "Choose 1, 2 or 3." ;; esac
    say ""
  elif [ -n "$missing" ] && [ -n "$TTY" ]; then
    for a in $missing; do
      label="Claude Code"; [ "$a" = cursor ] && label=Cursor
      [ "$a" = claude ] && [ "$claude_cli" != true ] && continue
      [ "$a" = cursor ] && [ "$cursor_app" != true ] && continue
      printf 'Also install it in %s? [y/N]: ' "$label"
      case $(ask n) in y|Y|yes) agent="${agent:+both}"; agent="${agent:-$a}" ;; esac
    done
  fi
fi

if [ -n "$agent" ] && [ -z "$channel" ]; then
  if [ -n "$TTY" ]; then
    say "Which channel?"
    say "  1) stable   the latest release $(paint 32 '(recommended)')"
    say "  2) nightly  the newest commit on main"
    printf 'Choose [1]: '
    case $(ask 1) in 1|stable) channel=stable ;; 2|nightly) channel=nightly ;; *) fail "Choose 1 or 2." ;; esac
    say ""
  else
    channel=stable
  fi
fi

case $agent in
  claude) install_claude "$channel" ;;
  cursor) install_cursor "$channel" ;;
  both) case $upgraded in *claude*) ;; *) install_claude "$channel" ;; esac
        case $upgraded in *cursor*) ;; *) install_cursor "$channel" ;; esac ;;
esac

# --- What to do now -----------------------------------------------------------------------------

say ""
if [ "$restart_claude" = false ] && [ "$restart_cursor" = false ]; then
  ok "Nothing to change. You are up to date."
  exit 0
fi
say "$(paint 36 'Next')"
if [ "$restart_claude" = true ]; then
  say "  Claude Code: quit every open Claude Code session and start it again, so it loads the new plugin."
  if [ "$signin_claude" = true ]; then say "  Claude Code: type /mcp, pick dkod, then Authenticate. You sign in with your company's own sign-in."; fi
fi
if [ "$restart_cursor" = true ]; then
  say "  Cursor: quit Cursor fully (Cmd+Q on a Mac) and open it again, so it loads the new plugin."
  if [ "$signin_cursor" = true ]; then
    say "  Cursor: open Settings, MCP, find DKOD and choose Connect. You sign in with your company's own sign-in."
    if command -v cursor-agent >/dev/null 2>&1; then say "  Cursor CLI: see https://github.com/$REPO#cursor-cli to sign in from cursor-agent."; fi
  fi
fi

#!/bin/sh
# Install or upgrade the DKOD plugin for Claude Code, Cursor, Codex and GitHub Copilot CLI.
# Download this script to inspect it, or run:
#   curl -fsSL https://raw.githubusercontent.com/dkod-ai/dkod-plugin/main/install.sh | sh
#
# It shows where the plugin is installed, then asks which agents to install or upgrade it in and
# which channel to follow:
#   stable   the latest GitHub release (the default, and the one to use)
#   nightly  the newest commit on main
# Answers come from the terminal (/dev/tty), so the questions work under `curl | sh`. With no terminal,
# set them instead:
#   DKOD_AGENT=claude,cursor,codex,copilot or all   DKOD_CHANNEL=stable|nightly
# With no terminal and no DKOD_AGENT, it upgrades the copies that are installed, each on its own channel.
# DKOD_NONINTERACTIVE=1 never asks, even with a terminal (for a script or a device rollout).
# It never uses sudo, and it never touches a copy your company installed on this device.
set -eu
umask 022

REPO="${DKOD_PLUGIN_REPO:-dkod-ai/dkod-plugin}"
MARKET=dkod-ai
PLUGIN_ID="dkod@$MARKET"
CURSOR_DIR="${HOME:?HOME is not set}/.cursor/plugins/local/dkod"
CHANNEL_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/dkod/plugin-channel"
CODEX_CONFIG="${CODEX_HOME:-$HOME/.codex}/config.toml"
COPILOT_SETTINGS="${COPILOT_HOME:-$HOME/.copilot}/settings.json"
AGENTS="claude cursor codex copilot"

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

# The answers come from the terminal, opened once on fd 3. DKOD_TTY names another file (the tests use it).
TTY=
if [ -z "${DKOD_NONINTERACTIVE:-}" ]; then
  tty_path=${DKOD_TTY:-/dev/tty}
  if [ -r "$tty_path" ] && (exec <"$tty_path") 2>/dev/null; then exec 3<"$tty_path"; TTY=$tty_path; fi
fi
# The answer to a question. $1 is the default, used for an empty answer and when there is no terminal.
ask() {
  if [ -z "$TTY" ]; then printf '%s' "$1"; return; fi
  read -r answer <&3 || answer=
  printf '%s' "${answer:-$1}"
}

# 0 when version $1 is older than version $2 (MAJOR.MINOR.PATCH).
older() {
  awk -v a="$1" -v b="$2" 'BEGIN { split(a, x, "."); split(b, y, ".");
    for (i = 1; i <= 3; i++) { if (x[i] + 0 < y[i] + 0) exit 0; if (x[i] + 0 > y[i] + 0) exit 1 } exit 1 }'
}
json_version() { sed -nE 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' "$1" | head -n 1; }
label() {
  case $1 in claude) printf 'Claude Code' ;; cursor) printf 'Cursor' ;; codex) printf 'Codex' ;; copilot) printf 'GitHub Copilot CLI' ;; esac
}
# Reads a per-agent variable: get claude version -> $claude_version.
get() { eval "printf '%s' \"\${$1_$2:-}\""; }

# --- What is installed now ---------------------------------------------------------------------

claude_app=false; command -v claude >/dev/null 2>&1 && claude_app=true
cursor_app=false
if command -v cursor >/dev/null 2>&1 || command -v cursor-agent >/dev/null 2>&1 || [ -d "$HOME/.cursor" ] || [ -d /Applications/Cursor.app ]; then cursor_app=true; fi
codex_app=false; command -v codex >/dev/null 2>&1 && codex_app=true
copilot_app=false; command -v copilot >/dev/null 2>&1 && copilot_app=true

claude_installed_version() {
  claude plugin list --json 2>/dev/null | awk -v id="\"$PLUGIN_ID\"" '
    $0 ~ "\"id\"" { hit = index($0, id) > 0 } hit && /"version"/ { sub(/.*"version"[^"]*"/, ""); sub(/".*/, ""); print; exit }'
}
# `codex plugin list --json` lists installed and available plugins; only an installed one counts.
codex_installed_version() {
  codex plugin list --json 2>/dev/null | awk -v id="\"$PLUGIN_ID\"" '
    /"pluginId"/ { hit = index($0, id) > 0; v = "" }
    hit && /"version"/ { v = $0; sub(/.*"version"[^"]*"/, "", v); sub(/".*/, "", v) }
    hit && /"installed"[[:space:]]*:[[:space:]]*true/ { print v; exit }
    hit && /"installed"[[:space:]]*:[[:space:]]*false/ { hit = 0 }'
}
copilot_installed_version() {
  copilot plugin list --json 2>/dev/null | awk '
    /"name"/ { hit = ($0 ~ /"dkod"/) } hit && /"marketplace"/ { hit = ($0 ~ /"dkod-ai"/) }
    hit && /"version"/ { sub(/.*"version"[^"]*"/, ""); sub(/".*/, ""); print; exit }'
}

claude_version=; claude_ref=; claude_locked=
if [ "$claude_app" = true ]; then
  plugins=$(claude plugin list --json 2>/dev/null || :)
  claude_version=$(claude_installed_version)
  case $plugins in *'"dkod@dkod-managed"'*) claude_locked="installed by your company, it updates by itself" ;; esac
  claude_ref=$(claude plugin marketplace list --json 2>/dev/null | awk -v name="\"$MARKET\"" '
    /"name"/ { hit = index($0, name) > 0 } hit && /"ref"/ { sub(/.*"ref"[^"]*"/, ""); sub(/".*/, ""); print; exit } /}/ { hit = 0 }')
fi
claude_channel=stable; [ "$claude_ref" = main ] && claude_channel=nightly

cursor_version=; cursor_channel=stable; cursor_locked=
[ -f "$CURSOR_DIR/.cursor-plugin/plugin.json" ] && cursor_version=$(json_version "$CURSOR_DIR/.cursor-plugin/plugin.json")
[ -f "$CHANNEL_FILE" ] && [ "$(cat "$CHANNEL_FILE")" = nightly ] && cursor_channel=nightly
for d in "$HOME"/.cursor/plugins/cache/*/dkod; do [ -d "$d" ] && cursor_locked="installed by your team marketplace, Cursor updates it"; done

# Codex and Copilot keep the marketplace ref in their own config. Only a ref of stable is stable:
# a marketplace added with no ref follows main.
codex_version=; codex_ref=; codex_locked=
if [ "$codex_app" = true ]; then
  codex_version=$(codex_installed_version)
  [ -f "$CODEX_CONFIG" ] && codex_ref=$(awk -v sec="[marketplaces.$MARKET]" '
    /^\[/ { hit = ($0 == sec) } hit && /^[[:space:]]*ref[[:space:]]*=/ { sub(/^[^"]*"/, ""); sub(/".*/, ""); print; exit }' "$CODEX_CONFIG")
fi
codex_channel=nightly; [ "$codex_ref" = stable ] && codex_channel=stable; [ -n "$codex_version" ] || codex_channel=stable

copilot_version=; copilot_ref=; copilot_locked=
if [ "$copilot_app" = true ]; then
  copilot_version=$(copilot_installed_version)
  [ -f "$COPILOT_SETTINGS" ] && copilot_ref=$(awk -v name="\"$MARKET\"" '
    !hit && index($0, name) && /\{/ { hit = 1; depth = 0 }
    hit { n = gsub(/\{/, "{"); m = gsub(/\}/, "}"); depth += n - m
          if (/"ref"/) { sub(/.*"ref"[^"]*"/, ""); sub(/".*/, ""); print; exit }
          if (depth <= 0) exit }' "$COPILOT_SETTINGS")
fi
copilot_channel=nightly; [ "$copilot_ref" = stable ] && copilot_channel=stable; [ -n "$copilot_version" ] || copilot_channel=stable

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

restart=; signin=

# Says what changed. $1 agent, $2 version before, $3 version after, $4 channel.
report() {
  name=$(label "$1")
  if [ -z "$2" ]; then
    ok "$name: installed dkod ${3:-} ($4)."
    restart="$restart $1"; signin="$signin $1"
  elif [ "$2" != "$3" ]; then
    ok "$name: upgraded dkod $2 -> $3 ($4)."
    restart="$restart $1"
  elif [ "$(get "$1" channel)" != "$4" ]; then
    ok "$name: dkod $3 now follows $4."
    restart="$restart $1"
  else
    ok "$name: dkod $3 is the latest $4 version."
  fi
}

install_claude() {
  channel=$1
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
  report claude "$before" "$(claude_installed_version)" "$channel"
}

install_cursor() {
  channel=$1
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
    report cursor "$before" "$after" "$channel"
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
  report cursor "$before" "$after" "$channel"
}

# Codex reads the same marketplace as Claude Code (.claude-plugin/marketplace.json).
install_codex() {
  channel=$1
  ref=stable; [ "$channel" = nightly ] && ref=main
  before=$codex_version
  if codex plugin marketplace list --json 2>/dev/null | grep -q "\"$MARKET\""; then
    if [ "$codex_ref" != "$ref" ]; then
      step "Codex: switching the $MARKET marketplace to $channel..."
      codex plugin marketplace remove "$MARKET" >/dev/null 2>&1 || :
      codex plugin marketplace add "$REPO" --ref "$ref" >/dev/null || fail "Could not add the marketplace $REPO ($ref) to Codex."
    else
      step "Codex: refreshing the $MARKET marketplace..."
      codex plugin marketplace upgrade "$MARKET" >/dev/null || fail "Could not refresh the marketplace $MARKET in Codex."
    fi
  else
    step "Codex: adding the $MARKET marketplace ($channel)..."
    codex plugin marketplace add "$REPO" --ref "$ref" >/dev/null || fail "Could not add the marketplace $REPO ($ref) to Codex."
  fi
  codex plugin add "$PLUGIN_ID" >/dev/null || fail "Could not install $PLUGIN_ID in Codex. If your organization blocks plugins, ask your admin."
  report codex "$before" "$(codex_installed_version)" "$channel"
}

# Copilot CLI reads the same marketplace too. It takes the ref after a #, and it removes a marketplace
# only together with its plugins, so a channel switch installs the plugin again.
install_copilot() {
  channel=$1
  ref=stable; [ "$channel" = nightly ] && ref=main
  before=$copilot_version
  source="https://github.com/$REPO.git#$ref"
  if copilot plugin marketplace list --json 2>/dev/null | grep -q "\"$MARKET\""; then
    if [ "$copilot_ref" != "$ref" ]; then
      step "Copilot: switching the $MARKET marketplace to $channel..."
      copilot plugin marketplace remove "$MARKET" --force >/dev/null 2>&1 || :
      copilot plugin marketplace add "$source" >/dev/null || fail "Could not add the marketplace $source to Copilot."
    else
      step "Copilot: refreshing the $MARKET marketplace..."
      copilot plugin marketplace update "$MARKET" >/dev/null || fail "Could not refresh the marketplace $MARKET in Copilot."
    fi
  else
    step "Copilot: adding the $MARKET marketplace ($channel)..."
    copilot plugin marketplace add "$source" >/dev/null || fail "Could not add the marketplace $source to Copilot."
  fi
  if [ -n "$(copilot_installed_version)" ]; then
    copilot plugin update "$PLUGIN_ID" >/dev/null || fail "Could not update $PLUGIN_ID in Copilot."
  else
    copilot plugin install "$PLUGIN_ID" >/dev/null || fail "Could not install $PLUGIN_ID in Copilot. If your organization blocks plugins, ask your admin."
  fi
  report copilot "$before" "$(copilot_installed_version)" "$channel"
}

# Installs in one agent, or says why it cannot.
install_in() {
  a=$1 channel=$2
  locked=$(get "$a" locked)
  if [ -n "$locked" ]; then ok "$(label "$a"): $locked. Nothing to do."; return 0; fi
  if [ "$(get "$a" app)" != true ]; then
    case $a in
      claude) note "Claude Code is not installed. Install it from https://claude.com/claude-code, then run this again." ;;
      cursor) note "Cursor is not installed. Install it from https://cursor.com, then run this again." ;;
      codex) note "The Codex CLI is not installed. Install it from https://developers.openai.com/codex/cli, then run this again." ;;
      copilot) note "GitHub Copilot CLI is not installed. Install it from https://github.com/features/copilot/cli, then run this again." ;;
    esac
    return 0
  fi
  "install_$a" "$channel"
}

# --- The wizard ---------------------------------------------------------------------------------

show_wordmark
say ""
i=0
for a in $AGENTS; do
  i=$((i + 1))
  v=$(get "$a" version); locked=$(get "$a" locked)
  if [ -n "$v" ]; then status="dkod $v ($(get "$a" channel))"
  elif [ -n "$locked" ]; then status=$locked
  elif [ "$(get "$a" app)" = true ]; then status="not installed"
  else status="$(label "$a") is not on this computer"; fi
  printf '  %s) %-20s %s\n' "$i" "$(label "$a")" "$status"
done
say ""

agent=$(printf '%s' "${DKOD_AGENT:-}" | tr ',' ' ')
channel=${DKOD_CHANNEL:-}
case $channel in ''|stable|nightly) ;; *) fail "DKOD_CHANNEL must be stable or nightly." ;; esac
chosen=
for a in $agent; do
  case $a in
    claude|cursor|codex|copilot) chosen="$chosen $a" ;;
    both) chosen="$chosen claude cursor" ;;
    all) chosen=" $AGENTS" ;;
    *) fail "DKOD_AGENT takes claude, cursor, codex, copilot or all, separated by commas." ;;
  esac
done

# Installed copies, and agents that are here but have no plugin yet.
installed=; present=
for a in $AGENTS; do
  [ -z "$(get "$a" locked)" ] || continue
  if [ -n "$(get "$a" version)" ]; then installed="$installed $a"
  elif [ "$(get "$a" app)" = true ]; then present="$present $a"; fi
done

own_channel=false
if [ -z "$chosen" ] && [ -z "$TTY" ]; then
  # No one to ask: upgrade what is installed, each on the channel it follows.
  [ -n "$installed" ] || fail "No terminal to ask in. Run it again with DKOD_AGENT=claude, cursor, codex, copilot or all."
  chosen=$installed
  own_channel=true
elif [ -z "$chosen" ]; then
  default=${installed:-$present}
  numbers=
  for d in $default; do
    i=0; for a in $AGENTS; do i=$((i + 1)); [ "$a" = "$d" ] && numbers="$numbers $i"; done
  done
  numbers=${numbers# }
  say "Which agents should get the DKOD plugin? It installs it, or upgrades the copy you have."
  say "Type the numbers with spaces between them, like 1 3, or all."
  if [ -n "$numbers" ]; then printf 'Agents [%s]: ' "$numbers"; else printf 'Agents: '; fi
  reply=$(ask "$numbers")
  say ""
  for n in $(printf '%s' "$reply" | tr ',' ' '); do
    case $n in
      1) chosen="$chosen claude" ;; 2) chosen="$chosen cursor" ;; 3) chosen="$chosen codex" ;; 4) chosen="$chosen copilot" ;;
      all) chosen=" $AGENTS" ;;
      *) fail "Type the numbers 1 to 4, or all." ;;
    esac
  done
  [ -n "$chosen" ] || { ok "Nothing chosen. Nothing was changed."; exit 0; }
fi

if [ -z "$channel" ] && [ "$own_channel" = false ]; then
  # Keep nightly when every chosen copy already follows it.
  default=1 any=false
  for a in $chosen; do
    [ -n "$(get "$a" version)" ] || continue
    any=true
    [ "$(get "$a" channel)" = nightly ] || default=0
  done
  if [ "$any" = true ] && [ "$default" = 1 ]; then default=2; else default=1; fi
  if [ -n "$TTY" ]; then
    say "Which channel?"
    say "  1) stable   the latest release $(paint 32 '(recommended)')"
    say "  2) nightly  the newest commit on main"
    printf 'Channel [%s]: ' "$default"
    case $(ask "$default") in 1|stable) channel=stable ;; 2|nightly) channel=nightly ;; *) fail "Choose 1 or 2." ;; esac
    say ""
  else
    channel=stable; [ "$default" = 2 ] && channel=nightly
  fi
fi

done_list=
for a in $chosen; do
  case " $done_list " in *" $a "*) continue ;; esac
  done_list="$done_list $a"
  if [ "$own_channel" = true ] && [ -z "$channel" ]; then install_in "$a" "$(get "$a" channel)"; else install_in "$a" "$channel"; fi
done

# --- What to do now -----------------------------------------------------------------------------

has() { case " $1 " in *" $2 "*) return 0 ;; esac; return 1; }
say ""
if [ -z "$restart" ]; then
  ok "Nothing to change. You are up to date."
  exit 0
fi
say "$(paint 36 'Next')"
if has "$restart" claude; then
  say "  Claude Code: quit every open Claude Code session and start it again, so it loads the new plugin."
  if has "$signin" claude; then say "  Claude Code: type /mcp, pick dkod, then Authenticate. You sign in with your company's own sign-in."; fi
fi
if has "$restart" cursor; then
  say "  Cursor: quit Cursor fully (Cmd+Q on a Mac) and open it again, so it loads the new plugin."
  if has "$signin" cursor; then
    say "  Cursor: open Settings, MCP, find DKOD and choose Connect. You sign in with your company's own sign-in."
    if command -v cursor-agent >/dev/null 2>&1; then say "  Cursor CLI: see https://github.com/$REPO#cursor-cli to sign in from cursor-agent."; fi
  fi
fi
if has "$restart" codex; then
  say "  Codex: quit every open Codex session and start it again, so it loads the new plugin."
  say "  Codex: when Codex asks to trust the DKOD hook, trust it. The hook stops a git push to your company's repos and a secret written into a file."
  if has "$signin" codex; then say "  Codex: run codex mcp login dkod. You sign in with your company's own sign-in."; fi
fi
if has "$restart" copilot; then
  say "  Copilot: quit every open Copilot CLI session and start it again, so it loads the new plugin."
  if has "$signin" copilot; then
    say "  Copilot: type /mcp and check dkod. When it asks you to sign in, use your company's own sign-in."
    say "  Copilot: if your organization's Copilot policy blocks third-party MCP servers, ask your GitHub admin to allow DKOD."
  fi
fi

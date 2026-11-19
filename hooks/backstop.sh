#!/bin/sh
# Dkoder backstop (DKO-684). A managed PreToolUse command hook.
#
# Mods stop running under --safe-mode and after the mod worker crashes three times; managed command
# hooks keep running (and run first, before any mod: see the heartbeat below). This script keeps the two hard rules alive then:
#   1. no git push and no gh pr merge to an org repo (anything under dkoder.json "owners" except the
#      governance repo);
#   2. no certain-format secret (Tier A: private keys, AWS key ids, vendor token prefixes) written
#      into a file of an org repo or of a folder with no remote.
# The mod does the full job (remote resolution, gh api, hook bypass, guardrails, guard.yaml). This is
# small on purpose: plain POSIX sh, grep -E and sed, no jq. Every pattern here must also be caught by
# packages/harness/src/secret-guard.ts; test/backstop.test.ts holds it to that.
#
# Input: the hook event as JSON on stdin. Exit 0 allows, exit 2 blocks with the reason on stderr.
#
# DKO-763: the public plugin (user level, no device install) runs this same script as a plugin
# PreToolUse hook with `--always`. A plugin hook runs after every mod, so it judges every call, even
# while the mod's heartbeat is fresh: a mod the person installed may have rewritten the call. With no
# dkoder.json, the org's owners come from ~/.dkoder/guard.json, which the mod writes after DKOD
# sign-in. That copy sits in the person's home, so like the mod's kept config it may only add
# blocks: its governance repo is never read.
set -u

always=""
[ "${1:-}" = "--always" ] && always=1

here=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
conf="$here/dkoder.json"
trusted=1
if [ ! -r "$conf" ]; then
  conf="${HOME:-/nonexistent}/.dkoder/guard.json"
  trusted=""
fi
input=$(cat)

field() { printf '%s' "$input" | tr '\n' ' ' | sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p" | head -n 1; }

tool=$(field tool_name)
cwd=$(field cwd)

block() { printf 'Dkoder refused this. %s\n' "$1" >&2; exit 2; }

# Guard's own files (the heartbeat below) are never the agent's to touch, mod or no mod: a planted
# heartbeat would switch this backstop off. Only a real write counts: a file tool on a path in the
# folder, or a shell command that writes there (a redirect, a file-changing program, code run by an
# interpreter, or a cd into it). Text that only mentions the folder (a commit message, a note) passes.
gd='\.dkoder'
own="This touches Dkoder's own files (.dkoder). Leave them alone."
end_="([/\"'[:space:];&|)]|\\\\|\$)"
case "$tool" in
  Write|Edit|NotebookEdit)
    p=$(field file_path)
    [ -z "$p" ] && p=$(field notebook_path)
    if printf '%s' "$p" | grep -Eq "(^|/)$gd(/|\$)"; then block "$own"; fi
    ;;
  Bash)
    # The whole JSON string, escaped quotes included: `field` stops at the first quote.
    c=$(printf '%s' "$input" | tr '\n' ' ' | sed -En 's/.*"command"[[:space:]]*:[[:space:]]*"(([^"\\]|\\.)*)".*/\1/p' | head -n 1)
    path="\\\\?[\"']?([^[:space:]\"';&|]*/)?$gd$end_"
    start='(^|[;&|(`]|\\n|\$\()[[:space:]]*(sudo[[:space:]]+)?'
    if printf '%s' "$c" | grep -Eq ">[>|]?[[:space:]]*$path" ||
       printf '%s' "$c" | grep -Eq "$start(cd|pushd)[[:space:]]+$path" ||
       printf '%s' "$c" | grep -Eq "$start(cp|mv|tee|touch|mkdir|rm|rmdir|ln|install|rsync|truncate|chmod|chown|chflags|dd|sed|unzip|tar|ditto)[[:space:]]([^;&|\"]*[[:space:]])?$path" ||
       printf '%s' "$c" | grep -Eq "$start(python3?|node|bun|deno|perl|ruby|osascript)[[:space:]][^;&|]*$gd"; then
      block "$own"
    fi
    ;;
esac

# Managed hooks run before any mod, and their block is final. While the Guard mod runs in this
# session it judges every call itself (full rules, the band's pulse, the event on the Guard page), so
# the backstop steps aside. The mod proves it runs by a heartbeat file for this session, rewritten
# every few seconds. Under --safe-mode, or after the mod worker crashed, the heartbeat stops and the
# backstop enforces again within HEARTBEAT_MAX seconds.
HEARTBEAT_MAX=20
sid=$(field session_id)
[ -n "$always" ] && sid=""
case "$sid" in
  ''|*[!A-Za-z0-9_-]*) ;;
  *)
    hb="${HOME:-/nonexistent}/.dkoder/heartbeat/$sid"
    if [ -r "$hb" ]; then
      beat=$(head -c 20 "$hb" | tr -cd '0-9')
      now=$(date +%s)
      if [ -n "$beat" ] && [ $((now - beat)) -le "$HEARTBEAT_MAX" ] && [ $((beat - now)) -le 5 ]; then exit 0; fi
    fi
    ;;
esac

owners=""
governance=""
if [ -r "$conf" ]; then
  owners=$(tr '\n' ' ' < "$conf" | sed -n 's/.*"owners"[[:space:]]*:[[:space:]]*\[\([^]]*\)\].*/\1/p' | tr -d '" ' | tr ',' ' ' | tr 'A-Z' 'a-z')
  [ -n "$trusted" ] && governance=$(tr '\n' ' ' < "$conf" | sed -n 's/.*"governanceRepo"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | tr 'A-Z' 'a-z')
fi

# DKO-1855: an org that ships by pull request ("shipBy":"pr") may push one named branch. Only the
# trusted dkoder.json opens it, never the home copy. Its gitops and app repos stay closed, as in the mod.
ship_pr=""
bots_merge=""
fixed=""
if [ -n "$trusted" ] && [ -r "$conf" ] && tr '\n' ' ' < "$conf" | grep -Eq '(^|[^\\])"shipBy"[[:space:]]*:[[:space:]]*"pr"[[:space:]]*[,}]'; then
  ship_pr=1
  fixed=$(tr '\n' ' ' < "$conf" | sed -n 's/.*[^\\]"appRepos"[[:space:]]*:[[:space:]]*\[\([^]]*\)\].*/\1/p' | tr -d '" ' | tr ',' ' ' | tr 'A-Z' 'a-z')
  fixed="$fixed $(tr '\n' ' ' < "$conf" | sed -n 's/.*[^\\]"gitopsRepo"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | tr 'A-Z' 'a-z')"
  # The org's bots may merge their pull requests ("mergeBy":"bot"), only with shipBy pr and the trusted file.
  tr '\n' ' ' < "$conf" | grep -Eq '(^|[^\\])"mergeBy"[[:space:]]*:[[:space:]]*"bot"[[:space:]]*[,}]' && bots_merge=1
fi

# macOS ships /usr/bin/git as a stub: with no Apple developer tools, running it opens Apple's
# install window. git counts only when it is real (src/dev-tools.ts makes the same check).
real_git=
git_is_real() {
  if [ -z "$real_git" ]; then
    real_git=yes
    p=$(command -v git 2>/dev/null) || real_git=no
    case "$p" in
      /usr/bin/git|/usr/bin//git)
        if command -v xcode-select >/dev/null 2>&1; then
          d=$(xcode-select -p 2>/dev/null) && [ -n "$d" ] && [ -x "$d/usr/bin/git" ] || real_git=no
        fi
        ;;
    esac
  fi
  [ "$real_git" = yes ]
}

# The owner/name of every remote of the repo at $1, lower case, one per line.
remotes() {
  [ -d "$1" ] || return 0
  git_is_real || return 0
  git -C "$1" remote -v 2>/dev/null | awk '{print $2}' | sed -E 's#\.git$##; s#/$##' | sed -E 's#^.*[:/]([^/:]+/[^/:]+)$#\1#' | tr 'A-Z' 'a-z' | sort -u
}

# Is owner/name $1 an org repo Guard protects?
protected_repo() {
  [ "$1" = "$governance" ] && return 1
  owner=${1%%/*}
  for o in $owners; do [ "$o" = "$owner" ] && return 0; done
  return 1
}

# The first protected repo among the remotes of folder $1, or nothing.
protected_in() {
  for r in $(remotes "$1"); do
    if protected_repo "$r"; then printf '%s' "$r"; return 0; fi
  done
  return 1
}

# Does folder $1 belong to the org, or to no one (no remotes)? Outside repos are left alone.
in_scope() {
  rs=$(remotes "$1")
  [ -z "$rs" ] && return 0
  for r in $rs; do
    owner=${r%%/*}
    for o in $owners; do [ "$o" = "$owner" ] && return 0; done
  done
  return 1
}

# DKO-1855: is the whole command one push of one named branch that is not main or master? Only
# `git push [-u|--set-upstream] <remote> <branch | src:branch>`, nothing else on the line: no force,
# no +refspec, no delete, no wildcard, no --all/--mirror/--tags, no HEAD without a named target, and
# none of the folder's remotes is a gitops or app repo.
branch_push() {
  c=$(printf '%s' "$input" | tr '\n' ' ' | sed -En 's/.*"command"[[:space:]]*:[[:space:]]*"(([^"\\]|\\.)*)".*/\1/p' | head -n 1)
  printf '%s' "$c" | grep -Eq '^[[:space:]]*git[[:space:]]+push([[:space:]]+(-u|--set-upstream))*[[:space:]]+[A-Za-z0-9_][A-Za-z0-9._-]*[[:space:]]+[A-Za-z0-9._/:-]+[[:space:]]*$' || return 1
  # The charset above has no glob or quote characters, so plain word splitting is safe.
  set -f; set -- $c; set +f
  while [ $# -gt 2 ]; do shift; done
  remote=$1 spec=$2
  git_is_real || return 1
  # A tag pushed by name can start a release: the source must be HEAD or a local branch that no tag shares.
  is_branch() { git -C "${cwd:-.}" show-ref --verify --quiet "refs/heads/$1" && ! git -C "${cwd:-.}" show-ref --verify --quiet "refs/tags/$1"; }
  case "$spec" in
    -*|:*|*:*:*|*:) return 1 ;;
    *:*)
      src=${spec%%:*}
      dst=${spec#*:}
      case "$src" in
        HEAD) ;;
        refs/heads/*) is_branch "${src#refs/heads/}" || return 1 ;;
        refs/*) return 1 ;;
        *) is_branch "$src" || return 1 ;;
      esac
      ;;
    *)
      dst=$spec
      [ "$spec" = HEAD ] && return 1
      is_branch "${spec#refs/heads/}" || return 1
      case "$spec" in refs/heads/*) ;; refs/*) return 1 ;; esac
      # With no :dst, the repo's own remote.<name>.push could map the branch elsewhere.
      [ -n "$(git -C "${cwd:-.}" config --get-all "remote.$remote.push" 2>/dev/null)" ] && return 1
      ;;
  esac
  dst=${dst#refs/heads/}
  case "$dst" in
    refs/*|heads/*|tags/*|remotes/*|HEAD|/*|.*|-*|*/|*.|*.lock|*..*|*//*) return 1 ;;
  esac
  case "$(printf '%s' "$dst" | tr 'A-Z' 'a-z')" in main|master) return 1 ;; esac
  for r in $(remotes "${cwd:-.}"); do
    for f in $fixed; do [ "$r" = "$f" ] && return 1; done
  done
  return 0
}

# Is the whole command one plain `gh pr merge <number>` with only a merge method and --delete-branch, in a
# folder whose remotes are no gitops, app or governance repo? No --admin, no -R, no URL, nothing else on the line.
plain_merge() {
  c=$(printf '%s' "$input" | tr '\n' ' ' | sed -En 's/.*"command"[[:space:]]*:[[:space:]]*"(([^"\\]|\\.)*)".*/\1/p' | head -n 1)
  printf '%s' "$c" | grep -Eq '^[[:space:]]*gh[[:space:]]+pr[[:space:]]+merge[[:space:]]+[0-9]+([[:space:]]+(--squash|--merge|--rebase|-s|-m|-r|--delete-branch|-d|--auto))*[[:space:]]*$' || return 1
  git_is_real || return 1
  for r in $(remotes "${cwd:-.}"); do
    [ "$r" = "$governance" ] && return 1
    for f in $fixed; do [ "$r" = "$f" ] && return 1; done
  done
  return 0
}

case "$tool" in
  Bash)
    cmd=$(field command)
    if [ -n "$ship_pr" ] && branch_push; then exit 0; fi
    if [ -n "$ship_pr" ] && [ -n "$bots_merge" ] && plain_merge; then exit 0; fi
    if printf '%s' "$cmd" | grep -Eq '(^|[;&|( ]|\\n)git( +-[cC] +[^ ]+| +--[a-z-]+(=[^ ]+)?)* +push( |$)' ||
       printf '%s' "$cmd" | grep -Eq '(^|[;&|( ]|\\n)gh( +(-R|--repo) +[^ ]+| +--repo=[^ ]+)? +pr +merge( |$)'; then
      # An explicit org URL in the command, or else the folder's own remotes.
      for r in $(printf '%s' "$cmd" | grep -Eo 'github\.com[:/][A-Za-z0-9._-]+/[A-Za-z0-9._-]+' | sed -E 's#^github\.com[:/]##; s#\.git$##' | tr 'A-Z' 'a-z'); do
        protected_repo "$r" && block "Pushing or merging to $r is not allowed. App code ships through Deliver (the dkoder.deliver tool)."
      done
      r=$(protected_in "${cwd:-.}") && block "Pushing or merging to $r is not allowed. App code ships through Deliver (the dkoder.deliver tool)."
    fi
    ;;
  Write|Edit|NotebookEdit)
    path=$(field file_path)
    [ -z "$path" ] && path=$(field notebook_path)
    dir=$(dirname -- "${path:-.}")
    while [ ! -d "$dir" ] && [ "$dir" != "/" ]; do dir=$(dirname -- "$dir"); done
    in_scope "$dir" || exit 0
    pk="PRIV""ATE KEY"
    if printf '%s' "$input" | grep -Eq -- "-----BEGIN [A-Z0-9 ]{0,40}$pk( BLOCK)?-----" ||
       printf '%s' "$input" | grep -Eq '(^|[^A-Za-z0-9])(AKIA|ASIA)[0-9A-Z]{16}([^A-Za-z0-9]|$)' ||
       printf '%s' "$input" | grep -Eq '(^|[^A-Za-z0-9_])(gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{50}|glpat-[A-Za-z0-9_-]{20}|sk-ant-[A-Za-z0-9_-]{20}|sk-or-[A-Za-z0-9_-]{20}|sk-proj-[A-Za-z0-9_-]{20}|(sk|rk)_live_[A-Za-z0-9]{16}|xox[abposr]-[A-Za-z0-9-]{10}|AIza[0-9A-Za-z_-]{35})'; then
      block "${path:-The file} would carry a secret value. Put the NAME of a secret there and resolve it at run time."
    fi
    ;;
esac
exit 0
